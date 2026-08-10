import { PREVIEW_PROTOCOL_VERSION } from './preview-resources.js';

export interface PreviewFileRequest {
    protocol: number;
    type: 'OGRAF_PREVIEW_FILE_REQUEST';
    requestId: string;
    sessionId: string;
    path: string;
    tabToken?: string;
}

export interface PreviewFileResponse {
    protocol: number;
    type: 'OGRAF_PREVIEW_FILE_RESPONSE';
    requestId: string;
    sessionId: string;
    path: string;
    tabToken: string;
    buffer?: ArrayBuffer;
    error?: string;
}

export function isPreviewFileRequest(value: unknown): value is PreviewFileRequest {
    if (typeof value !== 'object' || value === null) return false;
    const message = value as Record<string, unknown>;
    return message['protocol'] === PREVIEW_PROTOCOL_VERSION &&
        message['type'] === 'OGRAF_PREVIEW_FILE_REQUEST' &&
        typeof message['requestId'] === 'string' &&
        typeof message['sessionId'] === 'string' &&
        typeof message['path'] === 'string' &&
        (message['tabToken'] === undefined || typeof message['tabToken'] === 'string');
}

/** A missing target token is a first-response fallback after a SW restart. */
export function requestTargetsTab(request: PreviewFileRequest, tabToken: string): boolean {
    return request.tabToken === undefined || request.tabToken === tabToken;
}
