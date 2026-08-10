import {
    PREVIEW_PREFIX,
    buildPreviewResourceUrl,
    parsePreviewResourceUrl,
} from './preview-resources.js';

const MAX_MODULE_COUNT = 512;
const MAX_GRAPH_BYTES = 32 * 1024 * 1024;

export interface PreviewModuleGraphEntry {
    url: string;
    specifier: string;
    source: string | ArrayBuffer;
    mimeType: string;
}

export interface PreviewModuleGraph {
    entrySpecifier: string;
    modules: PreviewModuleGraphEntry[];
    workers: PreviewWorkerBundle[];
    diagnostics: PreviewGraphDiagnostic[];
}

export interface PreviewGraphDiagnostic {
    code: 'UNSUPPORTED_SHARED_WORKER' | 'DYNAMIC_WORKER_ENTRY';
    message: string;
}

export interface PreviewClassicWorkerEntry {
    id: string;
    url: string;
    source: string;
}

export interface PreviewWorkerBundle {
    url: string;
    type: 'module' | 'classic';
    source?: string;
    entries?: PreviewClassicWorkerEntry[];
    entryId?: string;
    unsupportedReason?: string;
}

export interface PreviewModuleRewrite {
    source: string;
    dependencies: string[];
    requiresPackageModuleListing: boolean;
}

interface PreviewWorkerReference {
    url: string;
    type: 'module' | 'classic';
}

interface ImportMetaResolveRewrite {
    source: string;
    dependencies: string[];
}

interface ModuleReference {
    start: number;
    end: number;
    specifier: string;
    kind: 'module' | 'asset' | 'asset-directory';
}

interface Token {
    kind: 'identifier' | 'number' | 'punctuation' | 'string';
    value: string;
    start: number;
    end: number;
}

/**
 * Build a self-contained module graph for an opaque-origin sandbox. Source is
 * read by the trusted parent, while Blob URLs are deliberately created later
 * inside the sandbox runner.
 */
export async function buildPreviewModuleGraph(
    entryUrl: string,
    sessionId: string,
    readFile: (path: string) => Promise<ArrayBuffer>,
    signal?: AbortSignal,
    listFiles?: () => Promise<string[]>,
): Promise<PreviewModuleGraph> {
    assertSessionUrl(entryUrl, sessionId);
    const queue = [new URL(entryUrl).toString()];
    const queued = new Set(queue);
    const modules: PreviewModuleGraphEntry[] = [];
    let graphBytes = 0;
    let packageModulesListed = false;
    const workerReferences = new Map<string, PreviewWorkerReference>();
    const diagnostics: PreviewGraphDiagnostic[] = [];

    while (queue.length > 0) {
        if (signal?.aborted) throw new DOMException('Preview module graph was aborted.', 'AbortError');
        if (modules.length >= MAX_MODULE_COUNT) {
            throw new Error(`Preview module graph exceeds ${MAX_MODULE_COUNT} modules.`);
        }

        const url = queue.shift();
        if (!url) break;
        const parsed = assertSessionUrl(url, sessionId);
        const buffer = await readFile(parsed.path);
        graphBytes += buffer.byteLength;
        if (graphBytes > MAX_GRAPH_BYTES) {
            throw new Error(`Preview module graph exceeds ${MAX_GRAPH_BYTES} bytes.`);
        }

        const mimeType = previewMimeTypeForPath(parsed.path);
        const specifier = syntheticModuleSpecifier(url);
        if (isJavaScriptModule(parsed.path)) {
            const source = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
            const discovered = discoverPreviewWorkers(source, url, sessionId);
            for (const worker of discovered.workers) {
                workerReferences.set(`${worker.type}:${worker.url}`, worker);
            }
            for (const diagnostic of discovered.diagnostics) {
                if (!diagnostics.some((candidate) => candidate.code === diagnostic.code && candidate.message === diagnostic.message)) {
                    diagnostics.push(diagnostic);
                }
            }
            let rewritten: PreviewModuleRewrite;
            try {
                rewritten = rewritePreviewModuleSource(source, url, sessionId);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw Object.assign(
                    new Error(`Failed to parse OGraf module "${parsed.path}": ${message}`),
                    { cause: error },
                );
            }
            modules.push({ url, specifier, source: rewritten.source, mimeType });
            for (const dependency of rewritten.dependencies) {
                if (queued.has(dependency)) continue;
                queued.add(dependency);
                queue.push(dependency);
            }
            if (rewritten.requiresPackageModuleListing && !packageModulesListed) {
                if (!listFiles) {
                    throw new Error(
                        'A package file listing is required to resolve a non-literal dynamic import.',
                    );
                }
                packageModulesListed = true;
                const origin = new URL(entryUrl).origin;
                for (const candidatePath of await listFiles()) {
                    if (!isPotentialDynamicModule(candidatePath)) continue;
                    const candidateUrl = buildPreviewResourceUrl(candidatePath, sessionId, origin);
                    if (queued.has(candidateUrl)) continue;
                    queued.add(candidateUrl);
                    queue.push(candidateUrl);
                }
            }
        } else {
            modules.push({ url, specifier, source: buffer, mimeType });
        }
    }

    const workers: PreviewWorkerBundle[] = [];
    if (workerReferences.size > 0) {
        const { buildPreviewWorkerBundle } = await import('./preview-worker-bundle.js');
        for (const worker of workerReferences.values()) {
            throwIfAborted(signal);
            workers.push(await buildPreviewWorkerBundle(
                worker,
                sessionId,
                readFile,
                signal,
            ));
        }
    }

    return {
        entrySpecifier: syntheticModuleSpecifier(new URL(entryUrl).toString()),
        modules,
        workers,
        diagnostics,
    };
}

/** Rewrite local ESM specifiers to stable import-map keys. */
export function rewritePreviewModuleSource(
    source: string,
    moduleUrl: string,
    sessionId: string,
): PreviewModuleRewrite {
    assertSessionUrl(moduleUrl, sessionId);
    const originalModuleUrl = new URL(moduleUrl).toString();
    const metaResolve = rewriteImportMetaResolveCalls(source, originalModuleUrl, sessionId);
    const resolvableSource = metaResolve.source;
    const replacements: Array<ModuleReference & {
        replacement: string;
        dependency: string;
        enqueueDependency: boolean;
    }> = [];
    for (const reference of findSourceReferences(resolvableSource)) {
        const dependency = resolvePackageModule(reference.specifier, moduleUrl, sessionId);
        if (!dependency) continue;
        const syntheticSpecifier = syntheticModuleSpecifier(dependency);
        replacements.push({
            ...reference,
            dependency,
            enqueueDependency: reference.kind !== 'asset-directory',
            replacement: reference.kind === 'module'
                ? syntheticSpecifier
                : reference.kind === 'asset-directory'
                    ? `new URL(${JSON.stringify(dependency)})`
                    : `new URL(globalThis.__ografValidatorResolveAsset(${JSON.stringify(syntheticSpecifier)}))`,
        });
    }

    const dynamicImports = findDynamicImportArguments(resolvableSource);
    const dynamicReplacements = dynamicImports.map(({ start, end }) => ({
        start,
        end,
        replacement: `globalThis.__ografValidatorResolveImport((${
            resolvableSource.slice(start, end)
        }), ${JSON.stringify(originalModuleUrl)})`,
    }));

    const dependencies = [...new Set([
        ...metaResolve.dependencies,
        ...replacements
            .filter(({ enqueueDependency }) => enqueueDependency)
            .map(({ dependency }) => dependency),
    ])];
    let rewritten = resolvableSource;
    for (const replacement of [...replacements, ...dynamicReplacements]
        .sort((left, right) => right.start - left.start)) {
        rewritten = `${rewritten.slice(0, replacement.start)}${replacement.replacement}${rewritten.slice(replacement.end)}`;
    }
    // Literal asset expressions above are rewritten to Blob-backed URLs first. Any remaining
    // import.meta.url reference must retain the original package-module URL instead of exposing
    // the opaque sandbox's blob:null URL.
    rewritten = rewriteImportMetaUrlReferences(rewritten, originalModuleUrl);

    return {
        source: rewritten,
        dependencies,
        requiresPackageModuleListing: dynamicImports.length > 0,
    };
}

export function rewriteImportMetaUrlReferences(source: string, moduleUrl: string): string {
    const tokens = tokenize(source);
    const replacements: Array<{ start: number; end: number }> = [];

    for (let index = 0; index < tokens.length; index += 1) {
        if (!isImportMetaUrlReference(tokens, index)) continue;
        const first = tokens[index];
        const last = tokens[index + 4];
        if (first && last) replacements.push({ start: first.start, end: last.end });
    }

    let rewritten = source;
    for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
        rewritten = `${rewritten.slice(0, replacement.start)}${JSON.stringify(moduleUrl)}${rewritten.slice(replacement.end)}`;
    }
    return rewritten;
}

export function hasNonLiteralDynamicImport(source: string): boolean {
    return findDynamicImportArguments(source).length > 0;
}

function rewriteImportMetaResolveCalls(
    source: string,
    moduleUrl: string,
    sessionId: string,
): ImportMetaResolveRewrite {
    const tokens = tokenize(source);
    const replacements: Array<{ start: number; end: number; replacement: string }> = [];
    const dependencies: string[] = [];

    for (let index = 0; index < tokens.length; index += 1) {
        if (!isImportMetaResolve(tokens, index)) continue;
        const argument = tokens[index + 6];
        if (!argument) throw new Error('import.meta.resolve requires a module specifier.');
        if (argument.kind === 'string' && !argument.value.endsWith('/')) {
            const dependency = resolvePackageModule(argument.value, moduleUrl, sessionId);
            if (dependency) dependencies.push(dependency);
        }
        const openingIndex = index + 5;
        const argumentStart = argument.kind === 'string' ? argument.start - 1 : argument.start;
        const argumentEnd = findFirstCallArgumentEnd(tokens, openingIndex, 'import.meta.resolve');
        const closingEnd = findCallClosingParenthesis(tokens, openingIndex, 'import.meta.resolve');
        replacements.push({
            start: tokens[index]?.start ?? 0,
            end: closingEnd,
            replacement: `globalThis.__ografValidatorResolveMeta((${
                source.slice(argumentStart, argumentEnd)
            }), ${JSON.stringify(moduleUrl)})`,
        });
    }

    let rewritten = source;
    for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
        rewritten = `${rewritten.slice(0, replacement.start)}${replacement.replacement}${rewritten.slice(replacement.end)}`;
    }
    return { source: rewritten, dependencies: [...new Set(dependencies)] };
}

export function syntheticModuleSpecifier(url: string): string {
    return `@ograf-validator/package/${encodeURIComponent(new URL(url).toString())}`;
}

function assertSessionUrl(url: string, sessionId: string): { sessionId: string; path: string } {
    const parsed = parsePreviewResourceUrl(url);
    if (parsed.sessionId !== sessionId) {
        throw new Error('Preview module URL does not match the active session.');
    }
    return parsed;
}

function resolvePackageModule(specifier: string, moduleUrl: string, sessionId: string): string | null {
    if (!isUrlLikeSpecifier(specifier)) return null;

    const resolved = new URL(specifier, moduleUrl);
    const module = new URL(moduleUrl);
    if (resolved.origin !== module.origin) return null;

    const sessionPrefix = `${PREVIEW_PREFIX}${sessionId}/`;
    if (!resolved.pathname.startsWith(sessionPrefix)) {
        throw new Error(`Module specifier "${specifier}" escapes the preview package session.`);
    }
    assertSessionUrl(resolved.toString(), sessionId);
    return resolved.toString();
}

function isUrlLikeSpecifier(specifier: string): boolean {
    return specifier.startsWith('.') || specifier.startsWith('/') || /^[A-Za-z][A-Za-z\d+.-]*:/.test(specifier);
}

function isJavaScriptModule(path: string): boolean {
    const extension = extensionOf(path);
    return extension === '' || extension === 'js' || extension === 'mjs';
}

function isPotentialDynamicModule(path: string): boolean {
    const extension = extensionOf(path);
    return extension === '' || extension === 'js' || extension === 'mjs' || extension === 'json' || extension === 'wasm';
}

export function previewMimeTypeForPath(path: string): string {
    switch (extensionOf(path)) {
        case 'avif': return 'image/avif';
        case 'bmp': return 'image/bmp';
        case 'css': return 'text/css; charset=utf-8';
        case 'gif': return 'image/gif';
        case 'glb': return 'model/gltf-binary';
        case 'gltf': return 'model/gltf+json';
        case 'html': return 'text/html; charset=utf-8';
        case 'ico': return 'image/x-icon';
        case 'jpeg':
        case 'jpg': return 'image/jpeg';
        case 'json': return 'application/json; charset=utf-8';
        case 'm4a': return 'audio/mp4';
        case 'mp3': return 'audio/mpeg';
        case 'mp4': return 'video/mp4';
        case 'oga':
        case 'ogg': return 'audio/ogg';
        case 'ogv': return 'video/ogg';
        case 'otf': return 'font/otf';
        case 'png': return 'image/png';
        case 'svg': return 'image/svg+xml; charset=utf-8';
        case 'ttf': return 'font/ttf';
        case 'txt': return 'text/plain; charset=utf-8';
        case 'wasm': return 'application/wasm';
        case 'wav': return 'audio/wav';
        case 'webm': return 'video/webm';
        case 'webp': return 'image/webp';
        case 'woff': return 'font/woff';
        case 'woff2': return 'font/woff2';
        case 'xml': return 'application/xml; charset=utf-8';
        case '':
        case 'js':
        case 'mjs': return 'text/javascript; charset=utf-8';
        default: return 'application/octet-stream';
    }
}

function extensionOf(path: string): string {
    const filename = path.slice(path.lastIndexOf('/') + 1);
    const dot = filename.lastIndexOf('.');
    return dot < 0 ? '' : filename.slice(dot + 1).toLowerCase();
}

function discoverPreviewWorkers(
    source: string,
    moduleUrl: string,
    sessionId: string,
): { workers: PreviewWorkerReference[]; diagnostics: PreviewGraphDiagnostic[] } {
    const tokens = tokenize(source);
    const workers: PreviewWorkerReference[] = [];
    const diagnostics: PreviewGraphDiagnostic[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        const constructor = tokens[index + 1];
        const opening = tokens[index + 2];
        if (
            token?.kind !== 'identifier' || token.value !== 'new' ||
            constructor?.kind !== 'identifier' ||
            opening?.kind !== 'punctuation' || opening.value !== '('
        ) continue;

        if (constructor.value === 'SharedWorker') {
            // Imported libraries may contain unused SharedWorker code. The sandbox runner
            // reports the limitation only if the package actually constructs one.
            continue;
        }
        if (constructor.value !== 'Worker') continue;

        const nestedNew = tokens[index + 3];
        const urlConstructor = tokens[index + 4];
        const urlOpening = tokens[index + 5];
        const literal = tokens[index + 6];
        const comma = tokens[index + 7];
        if (
            nestedNew?.kind !== 'identifier' || nestedNew.value !== 'new' ||
            urlConstructor?.kind !== 'identifier' || urlConstructor.value !== 'URL' ||
            urlOpening?.kind !== 'punctuation' || urlOpening.value !== '(' ||
            literal?.kind !== 'string' ||
            comma?.kind !== 'punctuation' || comma.value !== ',' ||
            !isImportMetaUrlReference(tokens, index + 8)
        ) {
            // Do not downgrade a package for unused dynamic Worker code. If this
            // constructor runs, the sandbox runner reports it as inconclusive.
            continue;
        }

        const workerUrl = resolvePackageModule(literal.value, moduleUrl, sessionId);
        if (!workerUrl) continue;
        const workerCallEnd = findCallClosingParenthesis(tokens, index + 2, 'Worker constructor');
        const workerCallSource = source.slice(opening.start, workerCallEnd);
        const type = /\btype\s*:\s*(['"])module\1/.test(workerCallSource) ? 'module' : 'classic';
        workers.push({ url: workerUrl, type });
    }
    return { workers, diagnostics };
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new DOMException('Preview module graph was aborted.', 'AbortError');
}

function findSourceReferences(source: string): ModuleReference[] {
    const tokens = tokenize(source);
    const references: ModuleReference[] = [];

    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token?.kind !== 'identifier') continue;

        if (token.value === 'import') {
            const next = tokens[index + 1];
            if (next?.kind === 'punctuation' && next.value === '.') continue;
            if (next?.kind === 'punctuation' && next.value === '(') {
                const literal = tokens[index + 2];
                if (literal?.kind === 'string') {
                    references.push(toReference(literal, 'module'));
                }
                continue;
            }
            if (next?.kind === 'string') {
                references.push(toReference(next, 'module'));
                continue;
            }
            const from = findFollowingToken(tokens, index + 1, 'from');
            const literal = from === -1 ? undefined : tokens[from + 1];
            if (literal?.kind === 'string') references.push(toReference(literal, 'module'));
        } else if (token.value === 'export') {
            const next = tokens[index + 1];
            if (next?.kind !== 'punctuation' || (next.value !== '*' && next.value !== '{')) continue;
            const from = findFollowingToken(tokens, index + 1, 'from');
            const literal = from === -1 ? undefined : tokens[from + 1];
            if (literal?.kind === 'string') references.push(toReference(literal, 'module'));
        } else if (token.value === 'new' && isImportMetaUrl(tokens, index)) {
            const literal = tokens[index + 3];
            const closingParenthesis = tokens[index + 10];
            if (literal?.kind === 'string' && closingParenthesis) {
                references.push({
                    start: token.start,
                    end: closingParenthesis.end,
                    specifier: literal.value,
                    kind: literal.value.endsWith('/') ? 'asset-directory' : 'asset',
                });
            }
        }
    }

    const unique = new Map<number, ModuleReference>();
    for (const reference of references) unique.set(reference.start, reference);
    return [...unique.values()];
}

function findDynamicImportArguments(source: string): Array<{ start: number; end: number }> {
    const tokens = tokenize(source);
    const references: Array<{ start: number; end: number }> = [];
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        const opening = tokens[index + 1];
        const argument = tokens[index + 2];
        if (
            token?.kind !== 'identifier' || token.value !== 'import' ||
            opening?.kind !== 'punctuation' || opening.value !== '(' ||
            argument?.kind === 'string'
        ) continue;
        if (!argument) throw new Error('Dynamic import requires a module specifier.');

        const end = findFirstCallArgumentEnd(tokens, index + 1, 'dynamic import');
        if (end <= argument.start) throw new Error('Dynamic import requires a module specifier.');
        references.push({ start: argument.start, end });
    }
    return references;
}

function findFirstCallArgumentEnd(tokens: Token[], openingIndex: number, callName: string): number {
    let depth = 0;
    for (let index = openingIndex + 1; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token?.kind !== 'punctuation') continue;
        if (token.value === '(' || token.value === '[' || token.value === '{') {
            depth += 1;
        } else if (token.value === ')' || token.value === ']' || token.value === '}') {
            if (token.value === ')' && depth === 0) return token.start;
            depth -= 1;
        } else if (token.value === ',' && depth === 0) {
            return token.start;
        }
    }
    throw new Error(`Unterminated ${callName} expression in preview module.`);
}

function findCallClosingParenthesis(tokens: Token[], openingIndex: number, callName: string): number {
    let depth = 0;
    for (let index = openingIndex; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token?.kind !== 'punctuation') continue;
        if (token.value === '(') depth += 1;
        else if (token.value === ')') {
            depth -= 1;
            if (depth === 0) return token.end;
        }
    }
    throw new Error(`Unterminated ${callName} expression in preview module.`);
}

function findFollowingToken(tokens: Token[], start: number, value: string): number {
    for (let index = start; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (!token || (token.kind === 'punctuation' && token.value === ';')) return -1;
        if (token.kind === 'identifier' && token.value === value) return index;
    }
    return -1;
}

function isImportMetaUrl(tokens: Token[], index: number): boolean {
    const pattern: ReadonlyArray<readonly [Token['kind'], string]> = [
        ['identifier', 'URL'],
        ['punctuation', '('],
        ['string', ''],
        ['punctuation', ','],
        ['identifier', 'import'],
        ['punctuation', '.'],
        ['identifier', 'meta'],
        ['punctuation', '.'],
        ['identifier', 'url'],
        ['punctuation', ')'],
    ];

    return pattern.every(([kind, value], offset) => {
        const token = tokens[index + offset + 1];
        return token?.kind === kind && (kind === 'string' || token.value === value);
    });
}

function isImportMetaUrlReference(tokens: Token[], index: number): boolean {
    const pattern: ReadonlyArray<readonly [Token['kind'], string]> = [
        ['identifier', 'import'],
        ['punctuation', '.'],
        ['identifier', 'meta'],
        ['punctuation', '.'],
        ['identifier', 'url'],
    ];
    return pattern.every(([kind, value], offset) => {
        const token = tokens[index + offset];
        return token?.kind === kind && token.value === value;
    });
}

function isImportMetaResolve(tokens: Token[], index: number): boolean {
    const pattern: ReadonlyArray<readonly [Token['kind'], string]> = [
        ['identifier', 'import'],
        ['punctuation', '.'],
        ['identifier', 'meta'],
        ['punctuation', '.'],
        ['identifier', 'resolve'],
        ['punctuation', '('],
    ];
    return pattern.every(([kind, value], offset) => {
        const token = tokens[index + offset];
        return token?.kind === kind && token.value === value;
    });
}

function toReference(token: Token, kind: ModuleReference['kind']): ModuleReference {
    return { start: token.start, end: token.end, specifier: token.value, kind };
}

function tokenize(source: string): Token[] {
    const tokens: Token[] = [];
    let index = 0;

    while (index < source.length) {
        const character = source[index];
        if (!character) break;
        if (/\s/.test(character)) {
            index += 1;
            continue;
        }
        if (character === '/' && source[index + 1] === '/') {
            index = skipLineComment(source, index + 2);
            continue;
        }
        if (character === '/' && source[index + 1] === '*') {
            index = skipBlockComment(source, index + 2);
            continue;
        }
        if (character === '/' && canStartRegularExpression(tokens[tokens.length - 1])) {
            index = skipRegularExpression(source, index + 1);
            continue;
        }
        if (character === '"' || character === "'") {
            const literal = readString(source, index, character);
            tokens.push(literal.token);
            index = literal.next;
            continue;
        }
        if (character === '`') {
            const template = readTemplateExpressions(source, index + 1);
            tokens.push(...template.tokens);
            index = template.next;
            continue;
        }
        if (/[A-Za-z_$]/.test(character)) {
            const start = index;
            index += 1;
            while (index < source.length && /[A-Za-z\d_$]/.test(source[index] ?? '')) index += 1;
            tokens.push({ kind: 'identifier', value: source.slice(start, index), start, end: index });
            continue;
        }
        if (/\d/.test(character)) {
            const start = index;
            index += 1;
            while (index < source.length && /[\w.]/.test(source[index] ?? '')) index += 1;
            tokens.push({ kind: 'number', value: source.slice(start, index), start, end: index });
            continue;
        }
        tokens.push({ kind: 'punctuation', value: character, start: index, end: index + 1 });
        index += 1;
    }

    return tokens;
}

function readString(source: string, quoteIndex: number, quote: string): { token: Token; next: number } {
    let index = quoteIndex + 1;
    let raw = '';
    while (index < source.length) {
        const character = source[index];
        if (character === quote) {
            return {
                token: {
                    kind: 'string',
                    value: decodeStringLiteral(raw),
                    start: quoteIndex + 1,
                    end: index,
                },
                next: index + 1,
            };
        }
        if (character === '\\') {
            const escaped = source[index + 1];
            if (escaped === undefined) break;
            raw += `${character}${escaped}`;
            index += 2;
            continue;
        }
        if (character === '\n' || character === '\r') break;
        raw += character;
        index += 1;
    }
    throw new Error(`Unterminated JavaScript string literal at source offset ${quoteIndex}.`);
}

function decodeStringLiteral(raw: string): string {
    return raw.replace(/\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([\s\S]))/g, (
        _match,
        unicodePoint: string | undefined,
        unicode: string | undefined,
        hexadecimal: string | undefined,
        escaped: string | undefined,
    ) => {
        if (unicodePoint !== undefined) return String.fromCodePoint(Number.parseInt(unicodePoint, 16));
        if (unicode !== undefined) return String.fromCharCode(Number.parseInt(unicode, 16));
        if (hexadecimal !== undefined) return String.fromCharCode(Number.parseInt(hexadecimal, 16));
        switch (escaped) {
            case 'b': return '\b';
            case 'f': return '\f';
            case 'n': return '\n';
            case 'r': return '\r';
            case 't': return '\t';
            case 'v': return '\v';
            case '\n':
            case '\r': return '';
            default: return escaped ?? '';
        }
    });
}

function skipLineComment(source: string, index: number): number {
    while (index < source.length && source[index] !== '\n') index += 1;
    return index;
}

function skipBlockComment(source: string, index: number): number {
    const end = source.indexOf('*/', index);
    return end < 0 ? source.length : end + 2;
}

function readTemplateExpressions(source: string, index: number): { tokens: Token[]; next: number } {
    const tokens: Token[] = [];
    while (index < source.length) {
        if (source[index] === '\\') index += 2;
        else if (source[index] === '`') return { tokens, next: index + 1 };
        else if (source[index] === '$' && source[index + 1] === '{') {
            const expressionStart = index + 2;
            const expressionEnd = findTemplateExpressionEnd(source, expressionStart);
            for (const token of tokenize(source.slice(expressionStart, expressionEnd))) {
                tokens.push({
                    ...token,
                    start: token.start + expressionStart,
                    end: token.end + expressionStart,
                });
            }
            index = expressionEnd + 1;
        } else index += 1;
    }
    throw new Error('Unterminated JavaScript template literal in preview module.');
}

function findTemplateExpressionEnd(source: string, index: number): number {
    let depth = 1;
    const tokens: Token[] = [];
    while (index < source.length) {
        const character = source[index];
        if (!character) break;
        if (/\s/.test(character)) {
            index += 1;
            continue;
        }
        if (character === '"' || character === "'") {
            const literal = readString(source, index, character);
            tokens.push(literal.token);
            index = literal.next;
            continue;
        }
        if (character === '`') {
            index = readTemplateExpressions(source, index + 1).next;
            continue;
        }
        if (character === '/' && source[index + 1] === '/') {
            index = skipLineComment(source, index + 2);
            continue;
        }
        if (character === '/' && source[index + 1] === '*') {
            index = skipBlockComment(source, index + 2);
            continue;
        }
        if (character === '/' && canStartRegularExpression(tokens[tokens.length - 1])) {
            const start = index;
            index = skipRegularExpression(source, index + 1);
            tokens.push({ kind: 'string', value: '', start, end: index });
            continue;
        }
        if (/[A-Za-z_$]/.test(character)) {
            const start = index;
            index += 1;
            while (index < source.length && /[A-Za-z\d_$]/.test(source[index] ?? '')) index += 1;
            tokens.push({ kind: 'identifier', value: source.slice(start, index), start, end: index });
            continue;
        }
        if (/\d/.test(character)) {
            const start = index;
            index += 1;
            while (index < source.length && /[\w.]/.test(source[index] ?? '')) index += 1;
            tokens.push({ kind: 'number', value: source.slice(start, index), start, end: index });
            continue;
        }
        if (character === '{') depth += 1;
        else if (character === '}') {
            depth -= 1;
            if (depth === 0) return index;
        }
        tokens.push({ kind: 'punctuation', value: character, start: index, end: index + 1 });
        index += 1;
    }
    throw new Error('Unterminated JavaScript template expression in preview module.');
}

function skipRegularExpression(source: string, index: number): number {
    let inCharacterClass = false;
    while (index < source.length) {
        const character = source[index];
        if (character === '\\') index += 2;
        else if (character === '[') { inCharacterClass = true; index += 1; }
        else if (character === ']') { inCharacterClass = false; index += 1; }
        else if (character === '/' && !inCharacterClass) {
            index += 1;
            while (index < source.length && /[A-Za-z]/.test(source[index] ?? '')) index += 1;
            return index;
        } else index += 1;
    }
    return source.length;
}

function canStartRegularExpression(previous: Token | undefined): boolean {
    if (!previous) return true;
    if (previous.kind === 'string' || previous.kind === 'number') return false;
    if (previous.kind === 'identifier') {
        return ['await', 'case', 'delete', 'else', 'in', 'instanceof', 'of', 'return', 'throw', 'typeof', 'void', 'yield']
            .includes(previous.value);
    }
    return previous.value !== ')' && previous.value !== ']' && previous.value !== '}';
}
