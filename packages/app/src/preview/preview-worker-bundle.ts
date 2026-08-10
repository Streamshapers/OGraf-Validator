import type { OutputChunk, Plugin } from '@rollup/browser';
import {
    hasNonLiteralDynamicImport,
    rewriteImportMetaUrlReferences,
    type PreviewClassicWorkerEntry,
    type PreviewWorkerBundle,
} from './preview-module-graph.js';
import { parsePreviewResourceUrl } from './preview-resources.js';

const MAX_WORKER_FILES = 256;
const MAX_WORKER_BYTES = 16 * 1024 * 1024;

export async function buildPreviewWorkerBundle(
    worker: { url: string; type: 'module' | 'classic' },
    sessionId: string,
    readFile: (path: string) => Promise<ArrayBuffer>,
    signal?: AbortSignal,
): Promise<PreviewWorkerBundle> {
    assertWorkerUrl(worker.url, sessionId);
    return worker.type === 'module'
        ? buildModuleWorker(worker.url, sessionId, readFile, signal)
        : buildClassicWorker(worker.url, sessionId, readFile, signal);
}

async function buildModuleWorker(
    entryUrl: string,
    sessionId: string,
    readFile: (path: string) => Promise<ArrayBuffer>,
    signal?: AbortSignal,
): Promise<PreviewWorkerBundle> {
    const { rollup } = await import('@rollup/browser');
    let bytes = 0;
    let files = 0;
    let unsupportedReason: string | undefined;
    const plugin: Plugin = {
        name: 'ograf-preview-worker-session',
        resolveId(source, importer) {
            if (source === entryUrl) return source;
            if (!isUrlLikeSpecifier(source)) return { id: source, external: true };
            const resolved = new URL(source, importer ?? entryUrl);
            if (resolved.origin !== new URL(entryUrl).origin) return { id: resolved.toString(), external: true };
            assertWorkerUrl(resolved.toString(), sessionId);
            resolved.hash = '';
            resolved.search = '';
            return resolved.toString();
        },
        async load(id) {
            if (!isSessionUrl(id, sessionId)) return null;
            throwIfAborted(signal);
            const parsed = assertWorkerUrl(id, sessionId);
            if (++files > MAX_WORKER_FILES) throw new Error(`Worker graph exceeds ${MAX_WORKER_FILES} files.`);
            const buffer = await readFile(parsed.path);
            bytes += buffer.byteLength;
            if (bytes > MAX_WORKER_BYTES) throw new Error(`Worker graph exceeds ${MAX_WORKER_BYTES} bytes.`);
            const extension = extensionOf(parsed.path);
            if (extension === 'json') {
                const json = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
                JSON.parse(json);
                return `export default ${json};`;
            }
            if (extension === 'wasm') {
                return `export default ${JSON.stringify(id)};`;
            }
            const source = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
            if (hasNonLiteralDynamicImport(source)) {
                unsupportedReason = `Worker "${parsed.path}" uses a non-literal dynamic import that cannot be tested in the isolated preview.`;
            }
            return rewriteImportMetaUrlReferences(source, id);
        },
    };

    const build = await rollup({ input: entryUrl, plugins: [plugin] });
    try {
        const generated = await build.generate({ format: 'es', inlineDynamicImports: true, exports: 'none' });
        const chunk = generated.output.find((output): output is OutputChunk => output.type === 'chunk');
        if (!chunk) throw new Error('Rollup did not create a module Worker chunk.');
        return {
            url: entryUrl,
            type: 'module',
            source: chunk.code,
            ...(unsupportedReason ? { unsupportedReason } : {}),
        };
    } finally {
        await build.close();
    }
}

async function buildClassicWorker(
    entryUrl: string,
    sessionId: string,
    readFile: (path: string) => Promise<ArrayBuffer>,
    signal?: AbortSignal,
): Promise<PreviewWorkerBundle> {
    const entries: PreviewClassicWorkerEntry[] = [];
    const ids = new Map<string, string>();
    const active = new Set<string>();
    let bytes = 0;
    let unsupportedReason: string | undefined;

    const visit = async (url: string): Promise<string> => {
        const existing = ids.get(url);
        if (existing) return existing;
        if (ids.size >= MAX_WORKER_FILES) throw new Error(`Worker graph exceeds ${MAX_WORKER_FILES} files.`);
        const parsed = assertWorkerUrl(url, sessionId);
        const id = `classic-${ids.size}`;
        ids.set(url, id);
        active.add(url);
        throwIfAborted(signal);
        const buffer = await readFile(parsed.path);
        bytes += buffer.byteLength;
        if (bytes > MAX_WORKER_BYTES) throw new Error(`Worker graph exceeds ${MAX_WORKER_BYTES} bytes.`);
        let source = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        const calls = findImportScriptsCalls(source);
        const replacements: Array<{ start: number; end: number; source: string }> = [];
        for (const call of calls) {
            if (!call.specifiers) {
                unsupportedReason = `Classic Worker "${parsed.path}" uses a non-literal importScripts() path that cannot be tested in the isolated preview.`;
                continue;
            }
            const dependencyIds: string[] = [];
            for (const specifier of call.specifiers) {
                const resolved = new URL(specifier, url).toString();
                assertWorkerUrl(resolved, sessionId);
                if (active.has(resolved)) {
                    unsupportedReason = `Classic Worker import cycle at "${assertWorkerUrl(resolved, sessionId).path}" cannot be tested safely.`;
                    continue;
                }
                dependencyIds.push(await visit(resolved));
            }
            replacements.push({
                start: call.start,
                end: call.end,
                source: dependencyIds.map((dependencyId) => `/*__OGRAF_CLASSIC_${dependencyId}__*/`).join('\n'),
            });
        }
        for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
            source = `${source.slice(0, replacement.start)}${replacement.source}${source.slice(replacement.end)}`;
        }
        source = rewriteImportMetaUrlReferences(source, url);
        active.delete(url);
        entries.push({ id, url, source });
        return id;
    };

    const entryId = await visit(entryUrl);
    return {
        url: entryUrl,
        type: 'classic',
        entries,
        entryId,
        ...(unsupportedReason ? { unsupportedReason } : {}),
    };
}

function findImportScriptsCalls(source: string): Array<{
    start: number;
    end: number;
    specifiers?: string[];
}> {
    const calls: Array<{ start: number; end: number; specifiers?: string[] }> = [];
    const expression = /\bimportScripts\s*\(([^)]*)\)/g;
    for (const match of source.matchAll(expression)) {
        const start = match.index;
        if (start === undefined) continue;
        const argumentsSource = match[1] ?? '';
        const specifiers: string[] = [];
        let position = 0;
        let valid = true;
        while (position < argumentsSource.length) {
            while (/\s|,/.test(argumentsSource[position] ?? '')) position += 1;
            if (position >= argumentsSource.length) break;
            const quote = argumentsSource[position];
            if (quote !== '"' && quote !== "'") { valid = false; break; }
            position += 1;
            let value = '';
            let closed = false;
            while (position < argumentsSource.length) {
                const character = argumentsSource[position++];
                if (character === '\\') {
                    const escaped = argumentsSource[position++];
                    if (escaped !== undefined) value += escaped;
                } else if (character === quote) {
                    closed = true;
                    break;
                } else {
                    value += character;
                }
            }
            if (!closed) { valid = false; break; }
            specifiers.push(value);
            while (/\s/.test(argumentsSource[position] ?? '')) position += 1;
            if (position < argumentsSource.length && argumentsSource[position] !== ',') { valid = false; break; }
        }
        calls.push({
            start,
            end: start + match[0].length,
            ...(valid ? { specifiers } : {}),
        });
    }
    return calls;
}

function assertWorkerUrl(url: string, sessionId: string): { sessionId: string; path: string } {
    const parsed = parsePreviewResourceUrl(url, new URL(url).origin);
    if (parsed.sessionId !== sessionId) throw new Error(`Worker URL "${url}" escapes the active preview session.`);
    return parsed;
}

function isSessionUrl(url: string, sessionId: string): boolean {
    try {
        return assertWorkerUrl(url, sessionId).sessionId === sessionId;
    } catch {
        return false;
    }
}

function isUrlLikeSpecifier(specifier: string): boolean {
    return specifier.startsWith('.') || specifier.startsWith('/') || /^[A-Za-z][A-Za-z\d+.-]*:/.test(specifier);
}

function extensionOf(path: string): string {
    const filename = path.slice(path.lastIndexOf('/') + 1);
    const dot = filename.lastIndexOf('.');
    return dot < 0 ? '' : filename.slice(dot + 1).toLowerCase();
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new DOMException('Preview Worker preparation was aborted.', 'AbortError');
}
