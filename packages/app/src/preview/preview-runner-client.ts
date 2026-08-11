import type { NormalizedReturnPayload, OgrafApiMethod } from './preview-contract.js';
import { buildPreviewModuleGraph, previewMimeTypeForPath } from './preview-module-graph.js';
import {
    PREVIEW_PROTOCOL_VERSION,
    createPreviewSessionId,
    parsePreviewResourceUrl,
} from './preview-resources.js';
import { listPreviewSessionFiles, readPreviewSessionFile } from './use-preview-sw.js';
import { DEFAULT_BACKGROUND, type PreviewBackground } from './preview-types.js';

const RUNNER_PATH = `/preview-runner.html?protocol=${PREVIEW_PROTOCOL_VERSION}`;

export class PreviewRunnerTimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PreviewRunnerTimeoutError';
    }
}

export class PreviewRunnerAbortError extends Error {
    constructor(message = 'Preview runner operation was aborted.') {
        super(message);
        this.name = 'PreviewRunnerAbortError';
    }
}

export interface PreviewRunnerLog {
    level: 'log' | 'warn' | 'error' | 'info';
    args: unknown[];
}

export interface PreviewRunnerOptions {
    sessionId: string;
    importUrl: string;
    mount: HTMLElement;
    width: number;
    height: number;
    background?: PreviewBackground;
    hidden?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
    onLog?: (entry: PreviewRunnerLog) => void;
    onRuntimeError?: (error: string) => void;
}

export interface PreviewRunnerCallOptions {
    timeoutMs?: number;
    signal?: AbortSignal;
}

export interface PreviewRunnerCallResult {
    wasPromise: boolean;
    normalized: NormalizedReturnPayload;
    durationMs: number;
}

export interface PreviewRunnerDiagnostic {
    code: string;
    message: string;
}

export interface PreviewRunner {
    readonly iframe: HTMLIFrameElement;
    readonly methods: readonly OgrafApiMethod[];
    readonly diagnostics: readonly PreviewRunnerDiagnostic[];
    call: (
        method: OgrafApiMethod,
        params: unknown,
        options?: PreviewRunnerCallOptions,
    ) => Promise<PreviewRunnerCallResult>;
    setBackground: (background: PreviewBackground) => Promise<void>;
    destroy: () => Promise<void>;
    remove: () => void;
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timeout: number;
    removeAbortListener?: () => void;
}

interface RunnerMessage {
    protocol?: unknown;
    runnerId?: unknown;
    sessionId?: unknown;
    type?: unknown;
    requestId?: unknown;
    ok?: unknown;
    result?: unknown;
    error?: unknown;
    level?: unknown;
    args?: unknown;
    url?: unknown;
    method?: unknown;
    resourceKind?: unknown;
    source?: unknown;
    baseUrl?: unknown;
    workerId?: unknown;
    workerType?: unknown;
    workerName?: unknown;
}

interface HostedWorker {
    worker: Worker;
    proxyPort: MessagePort;
    resourcePort: MessagePort;
}

export async function createPreviewRunner(options: PreviewRunnerOptions): Promise<PreviewRunner> {
    const runnerId = createPreviewSessionId();
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('aria-label', options.hidden ? 'OGraf runtime test sandbox' : 'OGraf graphic preview');
    iframe.src = `${RUNNER_PATH}&runner=${encodeURIComponent(runnerId)}`;
    iframe.style.border = '0';
    iframe.style.background = 'transparent';
    if (options.hidden) {
        // Keep one transparent pixel inside the viewport so animation libraries still receive
        // requestAnimationFrame ticks. Chromium may pause frames placed fully off-screen.
        iframe.style.cssText += `position:fixed;left:0;top:0;width:${options.width}px;height:${options.height}px;clip-path:inset(0 calc(100% - 1px) calc(100% - 1px) 0);opacity:0.001;pointer-events:none;z-index:-2147483647;`;
    } else {
        iframe.style.cssText += 'display:block;width:100%;height:100%;';
    }

    const channel = new MessageChannel();
    const pending = new Map<string, PendingRequest>();
    const hostedWorkers = new Map<string, HostedWorker>();
    let closed = false;
    let readyResolve: (() => void) | undefined;
    let readyReject: ((reason: Error) => void) | undefined;
    const readyPromise = new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
    });

    const rejectAll = (error: Error) => {
        for (const request of pending.values()) {
            window.clearTimeout(request.timeout);
            request.removeAbortListener?.();
            request.reject(error);
        }
        pending.clear();
    };

    const remove = () => {
        if (closed) return;
        closed = true;
        rejectAll(new PreviewRunnerAbortError('Preview runner was removed.'));
        for (const workerId of [...hostedWorkers.keys()]) stopHostedWorker(workerId);
        channel.port1.close();
        iframe.remove();
    };

    const onMessage = (event: MessageEvent<unknown>) => {
        const message = event.data as RunnerMessage;
        if (
            typeof message !== 'object' || message === null ||
            message.protocol !== PREVIEW_PROTOCOL_VERSION ||
            message.runnerId !== runnerId ||
            message.sessionId !== options.sessionId
        ) return;

        if (message.type === 'OGRAF_RUNNER_READY') {
            readyResolve?.();
            return;
        }
        if (message.type === 'OGRAF_RUNNER_LOG' && isLogLevel(message.level) && Array.isArray(message.args)) {
            options.onLog?.({ level: message.level, args: message.args });
            return;
        }
        if (message.type === 'OGRAF_RUNNER_ERROR') {
            options.onRuntimeError?.(readErrorMessage(message.error));
            return;
        }
        if (
            message.type === 'OGRAF_RUNNER_FILE_REQUEST' &&
            typeof message.requestId === 'string' &&
            typeof message.url === 'string'
        ) {
            void respondToFileRequest(message.requestId, message.url, message.method);
            return;
        }
        if (
            message.type === 'OGRAF_RUNNER_RESOURCE_REQUEST' &&
            typeof message.requestId === 'string' &&
            typeof message.resourceKind === 'string'
        ) {
            void respondToResourceRequest(message);
            return;
        }
        if (
            message.type === 'OGRAF_RUNNER_WORKER_START' &&
            typeof message.requestId === 'string'
        ) {
            void startHostedWorker(message);
            return;
        }
        if (message.type !== 'OGRAF_RUNNER_RESPONSE' || typeof message.requestId !== 'string') return;
        const request = pending.get(message.requestId);
        if (!request) return;
        pending.delete(message.requestId);
        window.clearTimeout(request.timeout);
        request.removeAbortListener?.();
        if (message.ok === true) request.resolve(message.result);
        else request.reject(new Error(readErrorMessage(message.error)));
    };

    const respondToFileRequest = async (
        requestId: string,
        url: string,
        method: unknown,
    ): Promise<void> => {
        try {
            if (closed) throw new PreviewRunnerAbortError('Preview runner is closed.');
            if (method !== undefined && method !== 'GET' && method !== 'HEAD') {
                throw new Error(`Unsupported local package request method "${String(method)}".`);
            }
            const parsed = parsePreviewResourceUrl(url);
            if (parsed.sessionId !== options.sessionId) {
                throw new Error('Local package request does not match the active preview session.');
            }
            const buffer = await readPreviewSessionFile(options.sessionId, parsed.path);
            channel.port1.postMessage({
                protocol: PREVIEW_PROTOCOL_VERSION,
                runnerId,
                sessionId: options.sessionId,
                type: 'OGRAF_RUNNER_FILE_RESPONSE',
                requestId,
                ok: true,
                result: { buffer, mimeType: previewMimeTypeForPath(parsed.path) },
            }, [buffer]);
        } catch (error) {
            if (closed) return;
            channel.port1.postMessage({
                protocol: PREVIEW_PROTOCOL_VERSION,
                runnerId,
                sessionId: options.sessionId,
                type: 'OGRAF_RUNNER_FILE_RESPONSE',
                requestId,
                ok: false,
                error: readErrorMessage(error),
            });
        }
    };

    const respondToResourceRequest = async (message: RunnerMessage): Promise<void> => {
        const requestId = message.requestId;
        if (typeof requestId !== 'string') return;
        try {
            if (closed) throw new PreviewRunnerAbortError('Preview runner is closed.');
            const readFile = (path: string) => readPreviewSessionFile(options.sessionId, path);
            let result: unknown;
            if (message.resourceKind === 'stylesheet-url') {
                if (typeof message.url !== 'string') throw new Error('Stylesheet URL is missing.');
                const { buildPreviewCssGraph } = await import('./preview-resource-graph.js');
                result = await buildPreviewCssGraph({
                    sessionId: options.sessionId,
                    baseUrl: message.url,
                    entryUrl: message.url,
                    readFile,
                    signal: options.signal,
                });
            } else if (message.resourceKind === 'stylesheet-text') {
                if (typeof message.source !== 'string' || typeof message.baseUrl !== 'string') {
                    throw new Error('Inline stylesheet source or base URL is missing.');
                }
                const { buildPreviewCssGraph } = await import('./preview-resource-graph.js');
                result = await buildPreviewCssGraph({
                    sessionId: options.sessionId,
                    baseUrl: message.baseUrl,
                    source: message.source,
                    readFile,
                    signal: options.signal,
                });
            } else if (message.resourceKind === 'srcset') {
                if (typeof message.source !== 'string' || typeof message.baseUrl !== 'string') {
                    throw new Error('srcset source or base URL is missing.');
                }
                const { preparePreviewSrcset } = await import('./preview-srcset.js');
                result = await preparePreviewSrcset(
                    message.source,
                    message.baseUrl,
                    options.sessionId,
                    readFile,
                    options.signal,
                );
            } else {
                throw new Error(`Unsupported preview resource kind "${message.resourceKind}".`);
            }

            const transfer = collectArrayBuffers(result);
            channel.port1.postMessage({
                protocol: PREVIEW_PROTOCOL_VERSION,
                runnerId,
                sessionId: options.sessionId,
                type: 'OGRAF_RUNNER_RESOURCE_RESPONSE',
                requestId,
                ok: true,
                result,
            }, transfer);
        } catch (error) {
            if (closed) return;
            channel.port1.postMessage({
                protocol: PREVIEW_PROTOCOL_VERSION,
                runnerId,
                sessionId: options.sessionId,
                type: 'OGRAF_RUNNER_RESOURCE_RESPONSE',
                requestId,
                ok: false,
                error: serializeResourceError(error),
            });
        }
    };

    const startHostedWorker = async (message: RunnerMessage): Promise<void> => {
        const requestId = message.requestId;
        const workerId = message.workerId;
        if (typeof requestId !== 'string') return;
        try {
            if (closed) throw new PreviewRunnerAbortError('Preview runner is closed.');
            if (typeof workerId !== 'string' || !workerId || hostedWorkers.has(workerId)) {
                throw new Error('Dedicated Worker request contains an invalid or duplicate worker id.');
            }
            if (typeof message.source !== 'string' || message.source.length > 16 * 1024 * 1024) {
                throw new Error('Dedicated Worker bootstrap is missing or exceeds 16 MiB.');
            }
            if (message.workerType !== 'module' && message.workerType !== 'classic') {
                throw new Error('Dedicated Worker request contains an invalid worker type.');
            }

            // A Worker created inside sandbox="allow-scripts" cannot load a blob:null URL in
            // Chromium. Hosting a data: Worker here keeps its origin opaque while the package
            // code remains outside the Validator origin and receives only the two ports below.
            const workerUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(message.source)}`;
            const worker = new Worker(workerUrl, {
                type: message.workerType,
                ...(typeof message.workerName === 'string' ? { name: message.workerName } : {}),
            });
            const proxyChannel = new MessageChannel();
            const resourceChannel = new MessageChannel();
            const hosted: HostedWorker = {
                worker,
                proxyPort: proxyChannel.port1,
                resourcePort: resourceChannel.port1,
            };
            hostedWorkers.set(workerId, hosted);

            proxyChannel.port1.addEventListener('message', (event: MessageEvent<unknown>) => {
                const command = event.data as { type?: unknown; data?: unknown } | null;
                if (command?.type === 'terminate') {
                    stopHostedWorker(workerId);
                    return;
                }
                if (command?.type === 'post-message') {
                    worker.postMessage(command.data, [...event.ports]);
                }
            });
            proxyChannel.port1.start();

            worker.addEventListener('message', (event) => {
                proxyChannel.port1.postMessage({ type: 'message', data: event.data }, [...event.ports]);
            });
            worker.addEventListener('messageerror', () => {
                proxyChannel.port1.postMessage({ type: 'messageerror' });
            });
            worker.addEventListener('error', (event) => {
                event.preventDefault();
                proxyChannel.port1.postMessage({
                    type: 'error',
                    message: event.message || 'Dedicated Worker failed without browser details.',
                    filename: event.filename,
                    lineno: event.lineno,
                    colno: event.colno,
                });
            });

            resourceChannel.port1.addEventListener('message', (event: MessageEvent<unknown>) => {
                const request = event.data as { type?: unknown; requestId?: unknown; url?: unknown; method?: unknown } | null;
                if (
                    request?.type !== 'OGRAF_WORKER_FILE_REQUEST' ||
                    typeof request.requestId !== 'string' ||
                    typeof request.url !== 'string'
                ) return;
                void respondToHostedWorkerFile(hosted, request.requestId, request.url, request.method);
            });
            resourceChannel.port1.start();
            worker.postMessage({ type: 'OGRAF_WORKER_INIT' }, [resourceChannel.port2]);

            channel.port1.postMessage({
                protocol: PREVIEW_PROTOCOL_VERSION,
                runnerId,
                sessionId: options.sessionId,
                type: 'OGRAF_RUNNER_WORKER_STARTED',
                requestId,
                ok: true,
                result: { workerId, port: proxyChannel.port2 },
            }, [proxyChannel.port2]);
        } catch (error) {
            if (typeof workerId === 'string') stopHostedWorker(workerId);
            if (closed) return;
            channel.port1.postMessage({
                protocol: PREVIEW_PROTOCOL_VERSION,
                runnerId,
                sessionId: options.sessionId,
                type: 'OGRAF_RUNNER_WORKER_STARTED',
                requestId,
                ok: false,
                error: serializeResourceError(error),
            });
        }
    };

    const respondToHostedWorkerFile = async (
        hosted: HostedWorker,
        requestId: string,
        url: string,
        method: unknown,
    ): Promise<void> => {
        try {
            if (closed) throw new PreviewRunnerAbortError('Preview runner is closed.');
            if (method !== undefined && method !== 'GET' && method !== 'HEAD') {
                throw new Error(`Unsupported local Worker request method "${String(method)}".`);
            }
            const parsed = parsePreviewResourceUrl(url);
            if (parsed.sessionId !== options.sessionId) {
                throw new Error('Dedicated Worker request does not match the active preview session.');
            }
            const buffer = await readPreviewSessionFile(options.sessionId, parsed.path);
            hosted.resourcePort.postMessage({
                type: 'OGRAF_WORKER_FILE_RESPONSE',
                requestId,
                ok: true,
                result: { buffer, mimeType: previewMimeTypeForPath(parsed.path) },
            }, [buffer]);
        } catch (error) {
            if (closed) return;
            hosted.resourcePort.postMessage({
                type: 'OGRAF_WORKER_FILE_RESPONSE',
                requestId,
                ok: false,
                error: serializeResourceError(error),
            });
        }
    };

    const stopHostedWorker = (workerId: string): void => {
        const hosted = hostedWorkers.get(workerId);
        if (!hosted) return;
        hostedWorkers.delete(workerId);
        hosted.proxyPort.close();
        hosted.resourcePort.close();
        hosted.worker.terminate();
    };
    channel.port1.addEventListener('message', onMessage);
    channel.port1.start();

    const request = <T>(
        type: 'OGRAF_RUNNER_INIT' | 'OGRAF_RUNNER_CALL' | 'OGRAF_RUNNER_SET_BACKGROUND' | 'OGRAF_RUNNER_DESTROY',
        payload: unknown,
        requestOptions: PreviewRunnerCallOptions = {},
    ): Promise<T> => {
        if (closed) return Promise.reject(new PreviewRunnerAbortError('Preview runner is closed.'));
        const signal = requestOptions.signal;
        if (signal?.aborted) return Promise.reject(new PreviewRunnerAbortError());
        const requestId = createPreviewSessionId();
        const timeoutMs = requestOptions.timeoutMs ?? options.timeoutMs ?? 10_000;

        return new Promise<T>((resolve, reject) => {
            const onAbort = () => {
                const current = pending.get(requestId);
                if (!current) return;
                pending.delete(requestId);
                window.clearTimeout(current.timeout);
                reject(new PreviewRunnerAbortError());
            };
            const timeout = window.setTimeout(() => {
                const current = pending.get(requestId);
                if (!current) return;
                pending.delete(requestId);
                current.removeAbortListener?.();
                reject(new PreviewRunnerTimeoutError(`OGraf runner ${type} timed out after ${timeoutMs}ms.`));
            }, timeoutMs);
            const removeAbortListener = signal
                ? () => signal.removeEventListener('abort', onAbort)
                : undefined;
            signal?.addEventListener('abort', onAbort, { once: true });
            pending.set(requestId, {
                resolve: (value) => resolve(value as T),
                reject,
                timeout,
                ...(removeAbortListener ? { removeAbortListener } : {}),
            });
            channel.port1.postMessage({
                protocol: PREVIEW_PROTOCOL_VERSION,
                runnerId,
                sessionId: options.sessionId,
                type,
                requestId,
                payload,
            });
        });
    };

    options.mount.appendChild(iframe);
    try {
        await withTimeoutAndAbort(
            waitForFrameLoad(iframe, options.signal),
            options.timeoutMs ?? 10_000,
            options.signal,
            'Preview runner iframe load',
        );
        if (!iframe.contentWindow) throw new Error('Preview runner iframe has no content window.');
        iframe.contentWindow.postMessage({
            protocol: PREVIEW_PROTOCOL_VERSION,
            type: 'OGRAF_RUNNER_CONNECT',
            runnerId,
            sessionId: options.sessionId,
        }, '*', [channel.port2]);
        await withTimeoutAndAbort(
            readyPromise,
            options.timeoutMs ?? 10_000,
            options.signal,
            'Preview runner handshake',
        );
        const moduleGraph = await withTimeoutAndAbort(
            buildPreviewModuleGraph(
                options.importUrl,
                options.sessionId,
                (path) => readPreviewSessionFile(options.sessionId, path),
                options.signal,
                () => listPreviewSessionFiles(options.sessionId),
            ),
            options.timeoutMs ?? 10_000,
            options.signal,
            'Preview module graph',
        );
        const init = await request<{ methods?: unknown; diagnostics?: unknown }>('OGRAF_RUNNER_INIT', {
            importUrl: options.importUrl,
            width: options.width,
            height: options.height,
            background: options.background ?? DEFAULT_BACKGROUND,
            moduleGraph,
        }, { timeoutMs: options.timeoutMs, signal: options.signal });
        const methods = Array.isArray(init.methods)
            ? init.methods.filter((method): method is OgrafApiMethod => typeof method === 'string')
            : [];
        const diagnostics = readRunnerDiagnostics(init.diagnostics);

        return {
            iframe,
            methods,
            diagnostics,
            call: (method, params, callOptions) =>
                request<PreviewRunnerCallResult>('OGRAF_RUNNER_CALL', { method, params }, callOptions),
            setBackground: (background) =>
                request<void>('OGRAF_RUNNER_SET_BACKGROUND', background),
            destroy: async () => {
                if (closed) return;
                try {
                    await request('OGRAF_RUNNER_DESTROY', {}, { timeoutMs: 1_000 });
                } catch {
                    // DOM removal is the final isolation boundary even if disposal hangs.
                } finally {
                    remove();
                }
            },
            remove,
        };
    } catch (error) {
        readyReject?.(error instanceof Error ? error : new Error(String(error)));
        remove();
        throw error;
    }
}

function waitForFrameLoad(iframe: HTMLIFrameElement, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const onLoad = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error('Could not load the preview runner iframe.')); };
        const onAbort = () => { cleanup(); reject(new PreviewRunnerAbortError()); };
        const cleanup = () => {
            iframe.removeEventListener('load', onLoad);
            iframe.removeEventListener('error', onError);
            signal?.removeEventListener('abort', onAbort);
        };
        iframe.addEventListener('load', onLoad, { once: true });
        iframe.addEventListener('error', onError, { once: true });
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
    });
}

function withTimeoutAndAbort<T>(
    promise: Promise<T>,
    timeoutMs: number,
    signal: AbortSignal | undefined,
    label: string,
): Promise<T> {
    return new Promise((resolve, reject) => {
        let settled = false;
        if (signal?.aborted) {
            reject(new PreviewRunnerAbortError());
            return;
        }
        const timeout = window.setTimeout(
            () => finish(() => reject(new PreviewRunnerTimeoutError(`${label} timed out after ${timeoutMs}ms.`))),
            timeoutMs,
        );
        const onAbort = () => finish(() => reject(new PreviewRunnerAbortError()));
        const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            signal?.removeEventListener('abort', onAbort);
            callback();
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        promise.then(
            (value) => finish(() => resolve(value)),
            (error: unknown) => finish(() => reject(error)),
        );
    });
}

function isLogLevel(value: unknown): value is PreviewRunnerLog['level'] {
    return value === 'log' || value === 'warn' || value === 'error' || value === 'info';
}

function readRunnerDiagnostics(value: unknown): PreviewRunnerDiagnostic[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((candidate) => {
        if (typeof candidate !== 'object' || candidate === null) return [];
        const record = candidate as Record<string, unknown>;
        return typeof record['code'] === 'string' && typeof record['message'] === 'string'
            ? [{ code: record['code'], message: record['message'] }]
            : [];
    });
}

function readErrorMessage(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null) {
        const message = (value as Record<string, unknown>)['message'];
        if (typeof message === 'string') return message;
    }
    return 'Unknown preview runner error.';
}

function collectArrayBuffers(value: unknown, buffers = new Set<ArrayBuffer>()): ArrayBuffer[] {
    if (value instanceof ArrayBuffer) {
        buffers.add(value);
        return [...buffers];
    }
    if (Array.isArray(value)) {
        for (const item of value) collectArrayBuffers(item, buffers);
    } else if (typeof value === 'object' && value !== null) {
        for (const item of Object.values(value)) collectArrayBuffers(item, buffers);
    }
    return [...buffers];
}

function serializeResourceError(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
        const record = error as Error & {
            code?: unknown;
            resourceKind?: unknown;
            path?: unknown;
        };
        return {
            name: error.name,
            message: error.message,
            ...(typeof record.code === 'string' ? { code: record.code } : {}),
            ...(typeof record.resourceKind === 'string' ? { resourceKind: record.resourceKind } : {}),
            ...(typeof record.path === 'string' ? { path: record.path } : {}),
        };
    }
    return { name: 'Error', message: String(error) };
}
