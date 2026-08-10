export const PREVIEW_PREFIX = '/__ograf_preview__/';
export const PREVIEW_PROTOCOL_VERSION = 3;

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export class PreviewResourceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PreviewResourceError';
    }
}

export function createPreviewSessionId(): string {
    if (typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID().replace(/-/g, '');
    }

    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(18));

    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Per-tab/session authentication token used by the file broker protocol. */
export function createPreviewSecurityToken(): string {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));

    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function assertPreviewSessionId(sessionId: string): string {
    if (!SESSION_ID_PATTERN.test(sessionId)) {
        throw new PreviewResourceError('Invalid preview session id.');
    }

    return sessionId;
}

/**
 * Normalize a package-relative resource path before it reaches BrowserFS.
 * Unicode is normalized to NFC so URL-encoded and manifest-provided paths use
 * one representation. Absolute paths and any parent traversal are rejected.
 */
export function normalizePreviewPath(input: string): string {
    if (typeof input !== 'string' || input.length === 0) {
        throw new PreviewResourceError('Preview resource path must not be empty.');
    }
    if (input.length > 4096 || CONTROL_CHARACTER_PATTERN.test(input)) {
        throw new PreviewResourceError('Preview resource path contains invalid characters.');
    }

    const normalized = input.replace(/\\/g, '/').normalize('NFC');
    if (
        normalized.startsWith('/') ||
        normalized.startsWith('//') ||
        /^[A-Za-z]:\//.test(normalized) ||
        /^[A-Za-z][A-Za-z\d+.-]*:/.test(normalized)
    ) {
        throw new PreviewResourceError('Absolute preview resource paths are not allowed.');
    }

    const segments: string[] = [];
    for (const segment of normalized.split('/')) {
        if (segment === '' || segment === '.') continue;
        if (segment === '..') {
            throw new PreviewResourceError('Parent traversal is not allowed in preview resource paths.');
        }
        if (CONTROL_CHARACTER_PATTERN.test(segment)) {
            throw new PreviewResourceError('Preview resource path contains invalid characters.');
        }
        segments.push(segment);
    }

    if (segments.length === 0) {
        throw new PreviewResourceError('Preview resource path must resolve to a file.');
    }

    return segments.join('/');
}

export function encodePreviewPath(path: string): string {
    return normalizePreviewPath(path)
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
}

function currentOrigin(): string {
    const origin = globalThis.location?.origin;
    if (!origin || origin === 'null') {
        throw new PreviewResourceError('A concrete application origin is required for preview URLs.');
    }

    return origin;
}

export function buildPreviewResourceUrl(
    path: string,
    sessionId: string,
    origin = currentOrigin(),
): string {
    const safeSessionId = assertPreviewSessionId(sessionId);
    const encodedPath = encodePreviewPath(path);

    return `${origin}${PREVIEW_PREFIX}${safeSessionId}/${encodedPath}`;
}

export interface ParsedPreviewResourceUrl {
    sessionId: string;
    path: string;
}

export function parsePreviewResourceUrl(
    input: string,
    origin = currentOrigin(),
): ParsedPreviewResourceUrl {
    const url = new URL(input, origin);
    if (url.origin !== origin || !url.pathname.startsWith(PREVIEW_PREFIX)) {
        throw new PreviewResourceError('URL is not an OGraf preview resource URL.');
    }

    const encodedRemainder = url.pathname.slice(PREVIEW_PREFIX.length);
    const separator = encodedRemainder.indexOf('/');
    if (separator <= 0 || separator === encodedRemainder.length - 1) {
        throw new PreviewResourceError('Preview resource URL is missing a session or file path.');
    }

    const sessionId = assertPreviewSessionId(encodedRemainder.slice(0, separator));
    const encodedPath = encodedRemainder.slice(separator + 1);
    let decodedPath: string;
    try {
        decodedPath = encodedPath
            .split('/')
            .map((segment) => decodeURIComponent(segment))
            .join('/');
    } catch {
        throw new PreviewResourceError('Preview resource URL contains invalid percent encoding.');
    }

    return { sessionId, path: normalizePreviewPath(decodedPath) };
}
