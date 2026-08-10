import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserFS } from '../fs/browser-fs.js';
import { buildSchemaDefaultsValue } from './schema-defaults.js';
import {
    PREVIEW_PROTOCOL_VERSION,
    assertPreviewSessionId,
    buildPreviewResourceUrl,
    createPreviewSecurityToken,
    createPreviewSessionId,
    normalizePreviewPath,
} from './preview-resources.js';
import {
    type PreviewFileResponse,
    isPreviewFileRequest,
    requestTargetsTab,
} from './preview-protocol.js';

export { PREVIEW_PREFIX } from './preview-resources.js';

const SW_PATH = '/preview-sw.js';
const SW_URL = `${SW_PATH}?protocol=${PREVIEW_PROTOCOL_VERSION}`;
const TAB_TOKEN = createPreviewSecurityToken();

interface SessionRegistration {
    handle: FileSystemDirectoryHandle;
    references: number;
    tabToken: string;
}

const sessions = new Map<string, SessionRegistration>();
let brokerInstalled = false;

export async function readPreviewSessionFile(sessionId: string, path: string): Promise<ArrayBuffer> {
    assertPreviewSessionId(sessionId);
    const registration = sessions.get(sessionId);
    if (!registration) throw new Error(`Preview session "${sessionId}" is not registered in this tab.`);
    const fs = new BrowserFS(registration.handle);
    const normalizedPath = normalizePreviewPath(path);
    try {
        return await fs.readArrayBuffer(normalizedPath);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw Object.assign(
            new Error(`Could not read OGraf package file "${normalizedPath}": ${message}`),
            { cause: error },
        );
    }
}

export async function listPreviewSessionFiles(sessionId: string): Promise<string[]> {
    assertPreviewSessionId(sessionId);
    const registration = sessions.get(sessionId);
    if (!registration) throw new Error(`Preview session "${sessionId}" is not registered in this tab.`);
    return new BrowserFS(registration.handle).listFiles();
}

function postSessionRegistration(type: 'REGISTER' | 'UNREGISTER', sessionId: string): void {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.controller?.postMessage({
        protocol: PREVIEW_PROTOCOL_VERSION,
        type: `OGRAF_PREVIEW_SESSION_${type}`,
        sessionId,
        tabToken: TAB_TOKEN,
    });
}

function ensureFileBroker(): void {
    if (
        brokerInstalled ||
        typeof navigator === 'undefined' ||
        !('serviceWorker' in navigator)
    ) return;

    navigator.serviceWorker.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (!isPreviewFileRequest(event.data)) return;
        if (!(event.source instanceof ServiceWorker) || !isPreviewWorker(event.source)) return;
        const { requestId, sessionId, path } = event.data;
        const registration = sessions.get(sessionId);
        if (!registration) return;
        if (!requestTargetsTab(event.data, registration.tabToken)) return;
        const worker = event.source;

        void (async () => {
            try {
                assertPreviewSessionId(sessionId);
                const normalizedPath = normalizePreviewPath(path);
                const buffer = await readPreviewSessionFile(sessionId, normalizedPath);
                const response: PreviewFileResponse = {
                    protocol: PREVIEW_PROTOCOL_VERSION,
                    type: 'OGRAF_PREVIEW_FILE_RESPONSE',
                    requestId,
                    sessionId,
                    path: normalizedPath,
                    tabToken: registration.tabToken,
                    buffer,
                };
                worker.postMessage(response, [buffer]);
            } catch (error) {
                const response: PreviewFileResponse = {
                    protocol: PREVIEW_PROTOCOL_VERSION,
                    type: 'OGRAF_PREVIEW_FILE_RESPONSE',
                    requestId,
                    sessionId,
                    path,
                    tabToken: registration.tabToken,
                    error: error instanceof Error ? error.message : String(error),
                };
                worker.postMessage(response);
            }
        })();
    });
    brokerInstalled = true;
}

export interface PreviewSession {
    readonly sessionId: string;
    buildUrl: (path: string) => string;
    close: () => void;
}

export interface CreatePreviewSessionOptions {
    sessionId?: string;
}

/** Register one package directory for one unguessable preview URL namespace. */
export function createPreviewSession(
    handle: FileSystemDirectoryHandle,
    options: CreatePreviewSessionOptions = {},
): PreviewSession {
    const sessionId = assertPreviewSessionId(options.sessionId ?? createPreviewSessionId());
    const existing = sessions.get(sessionId);
    if (existing && existing.handle !== handle) {
        throw new Error(`Preview session "${sessionId}" is already bound to another directory.`);
    }
    ensureFileBroker();

    if (existing) {
        existing.references += 1;
    } else {
        sessions.set(sessionId, { handle, references: 1, tabToken: TAB_TOKEN });
        postSessionRegistration('REGISTER', sessionId);
    }

    let closed = false;

    return {
        sessionId,
        buildUrl: (path: string) => buildPreviewResourceUrl(path, sessionId),
        close: () => {
            if (closed) return;
            closed = true;
            const current = sessions.get(sessionId);
            if (!current) return;
            current.references -= 1;
            if (current.references <= 0) {
                sessions.delete(sessionId);
                postSessionRegistration('UNREGISTER', sessionId);
            }
        },
    };
}

/** Build a cache-busting, sessionized module URL. */
export function buildImportUrl(mainFile: string, sessionId = createPreviewSessionId()): string {
    const url = new URL(buildPreviewResourceUrl(mainFile, sessionId));
    url.searchParams.set('v', `${Date.now()}-${createPreviewSessionId().slice(0, 8)}`);

    return url.toString();
}

/** Extract default preview data from GDD schema properties. */
export function buildPreviewData(manifest: unknown): Record<string, unknown> {
    if (typeof manifest !== 'object' || manifest === null) return {};
    const schema = (manifest as Record<string, unknown>)['schema'];
    if (typeof schema !== 'object' || schema === null) return {};
    const value = buildSchemaDefaultsValue(schema);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

export interface PreviewSW {
    swReady: boolean;
    resetSW: () => Promise<void>;
    createSession: (
        handle?: FileSystemDirectoryHandle,
        options?: CreatePreviewSessionOptions,
    ) => PreviewSession;
}

function isPreviewWorker(worker: ServiceWorker | null): boolean {
    if (!worker) return false;
    try {
        const url = new URL(worker.scriptURL);
        return url.pathname === SW_PATH &&
            url.searchParams.get('protocol') === String(PREVIEW_PROTOCOL_VERSION);
    } catch {
        return false;
    }
}

async function waitForPreviewController(timeoutMs = 10_000): Promise<void> {
    if (isPreviewWorker(navigator.serviceWorker.controller)) return;

    await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
            cleanup();
            reject(new Error('Preview Service Worker did not take control of this page.'));
        }, timeoutMs);
        const onControllerChange = () => {
            if (!isPreviewWorker(navigator.serviceWorker.controller)) return;
            cleanup();
            resolve();
        };
        const cleanup = () => {
            window.clearTimeout(timeout);
            navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
        };
        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
        onControllerChange();
    });
}

/** Register the scoped preview service worker and expose session creation. */
export function usePreviewSW(dirHandle: FileSystemDirectoryHandle | null): PreviewSW {
    const [swReady, setSwReady] = useState(false);
    const handleRef = useRef(dirHandle);
    const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

    useEffect(() => {
        handleRef.current = dirHandle;
    }, [dirHandle]);

    const register = useCallback(async (): Promise<void> => {
        if (!('serviceWorker' in navigator)) return;
        ensureFileBroker();
        const registration = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
        registrationRef.current = registration;
        await navigator.serviceWorker.ready;
        await waitForPreviewController();
        for (const sessionId of sessions.keys()) postSessionRegistration('REGISTER', sessionId);
        setSwReady(true);
    }, []);

    useEffect(() => {
        void register().catch((error) => {
            console.warn('Preview Service Worker registration failed:', error);
            setSwReady(false);
        });
    }, [register]);

    const resetSW = useCallback(async (): Promise<void> => {
        if (!('serviceWorker' in navigator)) return;
        setSwReady(false);
        const registration = registrationRef.current ?? await navigator.serviceWorker.getRegistration('/');
        if (
            registration && (
                isPreviewWorker(registration.active) ||
                isPreviewWorker(registration.waiting) ||
                isPreviewWorker(registration.installing)
            )
        ) {
            await registration.unregister();
        }
        registrationRef.current = null;
        await register();
    }, [register]);

    const createSession = useCallback((
        handle?: FileSystemDirectoryHandle,
        options?: CreatePreviewSessionOptions,
    ): PreviewSession => {
        const selectedHandle = handle ?? handleRef.current;
        if (!selectedHandle) throw new Error('No package directory is available for the preview session.');

        return createPreviewSession(selectedHandle, options);
    }, []);

    return { swReady, resetSW, createSession };
}
