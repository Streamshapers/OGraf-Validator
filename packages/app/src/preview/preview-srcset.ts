import { parsePreviewResourceUrl } from './preview-resources.js';
import { previewMimeTypeForPath } from './preview-module-graph.js';

export interface PreviewSrcsetCandidate {
    url: string;
    descriptor: string;
}

export interface PreparedPreviewSrcsetCandidate extends PreviewSrcsetCandidate {
    originalUrl: string;
    buffer?: ArrayBuffer;
    mimeType?: string;
}

export interface PreparedPreviewSrcset {
    candidates: PreparedPreviewSrcsetCandidate[];
}

const ASCII_WHITESPACE = /[\t\n\f\r ]/;

/**
 * Parse an HTML srcset value without splitting data URLs at their comma.
 * Descriptors are intentionally kept as source text so density and width
 * candidates round-trip without the validator choosing an image itself.
 */
export function parsePreviewSrcset(input: string): PreviewSrcsetCandidate[] {
    const candidates: PreviewSrcsetCandidate[] = [];
    let position = 0;

    while (position < input.length) {
        while (
            position < input.length &&
            (ASCII_WHITESPACE.test(input[position] ?? '') || input[position] === ',')
        ) position += 1;
        if (position >= input.length) break;

        const urlStart = position;
        while (position < input.length && !ASCII_WHITESPACE.test(input[position] ?? '')) position += 1;
        let url = input.slice(urlStart, position);

        // For normal URLs a trailing comma terminates the candidate. A comma
        // inside a data URL belongs to the URL and must be retained.
        if (!url.toLowerCase().startsWith('data:')) {
            const trimmed = url.replace(/,+$/, '');
            const endedByComma = trimmed.length !== url.length;
            url = trimmed;
            if (endedByComma) {
                if (url) candidates.push({ url, descriptor: '' });
                continue;
            }
        }

        while (position < input.length && ASCII_WHITESPACE.test(input[position] ?? '')) position += 1;
        const descriptorStart = position;
        let parentheses = 0;
        while (position < input.length) {
            const character = input[position];
            if (character === '(') parentheses += 1;
            else if (character === ')' && parentheses > 0) parentheses -= 1;
            else if (character === ',' && parentheses === 0) break;
            position += 1;
        }
        const descriptor = input.slice(descriptorStart, position).trim();
        if (position < input.length && input[position] === ',') position += 1;
        if (url) candidates.push({ url, descriptor });
    }

    return candidates;
}

export function serializePreviewSrcset(candidates: PreviewSrcsetCandidate[]): string {
    return candidates
        .map(({ url, descriptor }) => descriptor ? `${url} ${descriptor}` : url)
        .join(', ');
}

export async function preparePreviewSrcset(
    source: string,
    baseUrl: string,
    sessionId: string,
    readFile: (path: string) => Promise<ArrayBuffer>,
    signal?: AbortSignal,
): Promise<PreparedPreviewSrcset> {
    const candidates: PreparedPreviewSrcsetCandidate[] = [];
    for (const candidate of parsePreviewSrcset(source)) {
        throwIfAborted(signal);
        const resolved = resolveLocalCandidate(candidate.url, baseUrl, sessionId);
        if (!resolved) {
            candidates.push({ ...candidate, originalUrl: candidate.url });
            continue;
        }
        const buffer = await readFile(resolved.path);
        candidates.push({
            ...candidate,
            originalUrl: candidate.url,
            url: resolved.url,
            buffer,
            mimeType: previewMimeTypeForPath(resolved.path),
        });
    }
    return { candidates };
}

function resolveLocalCandidate(
    value: string,
    baseUrl: string,
    sessionId: string,
): { url: string; path: string } | undefined {
    if (
        value.startsWith('#') ||
        /^(?:data|blob):/i.test(value)
    ) return undefined;

    let url: URL;
    try {
        url = new URL(value, baseUrl);
    } catch {
        return undefined;
    }
    let parsed;
    try {
        parsed = parsePreviewResourceUrl(url.toString(), new URL(baseUrl).origin);
    } catch {
        if (!/^(?:[A-Za-z][A-Za-z\d+.-]*:|\/)/.test(value)) {
            throw new Error(`srcset candidate "${value}" escapes the active preview session.`);
        }
        return undefined;
    }
    if (parsed.sessionId !== sessionId) {
        throw new Error(`srcset candidate "${value}" escapes the active preview session.`);
    }
    return { url: url.toString(), path: parsed.path };
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new DOMException('Preview srcset preparation was aborted.', 'AbortError');
}
