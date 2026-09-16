import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../../public/preview-sw.js', import.meta.url), 'utf8');
const sessionId = '0123456789abcdef';
const tabToken = 'a'.repeat(64);
const resourceUrl = `https://validator.test/__ograf_preview__/${sessionId}/asset.txt`;

interface WorkerEvent {
    data?: unknown;
    source?: { id: string };
    request?: Request;
    respondWith?: (response: Promise<Response>) => void;
}

function createWorker(reply: { error?: string; buffer?: ArrayBuffer } = {}) {
    const handlers = new Map<string, (event: WorkerEvent) => void>();
    const warn = vi.fn();
    const client = {
        id: 'package-owner',
        postMessage(message: Record<string, unknown>) {
            queueMicrotask(() => handlers.get('message')?.({
                source: client,
                data: { ...message, type: 'OGRAF_PREVIEW_FILE_RESPONSE', tabToken, ...reply },
            }));
        },
    };
    const getClient = vi.fn(async () => client);
    runInContext(source, createContext({
        URL, Response, ArrayBuffer, Uint8Array, Error, crypto, setTimeout, clearTimeout,
        console: { warn },
        self: {
            addEventListener: (type: string, handler: (event: WorkerEvent) => void) => handlers.set(type, handler),
            clients: { get: getClient, matchAll: async () => [client] },
        },
    }));
    handlers.get('message')?.({
        source: client,
        data: { protocol: 4, type: 'OGRAF_PREVIEW_SESSION_REGISTER', sessionId, tabToken },
    });

    return {
        warn,
        getClient,
        fetch: (url = resourceUrl, method = 'GET') => new Promise<Response>((resolve) => {
            handlers.get('fetch')?.({ request: new Request(url, { method }), respondWith: resolve });
        }),
    };
}

describe('preview Service Worker error responses', () => {
    it.each([
        ['File not found: private/customer/asset.txt', 404, 'Preview resource not found.'],
        ['Permission denied: private/customer/asset.txt\n    at secretBroker()', 504, 'Preview resource unavailable.'],
    ] as const)('keeps broker details out of the response: %s', async (error, status, body) => {
        const worker = createWorker({ error });
        const result = await worker.fetch();
        expect(result.status).toBe(status);
        expect(await result.text()).toBe(body);
        expect(worker.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ message: error }));
    });

    it('does not expose unexpected broker lookup exceptions', async () => {
        const worker = createWorker();
        const error = new Error('Internal client lookup: private-token');
        worker.getClient.mockRejectedValue(error);
        const result = await worker.fetch();
        expect(result.status).toBe(504);
        expect(await result.text()).toBe('Preview resource unavailable.');
        expect(worker.warn).toHaveBeenCalledWith(expect.any(String), error);
    });

    it.each([
        'missing-file',
        'short/asset.txt',
        `${sessionId}/%GG`,
        `${sessionId}/%2e%2e%2fprivate.txt`,
    ])('returns a fixed message for malformed paths: %s', async (path) => {
        const worker = createWorker();
        const result = await worker.fetch(`https://validator.test/__ograf_preview__/${path}`);
        expect(result.status).toBe(400);
        expect(await result.text()).toBe('Invalid preview resource URL.');
        expect(worker.getClient).not.toHaveBeenCalled();
    });

    it.each([
        ['File not found: private.txt', resourceUrl, 404],
        ['Permission denied: private.txt', resourceUrl, 504],
        ['unused', 'https://validator.test/__ograf_preview__/invalid', 400],
    ] as const)('returns no error body for HEAD (%s)', async (error, url, status) => {
        const result = await createWorker({ error }).fetch(url, 'HEAD');
        expect(result.status).toBe(status);
        expect(await result.text()).toBe('');
    });

    it('still serves package data through the registered broker', async () => {
        const worker = createWorker({ buffer: new TextEncoder().encode('package asset').buffer });
        const result = await worker.fetch();
        expect(result.status).toBe(200);
        expect(await result.text()).toBe('package asset');
        expect(worker.warn).not.toHaveBeenCalled();
    });
});
