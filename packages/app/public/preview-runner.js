/* Runs untrusted OGraf code inside a sandboxed, opaque-origin iframe. */
'use strict';

(() => {
    const PROTOCOL_VERSION = 3;
    const PREVIEW_PREFIX = '/__ograf_preview__/';
    const METHODS = [
        'load', 'dispose', 'playAction', 'stopAction', 'updateAction',
        'customAction', 'goToTime', 'setActionsSchedule',
    ];
    const stage = document.getElementById('stage');
    const base = document.getElementById('ograf-base');
    let port = null;
    let postPort = null;
    let runnerId = '';
    let sessionId = '';
    let element = null;
    let disposed = false;
    let shuttingDown = false;
    let destroyPromise = null;
    let packageStyleObserver = null;
    let logicalWidth = 1920;
    let logicalHeight = 1080;
    let importMapElement = null;
    const moduleBlobUrls = [];
    const packageResourceBlobUrls = new Map();
    const packageModuleOriginalUrls = new Map();
    const pendingPackageResourceBlobUrls = new Map();
    const resourceGraphBlobUrls = new Set();
    const packageElementUrls = new WeakMap();
    const packageStylesheetNodes = new WeakMap();
    const pendingFileRequests = new Map();
    const pendingResourceRequests = new Map();
    const pendingWorkerRequests = new Map();
    const activeWorkerProxies = new Set();
    const styleGenerations = new WeakMap();
    const appliedStyleText = new WeakMap();
    const ASSET_RESOLVER = '__ografValidatorResolveAsset';
    const IMPORT_RESOLVER = '__ografValidatorResolveImport';
    const META_RESOLVER = '__ografValidatorResolveMeta';
    const NativeURL = globalThis.URL;
    const NativeWorker = globalThis.Worker;
    const NativeSharedWorker = globalThis.SharedWorker;
    const nativeElementSetAttribute = Element.prototype.setAttribute;
    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = fetchPackageResource;
    installPackageDomUrlBridge();
    installPackageStyleBridge();

    const originalConsole = {};
    for (const level of ['log', 'warn', 'error', 'info']) {
        originalConsole[level] = console[level].bind(console);
        console[level] = (...args) => {
            originalConsole[level](...args);
            post({ type: 'OGRAF_RUNNER_LOG', level, args: safeClone(args) });
        };
    }

    addEventListener('error', (event) => {
        post({
            type: 'OGRAF_RUNNER_ERROR',
            error: event.error instanceof Error ? serializeError(event.error) : String(event.message || 'Unknown runtime error'),
        });
    });
    addEventListener('unhandledrejection', (event) => {
        post({
            type: 'OGRAF_RUNNER_ERROR',
            error: event.reason instanceof Error ? serializeError(event.reason) : String(event.reason),
        });
    });
    addEventListener('resize', updateScale);

    addEventListener('message', function connect(event) {
        const message = event.data;
        if (
            event.source !== parent ||
            !message ||
            typeof message !== 'object' ||
            message.protocol !== PROTOCOL_VERSION ||
            message.type !== 'OGRAF_RUNNER_CONNECT' ||
            typeof message.runnerId !== 'string' ||
            typeof message.sessionId !== 'string' ||
            event.ports.length !== 1
        ) return;

        runnerId = message.runnerId;
        sessionId = message.sessionId;
        port = event.ports[0];
        postPort = port.postMessage.bind(port);
        port.addEventListener('message', onPortMessage);
        port.start();
        removeEventListener('message', connect);
        post({ type: 'OGRAF_RUNNER_READY' });
    });

    async function onPortMessage(event) {
        const message = event.data;
        if (
            !message ||
            typeof message !== 'object' ||
            message.protocol !== PROTOCOL_VERSION ||
            message.runnerId !== runnerId ||
            message.sessionId !== sessionId ||
            typeof message.requestId !== 'string'
        ) return;

        if (message.type === 'OGRAF_RUNNER_FILE_RESPONSE') {
            const pending = pendingFileRequests.get(message.requestId);
            if (!pending) return;
            pendingFileRequests.delete(message.requestId);
            clearTimeout(pending.timeout);
            pending.removeAbortListener?.();
            if (
                message.ok === true &&
                message.result?.buffer instanceof ArrayBuffer &&
                typeof message.result?.mimeType === 'string'
            ) {
                pending.resolve(message.result);
            } else {
                pending.reject(new Error(readRemoteError(message.error)));
            }
            return;
        }
        if (message.type === 'OGRAF_RUNNER_RESOURCE_RESPONSE') {
            const pending = pendingResourceRequests.get(message.requestId);
            if (!pending) return;
            pendingResourceRequests.delete(message.requestId);
            clearTimeout(pending.timeout);
            if (message.ok === true) pending.resolve(message.result);
            else pending.reject(createRemoteResourceError(message.error));
            return;
        }
        if (message.type === 'OGRAF_RUNNER_WORKER_STARTED') {
            const pending = pendingWorkerRequests.get(message.requestId);
            if (!pending) return;
            pendingWorkerRequests.delete(message.requestId);
            clearTimeout(pending.timeout);
            if (message.ok === true && message.result?.port instanceof MessagePort) {
                pending.resolve(message.result.port);
            } else {
                pending.reject(createRemoteResourceError(message.error));
            }
            return;
        }

        try {
            if (message.type === 'OGRAF_RUNNER_INIT') {
                const result = await initialize(message.payload);
                respond(message.requestId, true, result);
            } else if (message.type === 'OGRAF_RUNNER_CALL') {
                const result = await callGraphic(message.payload);
                respond(message.requestId, true, result);
            } else if (message.type === 'OGRAF_RUNNER_DESTROY') {
                await destroyGraphic();
                respond(message.requestId, true, undefined);
            }
        } catch (error) {
            respond(message.requestId, false, undefined, serializeError(error));
        }
    }

    async function initialize(payload) {
        if (element) throw new Error('Runner has already been initialized.');
        if (!payload || typeof payload !== 'object' || typeof payload.importUrl !== 'string') {
            throw new Error('Runner INIT payload is invalid.');
        }

        const importUrl = new URL(payload.importUrl);
        const runnerOrigin = new URL(document.URL).origin;
        if (
            importUrl.origin !== runnerOrigin ||
            !importUrl.pathname.startsWith(`${PREVIEW_PREFIX}${sessionId}/`)
        ) throw new Error('Graphic import URL does not match this runner session.');

        logicalWidth = positiveNumber(payload.width, 1920);
        logicalHeight = positiveNumber(payload.height, 1080);
        base.href = new URL('./', importUrl).toString();
        updateScale();

        const module = await importModuleGraph(payload.moduleGraph);
        const GraphicClass = module.default;
        if (typeof GraphicClass !== 'function') {
            throw new Error('Graphic module must have a default class export.');
        }
        if (!(GraphicClass.prototype instanceof HTMLElement)) {
            throw new Error('Graphic default export must extend HTMLElement.');
        }

        const tagName = `ograf-sandbox-${runnerId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24)}`;
        if (!tagName.includes('-')) throw new Error('Could not create a valid custom element name.');
        customElements.define(tagName, GraphicClass);
        element = document.createElement(tagName);
        stage.replaceChildren(element);
        // Background runtime frames may have requestAnimationFrame suspended.
        // Connected custom elements are available after the current microtask.
        await Promise.resolve();

        return {
            methods: METHODS.filter((name) => typeof element[name] === 'function'),
            diagnostics: Array.isArray(payload.moduleGraph?.diagnostics) ? payload.moduleGraph.diagnostics : [],
            logicalWidth,
            logicalHeight,
        };
    }

    async function callGraphic(payload) {
        if (!element) throw new Error('Runner has not been initialized.');
        const method = payload && payload.method;
        if (!METHODS.includes(method)) throw new Error(`Unsupported OGraf method "${String(method)}".`);
        if (typeof element[method] !== 'function') throw new Error(`${method}() is not implemented.`);

        if (method === 'dispose') disposed = true;
        const started = performance.now();
        const returned = element[method](payload.params);
        const wasPromise = isPromiseLike(returned);
        const raw = await returned;
        const normalized = normalizePayload(method, raw);

        return {
            wasPromise,
            normalized,
            durationMs: Math.round(performance.now() - started),
        };
    }

    function destroyGraphic() {
        if (!destroyPromise) destroyPromise = performDestroyGraphic();
        return destroyPromise;
    }

    async function performDestroyGraphic() {
        shuttingDown = true;
        packageStyleObserver?.disconnect();
        packageStyleObserver = null;
        if (element && !disposed && typeof element.dispose === 'function') {
            disposed = true;
            try { await element.dispose({}); } catch (error) { originalConsole.warn('OGraf dispose during cleanup failed:', error); }
        }
        if (element) element.remove();
        element = null;
        stage.replaceChildren();
        const error = createRunnerDestroyedError();
        rejectPendingFileRequests(error);
        rejectPendingResourceRequests(error);
        releaseModuleGraph();
    }

    async function fetchPackageResource(input, init) {
        const rawUrl = input instanceof Request
            ? input.url
            : input instanceof NativeURL
                ? input.href
                : String(input);
        let resolved;
        try {
            resolved = new NativeURL(rawUrl, base.href || document.URL);
        } catch {
            return nativeFetch(input, init);
        }
        const localPrefix = `${PREVIEW_PREFIX}${sessionId}/`;
        if (!sessionId || !resolved.pathname.startsWith(localPrefix)) {
            return nativeFetch(input, init);
        }

        const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (method !== 'GET' && method !== 'HEAD') {
            return new Response(null, { status: 405, statusText: 'Method Not Allowed' });
        }
        const signal = init?.signal || (input instanceof Request ? input.signal : undefined);
        const resource = await requestPackageFile(resolved.toString(), method, signal);
        return new Response(method === 'HEAD' ? null : resource.buffer, {
            status: 200,
            headers: {
                'Content-Length': String(resource.buffer.byteLength),
                'Content-Type': resource.mimeType,
            },
        });
    }

    function installPackageDomUrlBridge() {
        const bindings = [
            [globalThis.HTMLImageElement, 'src'],
            [globalThis.HTMLMediaElement, 'src'],
            [globalThis.HTMLVideoElement, 'poster'],
            [globalThis.HTMLSourceElement, 'src'],
            [globalThis.HTMLTrackElement, 'src'],
            [globalThis.HTMLScriptElement, 'src'],
            [globalThis.HTMLLinkElement, 'href'],
            [globalThis.HTMLObjectElement, 'data'],
            [globalThis.HTMLEmbedElement, 'src'],
            [globalThis.HTMLIFrameElement, 'src'],
            [globalThis.HTMLInputElement, 'src'],
        ];

        for (const [Constructor, property] of bindings) {
            const prototype = Constructor?.prototype;
            const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, property);
            if (!descriptor?.get || !descriptor.set) continue;
            Object.defineProperty(prototype, property, {
                ...descriptor,
                get() {
                    return getPackageElementUrl(this, property) || descriptor.get.call(this);
                },
                set(value) {
                    const packageUrl = resolvePackageResourceUrl(value);
                    if (!packageUrl) {
                        deletePackageElementUrl(this, property);
                        if (this instanceof HTMLLinkElement && property === 'href') {
                            packageStylesheetNodes.get(this)?.remove();
                            packageStylesheetNodes.delete(this);
                        }
                        descriptor.set.call(this, value);
                        return;
                    }

                    setPackageElementUrl(this, property, packageUrl);
                    if (isStylesheetElement(this, property, packageUrl)) {
                        void applyPackageStylesheetLink(this, packageUrl);
                        return;
                    }
                    const cached = packageResourceBlobUrls.get(packageUrl);
                    if (cached) {
                        descriptor.set.call(this, cached);
                        return;
                    }

                    void getPackageResourceBlobUrl(packageUrl).then((blobUrl) => {
                        if (!shuttingDown && getPackageElementUrl(this, property) === packageUrl) {
                            descriptor.set.call(this, blobUrl);
                        }
                    }).catch((error) => {
                        if (isExpectedResourceCancellation(error)) return;
                        if (getPackageElementUrl(this, property) !== packageUrl) return;
                        originalConsole.error('Could not load OGraf package resource:', error);
                        this.dispatchEvent(new Event('error'));
                    });
                },
            });
        }

        Element.prototype.setAttribute = function setPackageAttribute(name, value) {
            const lowerName = String(name).toLowerCase();
            if (lowerName === 'srcset' && (this instanceof HTMLImageElement || this instanceof HTMLSourceElement)) {
                this.srcset = value;
                return;
            }
            if (lowerName === 'style') {
                nativeElementSetAttribute.call(this, name, value);
                scheduleInlineStyle(this, String(value), (rewritten) => {
                    appliedStyleText.set(this, rewritten);
                    nativeElementSetAttribute.call(this, name, rewritten);
                });
                return;
            }
            const property = packageUrlProperty(this, name);
            if (property) {
                this[property] = value;
                return;
            }
            nativeElementSetAttribute.call(this, name, value);
        };

        installSrcsetProperty(globalThis.HTMLImageElement);
        installSrcsetProperty(globalThis.HTMLSourceElement);
    }

    function installSrcsetProperty(Constructor) {
        const prototype = Constructor?.prototype;
        const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'srcset');
        if (!descriptor?.get || !descriptor.set) return;
        Object.defineProperty(prototype, 'srcset', {
            ...descriptor,
            get() {
                return getPackageElementUrl(this, 'srcset') || descriptor.get.call(this);
            },
            set(value) {
                const source = String(value);
                setPackageElementUrl(this, 'srcset', source);
                const generation = (styleGenerations.get(this) || 0) + 1;
                styleGenerations.set(this, generation);
                void requestPreparedResource('srcset', {
                    source,
                    baseUrl: base.href || document.URL,
                }).then((prepared) => {
                    if (
                        shuttingDown ||
                        styleGenerations.get(this) !== generation ||
                        getPackageElementUrl(this, 'srcset') !== source
                    ) return;
                    descriptor.set.call(this, createPreparedSrcset(prepared));
                }).catch((error) => {
                    if (isExpectedResourceCancellation(error)) return;
                    if (styleGenerations.get(this) !== generation) return;
                    reportResourceError(error, this);
                });
            },
        });
    }

    function createPreparedSrcset(prepared) {
        if (!prepared || !Array.isArray(prepared.candidates)) throw new Error('Prepared srcset is invalid.');
        return prepared.candidates.map((candidate) => {
            let candidateUrl = candidate.originalUrl || candidate.url;
            if (candidate.buffer instanceof ArrayBuffer && typeof candidate.mimeType === 'string') {
                const cached = packageResourceBlobUrls.get(candidate.url);
                if (cached) candidateUrl = cached;
                else {
                    candidateUrl = NativeURL.createObjectURL(new Blob([candidate.buffer], { type: candidate.mimeType }));
                    packageResourceBlobUrls.set(candidate.url, candidateUrl);
                }
            }
            return candidate.descriptor ? `${candidateUrl} ${candidate.descriptor}` : candidateUrl;
        }).join(', ');
    }

    function installPackageStyleBridge() {
        packageStyleObserver?.disconnect();
        packageStyleObserver = new MutationObserver((mutations) => {
            if (shuttingDown) return;
            for (const mutation of mutations) {
                if (mutation.type === 'attributes') {
                    if (mutation.attributeName === 'style' && mutation.target instanceof Element) {
                        const source = mutation.target.getAttribute('style') || '';
                        if (appliedStyleText.get(mutation.target) !== source) {
                            scheduleInlineStyle(mutation.target, source, (rewritten) => {
                                appliedStyleText.set(mutation.target, rewritten);
                                nativeElementSetAttribute.call(mutation.target, 'style', rewritten);
                            });
                        }
                    } else if (
                        mutation.target instanceof HTMLLinkElement &&
                        (mutation.attributeName === 'href' || mutation.attributeName === 'rel')
                    ) {
                        const original = getPackageElementUrl(mutation.target, 'href');
                        if (original && mutation.target.rel.toLowerCase().split(/\s+/).includes('stylesheet')) {
                            mutation.target.href = original;
                        }
                    }
                } else {
                    processStyleNodes(mutation.target instanceof Element ? mutation.target : mutation.target.parentElement);
                    for (const node of mutation.addedNodes) {
                        processStyleNodes(node instanceof Element ? node : node.parentElement);
                    }
                }
            }
        });
        packageStyleObserver.observe(stage, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['style', 'href', 'rel'],
        });
    }

    function processStyleNodes(root) {
        if (!root) return;
        const styles = root instanceof HTMLStyleElement
            ? [root]
            : [...root.querySelectorAll?.('style') || []];
        for (const style of styles) {
            const source = style.textContent || '';
            if (appliedStyleText.get(style) === source) continue;
            scheduleInlineStyle(style, source, (rewritten) => {
                appliedStyleText.set(style, rewritten);
                style.textContent = rewritten;
            });
        }
    }

    function scheduleInlineStyle(target, source, apply) {
        if (shuttingDown) return;
        const generation = (styleGenerations.get(target) || 0) + 1;
        styleGenerations.set(target, generation);
        void requestPreparedResource('stylesheet-text', {
            source,
            baseUrl: base.href || document.URL,
        }).then((graph) => {
            if (shuttingDown || styleGenerations.get(target) !== generation) return;
            apply(createCssGraphSource(graph));
        }).catch((error) => {
            if (isExpectedResourceCancellation(error)) return;
            if (styleGenerations.get(target) === generation) reportResourceError(error, target);
        });
    }

    function getPackageElementUrl(target, property) {
        return packageElementUrls.get(target)?.get(property);
    }

    function setPackageElementUrl(target, property, url) {
        let urls = packageElementUrls.get(target);
        if (!urls) {
            urls = new Map();
            packageElementUrls.set(target, urls);
        }
        urls.set(property, url);
    }

    function deletePackageElementUrl(target, property) {
        const urls = packageElementUrls.get(target);
        if (!urls) return;
        urls.delete(property);
        if (urls.size === 0) packageElementUrls.delete(target);
    }

    function packageUrlProperty(target, attributeName) {
        const name = String(attributeName).toLowerCase();
        if (name === 'src' && (
            target instanceof HTMLImageElement ||
            target instanceof HTMLMediaElement ||
            target instanceof HTMLSourceElement ||
            target instanceof HTMLTrackElement ||
            target instanceof HTMLScriptElement ||
            target instanceof HTMLEmbedElement ||
            target instanceof HTMLIFrameElement ||
            target instanceof HTMLInputElement
        )) return 'src';
        if (name === 'href' && target instanceof HTMLLinkElement) return 'href';
        if (name === 'data' && target instanceof HTMLObjectElement) return 'data';
        if (name === 'poster' && target instanceof HTMLVideoElement) return 'poster';
        return undefined;
    }

    function resolvePackageResourceUrl(value) {
        let resolved;
        try {
            resolved = new NativeURL(String(value), base.href || document.URL);
        } catch {
            return undefined;
        }
        const localPrefix = `${PREVIEW_PREFIX}${sessionId}/`;
        return sessionId && resolved.pathname.startsWith(localPrefix)
            ? resolved.toString()
            : undefined;
    }

    function getPackageResourceBlobUrl(url) {
        if (shuttingDown) return Promise.reject(createRunnerDestroyedError());
        const cached = packageResourceBlobUrls.get(url);
        if (cached) return Promise.resolve(cached);
        const pending = pendingPackageResourceBlobUrls.get(url);
        if (pending) return pending;

        const request = requestPackageFile(url, 'GET').then((resource) => {
            const blobUrl = NativeURL.createObjectURL(new Blob([resource.buffer], { type: resource.mimeType }));
            packageResourceBlobUrls.set(url, blobUrl);
            return blobUrl;
        }).finally(() => {
            pendingPackageResourceBlobUrls.delete(url);
        });
        pendingPackageResourceBlobUrls.set(url, request);
        return request;
    }

    function isStylesheetElement(target, property, url) {
        return property === 'href' && target instanceof HTMLLinkElement && (
            target.rel.toLowerCase().split(/\s+/).includes('stylesheet') ||
            new NativeURL(url).pathname.toLowerCase().endsWith('.css')
        );
    }

    async function applyPackageStylesheetLink(link, url) {
        if (shuttingDown) return;
        try {
            const graph = await requestPreparedResource('stylesheet-url', { url });
            if (shuttingDown || getPackageElementUrl(link, 'href') !== url) return;
            const source = createCssGraphSource(graph);
            await waitForConnected(link);
            if (shuttingDown || getPackageElementUrl(link, 'href') !== url) return;
            packageStylesheetNodes.get(link)?.remove();
            const style = document.createElement('style');
            style.setAttribute('data-ograf-stylesheet', url);
            style.textContent = source;
            link.insertAdjacentElement('afterend', style);
            packageStylesheetNodes.set(link, style);
            queueMicrotask(() => {
                if (getPackageElementUrl(link, 'href') === url) link.dispatchEvent(new Event('load'));
            });
        } catch (error) {
            if (isExpectedResourceCancellation(error)) return;
            if (getPackageElementUrl(link, 'href') !== url) return;
            reportResourceError(error, link);
        }
    }

    function waitForConnected(element) {
        if (element.isConnected) return Promise.resolve();
        return new Promise((resolve) => {
            const observer = new MutationObserver(() => {
                if (!element.isConnected) return;
                observer.disconnect();
                resolve();
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
        });
    }

    function createCssGraphSource(graph) {
        const built = buildCssGraphBlobs(graph);
        const entry = built.sources.get(graph.entryId);
        if (typeof entry !== 'string') throw new Error('Prepared CSS graph does not contain its entry stylesheet.');
        return entry;
    }

    function buildCssGraphBlobs(graph) {
        if (!graph || !Array.isArray(graph.assets) || !Array.isArray(graph.stylesheets)) {
            throw new Error('Prepared CSS graph is invalid.');
        }
        const replacements = new Map();
        const sources = new Map();
        for (const asset of graph.assets) {
            if (!(asset.buffer instanceof ArrayBuffer) || typeof asset.mimeType !== 'string' || typeof asset.id !== 'string') {
                throw new Error('Prepared CSS graph contains an invalid asset.');
            }
            let blobUrl = packageResourceBlobUrls.get(asset.url);
            if (!blobUrl) {
                blobUrl = NativeURL.createObjectURL(new Blob([asset.buffer], { type: asset.mimeType }));
                packageResourceBlobUrls.set(asset.url, blobUrl);
            }
            replacements.set(`__OGRAF_ASSET_${asset.id}__`, blobUrl);
        }
        for (const stylesheet of graph.stylesheets) {
            if (typeof stylesheet.id !== 'string' || typeof stylesheet.source !== 'string') {
                throw new Error('Prepared CSS graph contains an invalid stylesheet.');
            }
            const source = replaceResourcePlaceholders(stylesheet.source, replacements);
            sources.set(stylesheet.id, source);
            const blobUrl = NativeURL.createObjectURL(new Blob([source], { type: 'text/css;charset=utf-8' }));
            resourceGraphBlobUrls.add(blobUrl);
            replacements.set(`__OGRAF_STYLE_${stylesheet.id}__`, blobUrl);
        }
        for (const warning of graph.warnings || []) originalConsole.warn(String(warning));
        return { sources };
    }

    function replaceResourcePlaceholders(source, replacements) {
        let rewritten = source;
        for (const [placeholder, value] of replacements) {
            rewritten = rewritten.split(placeholder).join(value);
        }
        return rewritten;
    }

    function requestPackageFile(url, method, signal) {
        if (shuttingDown) return Promise.reject(createRunnerDestroyedError());
        if (!postPort) return Promise.reject(new Error('Preview runner is not connected.'));
        if (signal?.aborted) return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
        const requestId = `file-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;

        return new Promise((resolve, reject) => {
            const onAbort = () => {
                const pending = pendingFileRequests.get(requestId);
                if (!pending) return;
                pendingFileRequests.delete(requestId);
                clearTimeout(pending.timeout);
                reject(new DOMException('The operation was aborted.', 'AbortError'));
            };
            const timeout = setTimeout(() => {
                const pending = pendingFileRequests.get(requestId);
                if (!pending) return;
                pendingFileRequests.delete(requestId);
                pending.removeAbortListener?.();
                reject(new Error(`Timed out while reading OGraf package resource "${url}".`));
            }, 10_000);
            const removeAbortListener = signal
                ? () => signal.removeEventListener('abort', onAbort)
                : undefined;
            signal?.addEventListener('abort', onAbort, { once: true });
            pendingFileRequests.set(requestId, { resolve, reject, timeout, removeAbortListener });
            post({ type: 'OGRAF_RUNNER_FILE_REQUEST', requestId, url, method });
        });
    }

    function requestPreparedResource(resourceKind, payload) {
        if (shuttingDown) return Promise.reject(createRunnerDestroyedError());
        if (!postPort) return Promise.reject(new Error('Preview runner is not connected.'));
        const requestId = `resource-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const pending = pendingResourceRequests.get(requestId);
                if (!pending) return;
                pendingResourceRequests.delete(requestId);
                reject(new Error(`Timed out while preparing OGraf ${resourceKind}.`));
            }, 10_000);
            pendingResourceRequests.set(requestId, { resolve, reject, timeout });
            post({
                type: 'OGRAF_RUNNER_RESOURCE_REQUEST',
                requestId,
                resourceKind,
                ...payload,
            });
        });
    }

    function rejectPendingFileRequests(error) {
        for (const pending of pendingFileRequests.values()) {
            clearTimeout(pending.timeout);
            pending.removeAbortListener?.();
            pending.reject(error);
        }
        pendingFileRequests.clear();
    }

    function rejectPendingResourceRequests(error) {
        for (const pending of pendingResourceRequests.values()) {
            clearTimeout(pending.timeout);
            pending.reject(error);
        }
        pendingResourceRequests.clear();
    }

    function createRemoteResourceError(value) {
        const error = new Error(readRemoteError(value));
        if (value && typeof value === 'object') {
            if (typeof value.code === 'string') error.code = value.code;
            if (typeof value.resourceKind === 'string') error.resourceKind = value.resourceKind;
            if (typeof value.path === 'string') error.path = value.path;
        }
        return error;
    }

    function createRunnerDestroyedError() {
        const error = new Error('Preview runner was destroyed.');
        error.code = 'OGRAF_RUNNER_DESTROYED';
        return error;
    }

    function isExpectedResourceCancellation(error) {
        return shuttingDown || (
            error &&
            typeof error === 'object' &&
            error.code === 'OGRAF_RUNNER_DESTROYED'
        );
    }

    function reportResourceError(error, target) {
        if (isExpectedResourceCancellation(error)) return;
        originalConsole.error('Could not prepare OGraf package resource:', error);
        target?.dispatchEvent?.(new Event('error'));
        post({ type: 'OGRAF_RUNNER_ERROR', error: serializeError(error) });
    }

    function readRemoteError(value) {
        if (typeof value === 'string') return value;
        if (value && typeof value === 'object' && typeof value.message === 'string') return value.message;
        return 'Could not read OGraf package resource.';
    }

    async function importModuleGraph(graph) {
        if (
            !graph ||
            typeof graph !== 'object' ||
            typeof graph.entrySpecifier !== 'string' ||
            !Array.isArray(graph.modules) ||
            graph.modules.length === 0
        ) throw new Error('Runner module graph is invalid.');

        const imports = {};
        const originalUrls = {};
        try {
            installWorkerBridge(Array.isArray(graph.workers) ? graph.workers : []);
            for (const module of graph.modules) {
                if (
                    !module ||
                    typeof module !== 'object' ||
                    typeof module.specifier !== 'string' ||
                    typeof module.url !== 'string' ||
                    typeof module.mimeType !== 'string' ||
                    !(typeof module.source === 'string' || module.source instanceof ArrayBuffer)
                ) throw new Error('Runner module graph contains an invalid module.');
                if (Object.prototype.hasOwnProperty.call(imports, module.specifier)) {
                    throw new Error(`Runner module graph contains duplicate specifier "${module.specifier}".`);
                }
                const blobUrl = URL.createObjectURL(new Blob([module.source], { type: module.mimeType }));
                moduleBlobUrls.push(blobUrl);
                imports[module.specifier] = blobUrl;
                originalUrls[module.url] = blobUrl;
                packageModuleOriginalUrls.set(blobUrl, module.url);
            }
            if (!Object.prototype.hasOwnProperty.call(imports, graph.entrySpecifier)) {
                throw new Error('Runner module graph does not contain its entry module.');
            }

            Object.defineProperty(globalThis, ASSET_RESOLVER, {
                configurable: true,
                value: (specifier) => {
                    if (typeof specifier !== 'string' || !Object.prototype.hasOwnProperty.call(imports, specifier)) {
                        throw new Error(`Unknown OGraf package asset "${String(specifier)}".`);
                    }
                    return imports[specifier];
                },
            });
            Object.defineProperty(globalThis, IMPORT_RESOLVER, {
                configurable: true,
                value: (specifier, moduleUrl) => {
                    if (typeof specifier !== 'string' || typeof moduleUrl !== 'string') {
                        throw new TypeError('Dynamic OGraf imports require a string module specifier.');
                    }
                    if (!isUrlLikeSpecifier(specifier)) return specifier;
                    const resolved = new URL(specifier, moduleUrl).toString();
                    if (Object.prototype.hasOwnProperty.call(originalUrls, resolved)) {
                        return originalUrls[resolved];
                    }
                    const localPrefix = new URL(`${PREVIEW_PREFIX}${sessionId}/`, moduleUrl).toString();
                    if (resolved.startsWith(localPrefix)) {
                        throw new Error(`Dynamic OGraf module "${specifier}" was not found in the package graph.`);
                    }
                    return resolved;
                },
            });
            Object.defineProperty(globalThis, META_RESOLVER, {
                configurable: true,
                value: (specifier, moduleUrl) => {
                    if (typeof specifier !== 'string' || typeof moduleUrl !== 'string') {
                        throw new TypeError('import.meta.resolve requires a string module specifier.');
                    }
                    if (!isUrlLikeSpecifier(specifier)) return specifier;
                    // import.meta.resolve returns the original package URL. Dynamic import
                    // maps that URL to a module Blob separately, while fetch and DOM APIs
                    // must still pass through the session-bound resource bridge.
                    return new URL(specifier, moduleUrl).toString();
                },
            });

            importMapElement = document.createElement('script');
            importMapElement.type = 'importmap';
            importMapElement.textContent = JSON.stringify({ imports });
            document.head.append(importMapElement);
            await Promise.resolve();
            return await import(imports[graph.entrySpecifier]);
        } catch (error) {
            releaseModuleGraph();
            throw error;
        }
    }

    function installWorkerBridge(bundles) {
        const prepared = new Map();
        for (const bundle of bundles) {
            if (!bundle || typeof bundle.url !== 'string' || (bundle.type !== 'module' && bundle.type !== 'classic')) {
                throw new Error('Runner module graph contains an invalid Worker bundle.');
            }
            prepared.set(`${bundle.type}:${bundle.url}`, bundle);
        }

        if (typeof NativeWorker === 'function') {
            function PreviewWorker(url, options = {}) {
                const suppliedUrl = url instanceof NativeURL ? url.href : String(url);
                const originalUrl = packageModuleOriginalUrls.get(suppliedUrl) || suppliedUrl;
                const resolved = resolvePackageResourceUrl(originalUrl);
                if (!resolved) return new NativeWorker(url, options);
                const type = options?.type === 'module' ? 'module' : 'classic';
                const bundle = prepared.get(`${type}:${resolved}`);
                if (!bundle) {
                    throw inconclusiveError(`Worker "${resolved}" was not prepared because its entry path could not be resolved statically.`);
                }
                if (bundle.unsupportedReason) throw inconclusiveError(bundle.unsupportedReason);
                const workerProgram = createWorkerProgramSource(bundle);
                const workerId = `worker-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
                const worker = createWorkerProxy(workerId, resolved);
                Object.setPrototypeOf(worker, PreviewWorker.prototype);
                activeWorkerProxies.add(worker);
                void requestHostedWorker(
                    workerId,
                    type,
                    createWorkerBootstrapSource(workerProgram, resolved),
                    typeof options?.name === 'string' ? options.name : '',
                ).then((hostPort) => worker.__ografConnect(hostPort)).catch((error) => worker.__ografFail(error));
                worker.addEventListener('message', (event) => {
                    const workerError = event.data?.__ografValidatorWorkerError;
                    if (!workerError || typeof workerError.message !== 'string') return;
                    event.stopImmediatePropagation();
                    worker.dispatchEvent(new ErrorEvent('error', {
                        message: workerError.message,
                        error: new Error(workerError.message),
                    }));
                }, true);
                return worker;
            }
            PreviewWorker.prototype = Object.create(EventTarget.prototype, {
                constructor: { configurable: true, writable: true, value: PreviewWorker },
            });
            Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: PreviewWorker });
        }

        if (typeof NativeSharedWorker === 'function') {
            function UnsupportedSharedWorker() {
                throw inconclusiveError('SharedWorker cannot be tested in the isolated preview because it requires a shared origin.');
            }
            UnsupportedSharedWorker.prototype = NativeSharedWorker.prototype;
            Object.defineProperty(globalThis, 'SharedWorker', {
                configurable: true,
                writable: true,
                value: UnsupportedSharedWorker,
            });
        }
    }

    function createWorkerProxy(workerId, packagePath) {
        const proxy = new EventTarget();
        let hostPort = null;
        let terminated = false;
        const queuedMessages = [];
        const eventHandlers = { message: null, messageerror: null, error: null };

        for (const type of Object.keys(eventHandlers)) {
            Object.defineProperty(proxy, `on${type}`, {
                configurable: true,
                enumerable: true,
                get: () => eventHandlers[type],
                set: (handler) => {
                    const previous = eventHandlers[type];
                    if (typeof previous === 'function') proxy.removeEventListener(type, previous);
                    eventHandlers[type] = typeof handler === 'function' ? handler : null;
                    if (eventHandlers[type]) proxy.addEventListener(type, eventHandlers[type]);
                },
            });
        }

        proxy.postMessage = (data, transferOrOptions) => {
            if (terminated) return;
            const transfer = Array.isArray(transferOrOptions)
                ? transferOrOptions
                : Array.isArray(transferOrOptions?.transfer) ? transferOrOptions.transfer : [];
            if (hostPort) hostPort.postMessage({ type: 'post-message', data }, transfer);
            else queuedMessages.push({ data, transfer });
        };
        proxy.terminate = () => {
            if (terminated) return;
            terminated = true;
            queuedMessages.length = 0;
            if (hostPort) {
                hostPort.postMessage({ type: 'terminate' });
                hostPort.close();
                hostPort = null;
            }
            activeWorkerProxies.delete(proxy);
        };
        proxy.__ografConnect = (port) => {
            if (terminated) {
                port.postMessage({ type: 'terminate' });
                port.close();
                return;
            }
            hostPort = port;
            port.addEventListener('message', (event) => {
                const message = event.data;
                if (message?.type === 'message') {
                    proxy.dispatchEvent(new MessageEvent('message', { data: message.data, ports: event.ports }));
                } else if (message?.type === 'messageerror') {
                    proxy.dispatchEvent(new MessageEvent('messageerror', { data: message.data }));
                } else if (message?.type === 'error') {
                    proxy.dispatchEvent(new ErrorEvent('error', {
                        message: message.message || `Dedicated Worker "${packagePath}" failed.`,
                        filename: message.filename || packagePath,
                        lineno: Number(message.lineno) || 0,
                        colno: Number(message.colno) || 0,
                    }));
                }
            });
            port.start();
            for (const queued of queuedMessages.splice(0)) {
                port.postMessage({ type: 'post-message', data: queued.data }, queued.transfer);
            }
        };
        proxy.__ografFail = (error) => {
            if (terminated) return;
            const message = error instanceof Error ? error.message : String(error);
            proxy.dispatchEvent(new ErrorEvent('error', {
                message: `Dedicated Worker "${packagePath}" could not start: ${message}`,
                filename: packagePath,
            }));
        };
        return proxy;
    }

    function requestHostedWorker(workerId, workerType, source, workerName) {
        if (!postPort) return Promise.reject(new Error('Preview runner is not connected.'));
        const requestId = `worker-start-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const pending = pendingWorkerRequests.get(requestId);
                if (!pending) return;
                pendingWorkerRequests.delete(requestId);
                reject(new Error(`Timed out while starting Dedicated Worker "${workerId}".`));
            }, 10_000);
            pendingWorkerRequests.set(requestId, { resolve, reject, timeout });
            post({
                type: 'OGRAF_RUNNER_WORKER_START',
                requestId,
                workerId,
                workerType,
                workerName,
                source,
            });
        });
    }

    function createWorkerProgramSource(bundle) {
        if (bundle.type === 'module') {
            if (typeof bundle.source !== 'string') throw new Error('Prepared module Worker source is missing.');
            return bundle.source;
        }
        if (!Array.isArray(bundle.entries) || typeof bundle.entryId !== 'string') {
            throw new Error('Prepared classic Worker graph is invalid.');
        }
        const replacements = new Map();
        let entrySource;
        for (const entry of bundle.entries) {
            let source = entry.source;
            for (const [placeholder, dependencySource] of replacements) {
                source = source.split(placeholder).join(dependencySource);
            }
            replacements.set(`/*__OGRAF_CLASSIC_${entry.id}__*/`, source);
            if (entry.id === bundle.entryId) entrySource = source;
        }
        if (!entrySource) throw new Error('Prepared classic Worker graph does not contain its entry.');
        return entrySource;
    }

    function createWorkerBootstrapSource(workerProgram, workerUrl) {
        return `
const reportWorkerError = (error) => self.postMessage({ __ografValidatorWorkerError: {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
} });
self.addEventListener('error', (event) => {
    event.preventDefault();
    reportWorkerError(event.error || event.message || 'Unknown Dedicated Worker error.');
});
self.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
    reportWorkerError(event.reason);
});
const queuedMessages = [];
let initialized = false;
const captureMessage = (event) => {
    if (!initialized && event.data?.type === 'OGRAF_WORKER_INIT' && event.ports?.[0]) return;
    if (!initialized) {
        event.stopImmediatePropagation();
        queuedMessages.push({ data: event.data, ports: [...event.ports] });
    }
};
self.addEventListener('message', captureMessage, true);
(async () => {
    const resourcePort = await new Promise((resolve) => {
        const onInit = (event) => {
            if (event.data?.type !== 'OGRAF_WORKER_INIT' || !event.ports?.[0]) return;
            self.removeEventListener('message', onInit);
            event.stopImmediatePropagation();
            resolve(event.ports[0]);
        };
        self.addEventListener('message', onInit, true);
    });
    const pending = new Map();
    resourcePort.addEventListener('message', (event) => {
        const message = event.data;
        const request = pending.get(message?.requestId);
        if (!request) return;
        pending.delete(message.requestId);
        if (message.ok === true) request.resolve(message.result);
        else request.reject(new Error(message.error?.message || String(message.error || 'Worker resource request failed.')));
    });
    resourcePort.start();
    const nativeFetch = self.fetch.bind(self);
    self.fetch = async (input, init) => {
        const rawUrl = input instanceof Request ? input.url : String(input);
        let resolved;
        try { resolved = new URL(rawUrl, ${JSON.stringify(workerUrl)}); }
        catch { return nativeFetch(input, init); }
        if (!resolved.pathname.startsWith(${JSON.stringify(`${PREVIEW_PREFIX}${sessionId}/`)})) return nativeFetch(input, init);
        const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (method !== 'GET' && method !== 'HEAD') return new Response(null, { status: 405, statusText: 'Method Not Allowed' });
        const requestId = 'worker-' + Math.random().toString(36).slice(2);
        const resource = await new Promise((resolve, reject) => {
            pending.set(requestId, { resolve, reject });
            resourcePort.postMessage({ type: 'OGRAF_WORKER_FILE_REQUEST', requestId, url: resolved.toString(), method });
        });
        return new Response(method === 'HEAD' ? null : resource.buffer, { status: 200, headers: { 'Content-Type': resource.mimeType } });
    };
    ${workerProgram}
    initialized = true;
    self.removeEventListener('message', captureMessage, true);
    for (const message of queuedMessages) self.dispatchEvent(new MessageEvent('message', message));
})().catch((error) => {
    reportWorkerError(error);
});`;
    }

    function inconclusiveError(message) {
        const error = new Error(`OGRAF_PREVIEW_INCONCLUSIVE: ${message}`);
        error.name = 'OgrafPreviewInconclusiveError';
        return error;
    }

    function releaseModuleGraph() {
        delete globalThis[ASSET_RESOLVER];
        delete globalThis[IMPORT_RESOLVER];
        delete globalThis[META_RESOLVER];
        if (typeof NativeWorker === 'function') globalThis.Worker = NativeWorker;
        if (typeof NativeSharedWorker === 'function') globalThis.SharedWorker = NativeSharedWorker;
        for (const worker of [...activeWorkerProxies]) worker.terminate();
        activeWorkerProxies.clear();
        importMapElement?.remove();
        importMapElement = null;
        while (moduleBlobUrls.length > 0) {
            const url = moduleBlobUrls.pop();
            if (url) URL.revokeObjectURL(url);
        }
        for (const url of packageResourceBlobUrls.values()) NativeURL.revokeObjectURL(url);
        packageResourceBlobUrls.clear();
        packageModuleOriginalUrls.clear();
        pendingPackageResourceBlobUrls.clear();
        for (const url of resourceGraphBlobUrls) NativeURL.revokeObjectURL(url);
        resourceGraphBlobUrls.clear();
        rejectPendingResourceRequests(new Error('Preview resource graph was released.'));
        for (const pending of pendingWorkerRequests.values()) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Preview Worker host was released.'));
        }
        pendingWorkerRequests.clear();
    }

    function normalizePayload(method, value) {
        if (value === undefined) {
            if (method === 'playAction') {
                return invalidPayload(value, 'playAction must resolve to a ReturnPayload containing currentStep.');
            }
            return validPayload(value, 200);
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return invalidPayload(value, 'Return payload must be an object or undefined.');
        }
        if (method === 'setActionsSchedule') {
            const invalidKey = Object.keys(value).find((key) => !key.startsWith('v_'));
            return invalidKey
                ? invalidPayload(value, `EmptyPayload contains non-vendor field "${invalidKey}".`)
                : validPayload(value, 200);
        }
        const allowedFields = new Set([
            'statusCode', 'statusMessage', 'result',
            ...(method === 'playAction' ? ['currentStep'] : []),
        ]);
        const invalidField = Object.keys(value).find((key) => !allowedFields.has(key) && !key.startsWith('v_'));
        if (invalidField) return invalidPayload(value, `ReturnPayload contains non-vendor field "${invalidField}".`);
        if (!Object.prototype.hasOwnProperty.call(value, 'statusCode')) {
            return invalidPayload(value, 'ReturnPayload.statusCode is required.');
        }
        if (!Number.isInteger(value.statusCode) || value.statusCode < 100 || value.statusCode > 599) {
            return invalidPayload(value, 'ReturnPayload.statusCode must be an integer between 100 and 599.');
        }
        if (value.statusMessage !== undefined && typeof value.statusMessage !== 'string') {
            return invalidPayload(value, 'ReturnPayload.statusMessage must be a string when present.');
        }

        let hasCurrentStep = false;
        let currentStep;
        if (method === 'playAction') {
            hasCurrentStep = Object.prototype.hasOwnProperty.call(value, 'currentStep');
            if (!hasCurrentStep) return invalidPayload(value, 'playAction ReturnPayload must contain currentStep.');
            if (value.currentStep === undefined) currentStep = null;
            else if (Number.isInteger(value.currentStep) && value.currentStep >= 0) currentStep = value.currentStep;
            else return invalidPayload(value, 'playAction.currentStep must be a zero-based integer or undefined.');
        }

        return {
            valid: true,
            successful: value.statusCode >= 200 && value.statusCode < 300,
            statusCode: value.statusCode,
            ...(typeof value.statusMessage === 'string' ? { statusMessage: value.statusMessage } : {}),
            ...(Object.prototype.hasOwnProperty.call(value, 'result') ? { result: safeClone(value.result) } : {}),
            hasCurrentStep,
            ...(hasCurrentStep ? { currentStep } : {}),
            raw: safeClone(value),
        };
    }

    function validPayload(raw, statusCode) {
        return { valid: true, successful: true, statusCode, hasCurrentStep: false, raw: safeClone(raw) };
    }

    function invalidPayload(raw, error) {
        return { valid: false, successful: false, statusCode: 500, hasCurrentStep: false, error, raw: safeClone(raw) };
    }

    function updateScale() {
        stage.style.width = `${logicalWidth}px`;
        stage.style.height = `${logicalHeight}px`;
        const scale = Math.min(innerWidth / logicalWidth, innerHeight / logicalHeight);
        stage.style.transform = `scale(${Number.isFinite(scale) && scale > 0 ? scale : 1})`;
    }

    function respond(requestId, ok, result, error) {
        post({ type: 'OGRAF_RUNNER_RESPONSE', requestId, ok, result, error });
    }

    function post(message) {
        if (!postPort) return;
        postPort({ protocol: PROTOCOL_VERSION, runnerId, sessionId, ...message });
    }

    function isPromiseLike(value) {
        return value !== null && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function';
    }

    function positiveNumber(value, fallback) {
        return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
    }

    function isUrlLikeSpecifier(specifier) {
        return specifier.startsWith('.') || specifier.startsWith('/') || /^[A-Za-z][A-Za-z\d+.-]*:/.test(specifier);
    }

    function serializeError(error) {
        if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
        if (error instanceof Event) {
            const target = error.target;
            const resource = target && typeof target === 'object'
                ? packageElementUrls.get(target)?.values().next().value || target.currentSrc || target.src || target.href
                : undefined;
            return {
                name: 'Event',
                message: resource
                    ? `${error.type || 'error'} event while loading "${resource}".`
                    : `${error.type || 'error'} event from the Graphic.`,
            };
        }
        return { name: 'Error', message: String(error) };
    }

    function safeClone(value, depth = 0, seen = new WeakSet()) {
        if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return value;
        if (typeof value === 'bigint') return `${value}n`;
        if (typeof value === 'function' || typeof value === 'symbol') return String(value);
        if (depth > 5) return '[Max depth]';
        if (value instanceof Error) return serializeError(value);
        if (typeof value === 'object') {
            if (seen.has(value)) return '[Circular]';
            seen.add(value);
            if (Array.isArray(value)) return value.map((item) => safeClone(item, depth + 1, seen));
            const copy = {};
            for (const [key, item] of Object.entries(value)) {
                try { copy[key] = safeClone(item, depth + 1, seen); } catch { copy[key] = '[Unserializable]'; }
            }
            return copy;
        }
        return String(value);
    }
})();
