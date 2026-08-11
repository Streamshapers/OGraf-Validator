/* OGraf preview file bridge. Served as a classic Service Worker. */
'use strict';

const PREVIEW_PREFIX = '/__ograf_preview__/';
const PROTOCOL_VERSION = 4;
const REQUEST_TIMEOUT_MS = 10_000;
const SESSION_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const sessionRegistrations = new Map();
const pendingRequests = new Map();

const MIME_TYPES = Object.freeze({
    avif: 'image/avif',
    bmp: 'image/bmp',
    css: 'text/css; charset=utf-8',
    gif: 'image/gif',
    glb: 'model/gltf-binary',
    gltf: 'model/gltf+json',
    html: 'text/html; charset=utf-8',
    ico: 'image/x-icon',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    js: 'text/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    m4a: 'audio/mp4',
    mjs: 'text/javascript; charset=utf-8',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    oga: 'audio/ogg',
    ogg: 'audio/ogg',
    ogv: 'video/ogg',
    otf: 'font/otf',
    png: 'image/png',
    svg: 'image/svg+xml; charset=utf-8',
    ttf: 'font/ttf',
    txt: 'text/plain; charset=utf-8',
    wasm: 'application/wasm',
    wav: 'audio/wav',
    webm: 'video/webm',
    webp: 'image/webp',
    woff: 'font/woff',
    woff2: 'font/woff2',
    xml: 'application/xml; charset=utf-8',
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object' || message.protocol !== PROTOCOL_VERSION) return;

    if (message.type === 'OGRAF_PREVIEW_SESSION_REGISTER') {
        const clientId = clientIdOf(event.source);
        if (
            clientId === null ||
            !SESSION_PATTERN.test(message.sessionId) ||
            !TOKEN_PATTERN.test(message.tabToken)
        ) return;
        sessionRegistrations.set(message.sessionId, { clientId, tabToken: message.tabToken });
    } else if (
        message.type === 'OGRAF_PREVIEW_SESSION_UNREGISTER' &&
        SESSION_PATTERN.test(message.sessionId) &&
        TOKEN_PATTERN.test(message.tabToken)
    ) {
        const registration = sessionRegistrations.get(message.sessionId);
        const clientId = clientIdOf(event.source);
        if (
            registration?.tabToken === message.tabToken &&
            clientId !== null &&
            registration.clientId === clientId
        ) {
            sessionRegistrations.delete(message.sessionId);
        }
    } else if (message.type === 'OGRAF_PREVIEW_FILE_RESPONSE') {
        receiveFileResponse(event);
    }
});

self.addEventListener('fetch', (event) => {
    let url;
    try {
        url = new URL(event.request.url);
    } catch {
        return;
    }
    if (!url.pathname.startsWith(PREVIEW_PREFIX)) return;
    event.respondWith(safelyServePreviewResource(event.request, url));
});

async function safelyServePreviewResource(request, url) {
    try {
        return await servePreviewResource(request, url);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = /not found|does not exist/i.test(message) ? 404 : 504;
        return response(message, status, 'text/plain; charset=utf-8');
    }
}

async function servePreviewResource(request, url) {
    let parsed;
    try {
        parsed = parsePreviewPath(url.pathname);
    } catch (error) {
        return response(String(error instanceof Error ? error.message : error), 400, 'text/plain; charset=utf-8');
    }

    if (request.method === 'OPTIONS') {
        return response(null, 204, 'text/plain; charset=utf-8');
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return response('Method not allowed.', 405, 'text/plain; charset=utf-8');
    }

    const result = await requestPackageFile(parsed.sessionId, parsed.path);
    const size = result.byteLength;
    const rangeHeader = request.headers.get('Range');
    if (rangeHeader) {
        const range = parseByteRange(rangeHeader, size);
        if (!range) {
            return response(null, 416, mimeType(parsed.path), {
                'Accept-Ranges': 'bytes',
                'Content-Range': `bytes */${size}`,
                'Content-Length': '0',
            });
        }
        const slice = result.slice(range.start, range.end + 1);
        return response(request.method === 'HEAD' ? null : slice, 206, mimeType(parsed.path), {
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
            'Content-Length': String(slice.byteLength),
        });
    }

    return response(request.method === 'HEAD' ? null : result, 200, mimeType(parsed.path), {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(size),
    });
}

function requestPackageFile(sessionId, path) {
    const requestId = createRequestId();

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            const pending = pendingRequests.get(requestId);
            if (!pending) return;
            pendingRequests.delete(requestId);
            pending.reject(new Error('Timed out waiting for the package file broker.'));
        }, REQUEST_TIMEOUT_MS);

        pendingRequests.set(requestId, {
            sessionId,
            path,
            targetClientId: null,
            targetToken: null,
            timeout,
            resolve,
            reject,
        });

        void dispatchFileRequest(requestId, sessionId, path).catch((error) => {
            rejectPendingRequest(requestId, error);
        });
    });
}

async function dispatchFileRequest(requestId, sessionId, path) {
    const registration = sessionRegistrations.get(sessionId);
    if (registration) {
        const client = await self.clients.get(registration.clientId);
        if (client) {
            const pending = pendingRequests.get(requestId);
            if (!pending) return;
            pending.targetClientId = registration.clientId;
            pending.targetToken = registration.tabToken;
            try {
                client.postMessage(fileRequestMessage(requestId, sessionId, path, registration.tabToken));
                return;
            } catch {
                // The registered parent disappeared between lookup and delivery.
            }
        }
        if (sessionRegistrations.get(sessionId) === registration) {
            sessionRegistrations.delete(sessionId);
        }
    }

    const pending = pendingRequests.get(requestId);
    if (!pending) return;
    pending.targetClientId = null;
    pending.targetToken = null;

    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length === 0) throw new Error('No window client is available for the package file broker.');

    const message = fileRequestMessage(requestId, sessionId, path);
    let delivered = false;
    for (const client of clients) {
        try {
            client.postMessage(message);
            delivered = true;
        } catch {
            // A fallback request only needs one live owner of this session.
        }
    }
    if (!delivered) throw new Error('Package file request could not be delivered to a window client.');
}

function fileRequestMessage(requestId, sessionId, path, tabToken) {
    return {
        protocol: PROTOCOL_VERSION,
        type: 'OGRAF_PREVIEW_FILE_REQUEST',
        requestId,
        sessionId,
        path,
        ...(tabToken === undefined ? {} : { tabToken }),
    };
}

function receiveFileResponse(event) {
    const message = event.data;
    const pending = pendingRequests.get(message.requestId);
    if (!pending) return;

    const sourceClientId = clientIdOf(event.source);
    if (
        sourceClientId === null ||
        message.sessionId !== pending.sessionId ||
        message.path !== pending.path ||
        !TOKEN_PATTERN.test(message.tabToken) ||
        (pending.targetClientId !== null && sourceClientId !== pending.targetClientId) ||
        (pending.targetToken !== null && message.tabToken !== pending.targetToken)
    ) return;

    pendingRequests.delete(message.requestId);
    clearTimeout(pending.timeout);
    if (pending.targetClientId === null && pending.targetToken === null) {
        sessionRegistrations.set(pending.sessionId, {
            clientId: sourceClientId,
            tabToken: message.tabToken,
        });
    }
    if (typeof message.error === 'string') {
        pending.reject(new Error(message.error));
    } else if (message.buffer instanceof ArrayBuffer) {
        pending.resolve(message.buffer);
    } else {
        pending.reject(new Error('Package file broker returned an invalid response.'));
    }
}

function rejectPendingRequest(requestId, error) {
    const pending = pendingRequests.get(requestId);
    if (!pending) return;
    pendingRequests.delete(requestId);
    clearTimeout(pending.timeout);
    pending.reject(error instanceof Error ? error : new Error(String(error)));
}

function clientIdOf(source) {
    return source && typeof source.id === 'string' && source.id.length > 0 ? source.id : null;
}

function parsePreviewPath(pathname) {
    const remainder = pathname.slice(PREVIEW_PREFIX.length);
    const separator = remainder.indexOf('/');
    if (separator <= 0 || separator === remainder.length - 1) throw new Error('Preview URL is missing a session or file path.');

    const sessionId = remainder.slice(0, separator);
    if (!SESSION_PATTERN.test(sessionId)) throw new Error('Invalid preview session id.');

    let decoded;
    try {
        decoded = remainder.slice(separator + 1)
            .split('/')
            .map((segment) => decodeURIComponent(segment))
            .join('/');
    } catch {
        throw new Error('Preview path contains invalid percent encoding.');
    }

    return { sessionId, path: normalizePath(decoded) };
}

function normalizePath(input) {
    if (typeof input !== 'string' || input.length === 0 || input.length > 4096 || CONTROL_PATTERN.test(input)) {
        throw new Error('Invalid preview resource path.');
    }
    const normalized = input.replace(/\\/g, '/').normalize('NFC');
    if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || /^[A-Za-z][A-Za-z\d+.-]*:/.test(normalized)) {
        throw new Error('Absolute preview paths are not allowed.');
    }
    const segments = [];
    for (const segment of normalized.split('/')) {
        if (segment === '' || segment === '.') continue;
        if (segment === '..') throw new Error('Parent traversal is not allowed.');
        segments.push(segment);
    }
    if (segments.length === 0) throw new Error('Preview path must resolve to a file.');
    return segments.join('/');
}

function mimeType(path) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    const extension = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
    return MIME_TYPES[extension] || 'application/octet-stream';
}

function parseByteRange(header, size) {
    if (!Number.isSafeInteger(size) || size < 0 || !header.startsWith('bytes=') || header.includes(',')) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match || (match[1] === '' && match[2] === '') || size === 0) return null;

    if (match[1] === '') {
        const suffixLength = Number(match[2]);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
        return { start: Math.max(0, size - suffixLength), end: size - 1 };
    }

    const start = Number(match[1]);
    const requestedEnd = match[2] === '' ? size - 1 : Number(match[2]);
    if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(requestedEnd) ||
        start < 0 ||
        start >= size ||
        requestedEnd < start
    ) return null;
    return { start, end: Math.min(requestedEnd, size - 1) };
}

function response(body, status, contentType, additionalHeaders = {}) {
    return new Response(body, {
        status,
        headers: {
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range',
            'Cache-Control': 'no-store',
            'Content-Type': contentType,
            'Cross-Origin-Resource-Policy': 'cross-origin',
            'X-Content-Type-Options': 'nosniff',
            ...additionalHeaders,
        },
    });
}

function createRequestId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
