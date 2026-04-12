import { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserFS } from '../fs/browser-fs.js';

export const PREVIEW_PREFIX = '/__ograf_preview__/';
const CHANNEL_NAME = 'ograf-preview';
const SW_PATH = '/preview-sw.js';

function getMimeType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
        mjs: 'text/javascript',
        js: 'text/javascript',
        ts: 'text/javascript',
        html: 'text/html',
        css: 'text/css',
        json: 'application/json',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        svg: 'image/svg+xml',
        webp: 'image/webp',
        woff: 'font/woff',
        woff2: 'font/woff2',
        ttf: 'font/ttf',
        otf: 'font/otf',
    };

    return map[ext] ?? 'application/octet-stream';
}

/**
 * Registers the preview Service Worker and returns whether it's ready.
 * Also starts the BroadcastChannel file server that the SW talks to.
 * Call once at app root level.
 */
export interface PreviewSW {
    swReady: boolean;
    resetSW: () => Promise<void>;
}

export function usePreviewSW(dirHandle: FileSystemDirectoryHandle | null): PreviewSW {
    const [swReady, setSwReady] = useState(false);
    const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(dirHandle);

    // Keep ref in sync without recreating the channel listener
    useEffect(() => {
        dirHandleRef.current = dirHandle;
    }, [dirHandle]);

    // Register Service Worker once
    useEffect(() => {
        if (!('serviceWorker' in navigator)) return;

        void navigator.serviceWorker
            .register(SW_PATH, { scope: '/' })
            .then(() => navigator.serviceWorker.ready)
            .then(() => setSwReady(true))
            .catch((err) => console.warn('Preview SW registration failed:', err));
    }, []);

    // BroadcastChannel file server – created once, uses ref for current handle
    useEffect(() => {
        const channel = new BroadcastChannel(CHANNEL_NAME);

        const handleMessage = async (event: MessageEvent<unknown>) => {
            const msg = event.data;
            if (typeof msg !== 'object' || msg === null) return;
            const { type, id, path } = msg as Record<string, unknown>;
            if (type !== 'FILE_REQUEST' || typeof id !== 'string' || typeof path !== 'string') return;

            const handle = dirHandleRef.current;
            // If no handle is set, don't respond — let another handler (e.g. runRuntimeTest) serve it.
            if (!handle) return;

            try {
                const fs = new BrowserFS(handle);
                const buffer = await fs.readArrayBuffer(path);
                // ArrayBuffer must be cloned (BroadcastChannel doesn't transfer)
                channel.postMessage({ type: 'FILE_RESPONSE', id, buffer, mimeType: getMimeType(path) });
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                channel.postMessage({ type: 'FILE_RESPONSE', id, error: message });
            }
        };

        channel.addEventListener('message', handleMessage);

        return () => {
            channel.removeEventListener('message', handleMessage);
            channel.close();
        };
    }, []);

    const resetSW = useCallback(async () => {
        if (!('serviceWorker' in navigator)) return;
        try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map((r) => r.unregister()));
            setSwReady(false);
            await navigator.serviceWorker.register(SW_PATH, { scope: '/' });
            await navigator.serviceWorker.ready;
            setSwReady(true);
        } catch (err) {
            console.warn('Preview SW reset failed:', err);
        }
    }, []);

    return { swReady, resetSW };
}

/** Build a unique import URL that bypasses the module cache. */
export function buildImportUrl(mainFile: string): string {
    return `${window.location.origin}${PREVIEW_PREFIX}${mainFile}?v=${Date.now()}`;
}

/** Extract default preview data from GDD schema properties. */
export function buildPreviewData(manifest: unknown): Record<string, unknown> {
    if (typeof manifest !== 'object' || manifest === null) return {};
    const m = manifest as Record<string, unknown>;
    const schema = m['schema'];
    if (typeof schema !== 'object' || schema === null) return {};
    const s = schema as Record<string, unknown>;
    const props = s['properties'];
    if (typeof props !== 'object' || props === null) return {};
    const result: Record<string, unknown> = {};
    for (const [key, def] of Object.entries(props as Record<string, unknown>)) {
        if (typeof def === 'object' && def !== null) {
            const d = def as Record<string, unknown>;
            if (d['default'] !== undefined) result[key] = d['default'];
        }
    }

    return result;
}
