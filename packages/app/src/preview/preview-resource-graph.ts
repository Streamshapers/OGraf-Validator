import postcss, { type AtRule, type Declaration, type Root } from 'postcss';
import valueParser, { type Node as ValueNode } from 'postcss-value-parser';
import { parsePreviewResourceUrl } from './preview-resources.js';
import { previewMimeTypeForPath } from './preview-module-graph.js';

const MAX_STYLESHEETS = 128;
const MAX_ASSETS = 512;
const MAX_GRAPH_BYTES = 32 * 1024 * 1024;

export interface PreviewResourceGraphErrorShape {
    code: string;
    resourceKind: 'stylesheet' | 'asset';
    path: string;
    message: string;
}

export class PreviewResourceGraphError extends Error implements PreviewResourceGraphErrorShape {
    readonly code: string;
    readonly resourceKind: 'stylesheet' | 'asset';
    readonly path: string;

    constructor(shape: PreviewResourceGraphErrorShape) {
        super(shape.message);
        this.name = 'PreviewResourceGraphError';
        this.code = shape.code;
        this.resourceKind = shape.resourceKind;
        this.path = shape.path;
    }
}

export interface PreviewResourceGraphAsset {
    id: string;
    url: string;
    path: string;
    mimeType: string;
    buffer: ArrayBuffer;
}

export interface PreviewResourceGraphStylesheet {
    id: string;
    url: string;
    source: string;
}

export interface PreviewCssResourceGraph {
    entryId: string;
    stylesheets: PreviewResourceGraphStylesheet[];
    assets: PreviewResourceGraphAsset[];
    warnings: string[];
}

export interface BuildPreviewCssGraphOptions {
    sessionId: string;
    baseUrl: string;
    entryUrl?: string;
    source?: string;
    readFile: (path: string) => Promise<ArrayBuffer>;
    signal?: AbortSignal;
}

interface LocalResource {
    url: string;
    path: string;
}

/** Build a dependency-first stylesheet graph for one isolated preview session. */
export async function buildPreviewCssGraph(
    options: BuildPreviewCssGraphOptions,
): Promise<PreviewCssResourceGraph> {
    if ((options.entryUrl === undefined) === (options.source === undefined)) {
        throw new Error('Exactly one CSS entry URL or inline source is required.');
    }

    const stylesheets: PreviewResourceGraphStylesheet[] = [];
    const assets: PreviewResourceGraphAsset[] = [];
    const warnings: string[] = [];
    const stylesheetIds = new Map<string, string>();
    const stylesheetSources = new Map<string, string>();
    const assetIds = new Map<string, string>();
    const active = new Set<string>();
    let graphBytes = 0;

    const addBytes = (amount: number, path: string, kind: 'stylesheet' | 'asset') => {
        graphBytes += amount;
        if (graphBytes > MAX_GRAPH_BYTES) {
            throw resourceError('RESOURCE_GRAPH_TOO_LARGE', kind, path, `Preview resource graph exceeds ${MAX_GRAPH_BYTES} bytes.`);
        }
    };

    const loadAsset = async (resource: LocalResource): Promise<string> => {
        const existing = assetIds.get(resource.url);
        if (existing) return existing;
        if (assets.length >= MAX_ASSETS) {
            throw resourceError('TOO_MANY_ASSETS', 'asset', resource.path, `Preview resource graph exceeds ${MAX_ASSETS} assets.`);
        }
        throwIfAborted(options.signal);
        const buffer = await readResource(options, resource, 'asset');
        addBytes(buffer.byteLength, resource.path, 'asset');
        const id = `asset-${assets.length}`;
        assetIds.set(resource.url, id);
        assets.push({
            id,
            url: resource.url,
            path: resource.path,
            mimeType: previewMimeTypeForPath(resource.path),
            buffer,
        });
        return id;
    };

    const loadStylesheet = async (
        key: string,
        stylesheetUrl: string,
        inlineSource?: string,
    ): Promise<string> => {
        const existing = stylesheetIds.get(key);
        if (existing) return existing;
        if (stylesheets.length + active.size >= MAX_STYLESHEETS) {
            throw resourceError('TOO_MANY_STYLESHEETS', 'stylesheet', key, `Preview resource graph exceeds ${MAX_STYLESHEETS} stylesheets.`);
        }
        const id = `style-${stylesheetIds.size}`;
        stylesheetIds.set(key, id);
        active.add(key);

        let source = inlineSource;
        let path = key;
        if (source === undefined) {
            const resource = assertLocalResource(stylesheetUrl, options.sessionId, options.baseUrl, 'stylesheet');
            path = resource.path;
            const buffer = await readResource(options, resource, 'stylesheet');
            addBytes(buffer.byteLength, resource.path, 'stylesheet');
            source = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        } else {
            addBytes(new TextEncoder().encode(source).byteLength, '<inline style>', 'stylesheet');
        }

        let root: Root;
        try {
            root = postcss.parse(source, { from: undefined, map: false });
        } catch (error) {
            throw resourceError(
                'INVALID_STYLESHEET',
                'stylesheet',
                path,
                `Could not parse stylesheet "${path}": ${readErrorMessage(error)}`,
            );
        }

        const imports: AtRule[] = [];
        root.walkAtRules('import', (rule) => { imports.push(rule); });
        for (const rule of imports) {
            throwIfAborted(options.signal);
            const reference = readImportReference(rule.params);
            if (!reference) continue;
            const resource = resolveLocalResource(reference.url, stylesheetUrl, options.sessionId);
            if (!resource) continue;
            if (active.has(resource.url)) {
                rule.remove();
                warnings.push(`Ignored circular CSS import "${resource.path}".`);
                continue;
            }
            const dependencyId = await loadStylesheet(resource.url, resource.url);
            const dependencySource = stylesheetSources.get(dependencyId);
            if (dependencySource === undefined) {
                throw resourceError('INVALID_STYLESHEET_GRAPH', 'stylesheet', resource.path, 'Imported stylesheet was not prepared.');
            }
            const importedRoot = postcss.parse(dependencySource, { from: undefined, map: false });
            const condition = rule.params.slice(reference.end).trim();
            if (condition) {
                const media = postcss.atRule({ name: 'media', params: condition });
                media.append(importedRoot.nodes);
                rule.replaceWith(media);
            } else {
                rule.replaceWith(...importedRoot.nodes);
            }
        }

        const declarations: Declaration[] = [];
        root.walkDecls((declaration) => { declarations.push(declaration); });
        for (const declaration of declarations) {
            declaration.value = await rewriteCssUrls(
                declaration.value,
                stylesheetUrl,
                options.sessionId,
                loadAsset,
                options.signal,
            );
        }

        active.delete(key);
        const preparedSource = root.toString();
        stylesheetSources.set(id, preparedSource);
        stylesheets.push({ id, url: stylesheetUrl, source: preparedSource });
        return id;
    };

    const entryUrl = options.entryUrl ?? options.baseUrl;
    const entryKey = options.entryUrl ?? `inline:${options.baseUrl}:${options.source?.length ?? 0}`;
    const entryId = await loadStylesheet(entryKey, entryUrl, options.source);
    return { entryId, stylesheets, assets, warnings };
}

async function rewriteCssUrls(
    source: string,
    baseUrl: string,
    sessionId: string,
    loadAsset: (resource: LocalResource) => Promise<string>,
    signal?: AbortSignal,
): Promise<string> {
    const parsed = valueParser(source);
    const nodes: Array<Extract<ValueNode, { type: 'function' }>> = [];
    parsed.walk((node) => {
        if (node.type === 'function' && node.value.toLowerCase() === 'url') nodes.push(node);
    });
    for (const node of nodes) {
        throwIfAborted(signal);
        const value = valueParser.stringify(node.nodes).trim().replace(/^(['"])(.*)\1$/, '$2');
        const resource = resolveLocalResource(value, baseUrl, sessionId);
        if (!resource) continue;
        const assetId = await loadAsset(resource);
        node.nodes = [{ type: 'string', quote: '"', value: `__OGRAF_ASSET_${assetId}__`, sourceIndex: 0, sourceEndIndex: 0 }];
    }
    return parsed.toString();
}

function readImportReference(params: string): { start: number; end: number; url: string } | undefined {
    const parsed = valueParser(params);
    const first = parsed.nodes.find((node) => node.type !== 'space' && node.type !== 'comment');
    if (!first) return undefined;
    if (first.type === 'string') {
        return { start: first.sourceIndex, end: first.sourceEndIndex, url: first.value };
    }
    if (first.type === 'function' && first.value.toLowerCase() === 'url') {
        const url = valueParser.stringify(first.nodes).trim().replace(/^(['"])(.*)\1$/, '$2');
        return { start: first.sourceIndex, end: first.sourceEndIndex, url };
    }
    return undefined;
}

function resolveLocalResource(value: string, baseUrl: string, sessionId: string): LocalResource | undefined {
    if (!value || value.startsWith('#') || value.startsWith('__OGRAF_') || /^(?:data|blob):/i.test(value)) return undefined;
    let resolved: URL;
    try {
        resolved = new URL(value, baseUrl);
    } catch {
        return undefined;
    }
    let parsed;
    try {
        parsed = parsePreviewResourceUrl(resolved.toString(), new URL(baseUrl).origin);
    } catch {
        if (!/^(?:[A-Za-z][A-Za-z\d+.-]*:|\/)/.test(value)) {
            throw resourceError(
                'SESSION_ESCAPE',
                'asset',
                value,
                `CSS resource "${value}" escapes the active preview session.`,
            );
        }
        return undefined;
    }
    if (parsed.sessionId !== sessionId) {
        throw resourceError(
            'SESSION_ESCAPE',
            'asset',
            value,
            `CSS resource "${value}" escapes the active preview session.`,
        );
    }
    return { url: resolved.toString(), path: parsed.path };
}

function assertLocalResource(
    url: string,
    sessionId: string,
    origin: string,
    kind: 'stylesheet' | 'asset',
): LocalResource {
    try {
        const parsed = parsePreviewResourceUrl(url, new URL(origin).origin);
        if (parsed.sessionId !== sessionId) throw new Error('session mismatch');
        return { url: new URL(url).toString(), path: parsed.path };
    } catch {
        throw resourceError('INVALID_RESOURCE_URL', kind, url, `Resource "${url}" is outside the active preview session.`);
    }
}

async function readResource(
    options: BuildPreviewCssGraphOptions,
    resource: LocalResource,
    kind: 'stylesheet' | 'asset',
): Promise<ArrayBuffer> {
    throwIfAborted(options.signal);
    try {
        return await options.readFile(resource.path);
    } catch (error) {
        throw resourceError(
            'RESOURCE_READ_FAILED',
            kind,
            resource.path,
            `Could not read ${kind} "${resource.path}": ${readErrorMessage(error)}`,
        );
    }
}

function resourceError(
    code: string,
    resourceKind: 'stylesheet' | 'asset',
    path: string,
    message: string,
): PreviewResourceGraphError {
    return new PreviewResourceGraphError({ code, resourceKind, path, message });
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new DOMException('Preview resource graph was aborted.', 'AbortError');
}

function readErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
