import { useCallback, useEffect, useRef, useState } from 'react';
import { buildImportUrl, buildPreviewData } from './use-preview-sw.js';
import {
    DEFAULT_RENDER_CHARACTERISTICS,
    MAX_LOG_ENTRIES,
    type ApiMethod,
    type CustomActionParams,
    type LogEntry,
    type OgrafElement,
    type PlayActionParams,
    type PlayActionReturnPayload,
    type PreviewState,
    type RenderCharacteristics,
    type ScheduleEntry,
    type StopActionParams,
} from './preview-types.js';

// ─── Session-storage persistence ─────────────────────────────────────────────

interface PersistedState {
    currentData: Record<string, unknown>;
    renderType: 'realtime' | 'non-realtime';
    renderCharacteristics: RenderCharacteristics;
    skipAnimationDefault: boolean;
}

function loadPersisted(key: string): Partial<PersistedState> {
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return {};

        return JSON.parse(raw) as Partial<PersistedState>;
    } catch {
        return {};
    }
}

function savePersisted(key: string, data: PersistedState): void {
    try {
        sessionStorage.setItem(key, JSON.stringify(data));
    } catch { /* quota exceeded — ignore */ }
}

interface UsePreviewGraphicOptions {
    swReady: boolean;
    manifest: unknown;
    packagePath: string;
}

interface UsePreviewGraphicReturn {
    state: PreviewState;
    containerRef: React.RefObject<HTMLDivElement>;
    isMounted: boolean;
    setCurrentData: (data: Record<string, unknown>) => void;
    setRenderType: (type: 'realtime' | 'non-realtime') => void;
    setRenderCharacteristics: (rc: RenderCharacteristics) => void;
    setSkipAnimationDefault: (skip: boolean) => void;
    resetData: () => void;
    callLoad: () => Promise<void>;
    callDispose: () => Promise<void>;
    callPlay: (opts?: PlayActionParams) => Promise<void>;
    callStop: (opts?: StopActionParams) => Promise<void>;
    callUpdate: (opts?: { skipAnimation?: boolean }) => Promise<void>;
    callCustom: (id: string, payload: unknown, opts?: { skipAnimation?: boolean }) => Promise<void>;
    callGoToTime: (timestamp: number) => Promise<void>;
    callSetSchedule: (schedule: ScheduleEntry[]) => Promise<void>;
    clearLog: () => void;
    reMount: () => Promise<void>;
}

function getMainFile(manifest: unknown): string | undefined {
    if (typeof manifest !== 'object' || manifest === null) return undefined;
    const value = (manifest as Record<string, unknown>)['main'];

    return typeof value === 'string' ? value : undefined;
}

function extractCurrentStep(result: unknown): number | undefined {
    if (typeof result !== 'object' || result === null) return undefined;
    const r = result as Record<string, unknown>;
    const inner = r['result'];
    if (typeof inner !== 'object' || inner === null) return undefined;
    const step = (inner as Record<string, unknown>)['currentStep'];

    return typeof step === 'number' ? step : undefined;
}

function makeLogId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function usePreviewGraphic({
    swReady,
    manifest,
    packagePath,
}: UsePreviewGraphicOptions): UsePreviewGraphicReturn {
    const containerRef = useRef<HTMLDivElement>(null);
    const elementRef = useRef<OgrafElement | null>(null);
    // Once a class is registered we must reuse its tag name – Chrome throws
    // NotSupportedError if customElements.define() is called again with it.
    const registrationRef = useRef<{
        tagName: string;
        GraphicClass: new () => OgrafElement;
    } | null>(null);
    // Saved originals while console is patched
    const consolePatchRef = useRef<{
        log: typeof console.log;
        warn: typeof console.warn;
        error: typeof console.error;
        info: typeof console.info;
    } | null>(null);

    const sessionKey = `ograf-preview:${packagePath}`;

    const supportsRealTime =
        typeof manifest === 'object' && manifest !== null
            ? (manifest as Record<string, unknown>)['supportsRealTime'] !== false
            : true;

    const [state, setState] = useState<PreviewState>(() => {
        const persisted = loadPersisted(sessionKey);

        return {
            phase: 'idle',
            currentStep: undefined,
            currentData: persisted.currentData ?? buildPreviewData(manifest),
            renderType: persisted.renderType ?? (supportsRealTime ? 'realtime' : 'non-realtime'),
            renderCharacteristics: persisted.renderCharacteristics ?? DEFAULT_RENDER_CHARACTERISTICS,
            skipAnimationDefault: persisted.skipAnimationDefault ?? false,
            log: [],
            error: null,
        };
    });

    const stateRef = useRef(state);
    stateRef.current = state;

    // Persist user-editable state across page reloads (sessionStorage per package)
    useEffect(() => {
        savePersisted(sessionKey, {
            currentData: state.currentData,
            renderType: state.renderType,
            renderCharacteristics: state.renderCharacteristics,
            skipAnimationDefault: state.skipAnimationDefault,
        });
    }, [sessionKey, state.currentData, state.renderType, state.renderCharacteristics, state.skipAnimationDefault]);

    const mainFile = getMainFile(manifest);

    const appendLog = useCallback((entry: LogEntry) => {
        setState((prev) => {
            const nextLog = [entry, ...prev.log];
            if (nextLog.length > MAX_LOG_ENTRIES) nextLog.length = MAX_LOG_ENTRIES;

            return { ...prev, log: nextLog };
        });
    }, []);

    const patchConsole = useCallback(() => {
        if (consolePatchRef.current) return;

        const originals = {
            log:   console.log.bind(console) as typeof console.log,
            warn:  console.warn.bind(console) as typeof console.warn,
            error: console.error.bind(console) as typeof console.error,
            info:  console.info.bind(console) as typeof console.info,
        };
        consolePatchRef.current = originals;

        const capture = (level: 'log' | 'warn' | 'error' | 'info') =>
            (...args: unknown[]): void => {
                // Forward to the original so DevTools still see it
                (originals[level] as (...a: unknown[]) => void)(...args);
                appendLog({
                    id: makeLogId(),
                    timestamp: Date.now(),
                    method: `console.${level}` as ApiMethod,
                    params: args.length === 1 ? args[0] : args,
                    durationMs: 0,
                });
            };

        console.log   = capture('log');
        console.warn  = capture('warn');
        console.error = capture('error');
        console.info  = capture('info');
    }, [appendLog]);

    const restoreConsole = useCallback(() => {
        if (!consolePatchRef.current) return;
        const orig = consolePatchRef.current;
        console.log   = orig.log;
        console.warn  = orig.warn;
        console.error = orig.error;
        console.info  = orig.info;
        consolePatchRef.current = null;
    }, []);

    /**
     * Wrap an API call in timing + logging + error handling.
     * Returns the result (or undefined on error).
     */
    const invoke = useCallback(
        async <T>(
            method: ApiMethod,
            params: unknown,
            fn: () => Promise<T | void> | T | void,
        ): Promise<T | undefined> => {
            const started = performance.now();
            try {
                const result = await fn();
                const durationMs = Math.round(performance.now() - started);
                appendLog({
                    id: makeLogId(),
                    timestamp: Date.now(),
                    method,
                    params,
                    result,
                    durationMs,
                });

                return result ?? undefined;
            } catch (err) {
                const durationMs = Math.round(performance.now() - started);
                const message = err instanceof Error ? err.message : String(err);
                appendLog({
                    id: makeLogId(),
                    timestamp: Date.now(),
                    method,
                    params,
                    error: message,
                    durationMs,
                });
                setState((prev) => ({ ...prev, phase: 'error', error: `${method}() failed: ${message}` }));

                return undefined;
            }
        },
        [appendLog],
    );

    // ─── Mount a new element instance from a registered graphic class ────────

    const mountGraphicClass = useCallback(
        async (GraphicClass: new () => OgrafElement): Promise<void> => {
            const container = containerRef.current;
            if (!container) return;

            // Stop and remove any old element
            if (elementRef.current?.stopAction) {
                try { void elementRef.current.stopAction(); } catch { /* ignore */ }
            }
            elementRef.current = null;
            container.innerHTML = '';
            restoreConsole();

            // Reuse the registered tag name for this class, or register a new one
            let tagName: string;
            const existing = registrationRef.current;
            if (existing && existing.GraphicClass === GraphicClass) {
                tagName = existing.tagName;
            } else {
                tagName = `ograf-preview-${Date.now()}`;
                customElements.define(tagName, GraphicClass);
                registrationRef.current = { tagName, GraphicClass };
            }

            const el = document.createElement(tagName) as OgrafElement;
            el.style.cssText = 'display:block;width:100%;height:100%;';
            elementRef.current = el;
            patchConsole();
            container.appendChild(el);

            // Wait one frame so the browser computes layout before load() reads
            // container dimensions (e.g. Lottie calls offsetWidth/offsetHeight).
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

            setState((prev) => ({ ...prev, phase: 'loading', error: null }));

            if (!el.load) {
                setState((prev) => ({ ...prev, phase: 'loaded' }));

                return;
            }

            const snapshot = stateRef.current;
            const params = {
                data: snapshot.currentData,
                renderType: snapshot.renderType,
                renderCharacteristics: snapshot.renderCharacteristics,
            };
            const result = await invoke('load', params, () => el.load!(params));
            if (result !== undefined || stateRef.current.phase !== 'error') {
                setState((prev) => ({ ...prev, phase: 'loaded' }));
            }
        },
        [invoke, patchConsole, restoreConsole],
    );

    // ─── Import the module once per package + SW ready ───────────────────────

    useEffect(() => {
        if (!swReady || !mainFile) return;

        registrationRef.current = null;
        setState((prev) => ({
            ...prev,
            phase: 'importing',
            error: null,
            currentStep: undefined,
            currentData: buildPreviewData(manifest),
        }));

        const importUrl = buildImportUrl(mainFile);
        let cancelled = false;

        void (async () => {
            try {
                const mod = await import(/* @vite-ignore */ importUrl) as {
                    default?: new () => OgrafElement;
                };
                if (cancelled) return;

                const Cls = mod.default;
                if (!Cls || typeof Cls !== 'function') {
                    setState((prev) => ({
                        ...prev,
                        phase: 'error',
                        error: 'Module has no default export (expected an HTMLElement class).',
                    }));

                    return;
                }

                await mountGraphicClass(Cls);
            } catch (err) {
                if (cancelled) return;
                const message = err instanceof Error ? err.message : String(err);
                setState((prev) => ({
                    ...prev,
                    phase: 'error',
                    error: `Import failed: ${message}`,
                }));
            }
        })();

        return () => {
            cancelled = true;
            restoreConsole();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [swReady, mainFile, packagePath]);

    // ─── Public action invokers ─────────────────────────────────────────────

    const callLoad = useCallback(async (): Promise<void> => {
        const reg = registrationRef.current;
        if (!reg) return;
        await mountGraphicClass(reg.GraphicClass);
    }, [mountGraphicClass]);

    const callDispose = useCallback(async (): Promise<void> => {
        const el = elementRef.current;
        if (!el) return;

        if (el.dispose) {
            await invoke('dispose', {}, () => el.dispose!({}));
        }

        restoreConsole();
        if (containerRef.current) containerRef.current.innerHTML = '';
        elementRef.current = null;
        setState((prev) => ({ ...prev, phase: 'disposed', currentStep: undefined }));
    }, [invoke, restoreConsole]);

    const callPlay = useCallback(
        async (opts: PlayActionParams = {}): Promise<void> => {
            const el = elementRef.current;
            if (!el?.playAction) return;

            const params: PlayActionParams = {
                ...(opts.delta !== undefined ? { delta: opts.delta } : { delta: 1 }),
                ...(opts.goto !== undefined ? { goto: opts.goto } : {}),
                skipAnimation: opts.skipAnimation ?? stateRef.current.skipAnimationDefault,
            };

            setState((prev) => ({ ...prev, phase: 'playing' }));
            const result = await invoke<PlayActionReturnPayload>(
                'playAction',
                params,
                () => el.playAction!(params) as Promise<PlayActionReturnPayload | void>,
            );

            const nextStep = extractCurrentStep(result);
            setState((prev) => ({
                ...prev,
                phase: prev.phase === 'error' ? 'error' : 'loaded',
                currentStep: nextStep ?? prev.currentStep,
            }));
        },
        [invoke],
    );

    const callStop = useCallback(
        async (opts: StopActionParams = {}): Promise<void> => {
            const el = elementRef.current;
            if (!el?.stopAction) return;

            const params: StopActionParams = {
                skipAnimation: opts.skipAnimation ?? stateRef.current.skipAnimationDefault,
            };

            await invoke('stopAction', params, () => el.stopAction!(params));
            setState((prev) => ({
                ...prev,
                phase: prev.phase === 'error' ? 'error' : 'stopped',
            }));
        },
        [invoke],
    );

    const callUpdate = useCallback(
        async (opts: { skipAnimation?: boolean } = {}): Promise<void> => {
            const el = elementRef.current;
            if (!el?.updateAction) return;

            const params = {
                data: stateRef.current.currentData,
                skipAnimation: opts.skipAnimation ?? stateRef.current.skipAnimationDefault,
            };
            await invoke('updateAction', params, () => el.updateAction!(params));
        },
        [invoke],
    );

    const callCustom = useCallback(
        async (id: string, payload: unknown, opts: { skipAnimation?: boolean } = {}): Promise<void> => {
            const el = elementRef.current;
            if (!el?.customAction) return;

            const params: CustomActionParams = {
                id,
                payload,
                skipAnimation: opts.skipAnimation ?? stateRef.current.skipAnimationDefault,
            };
            await invoke('customAction', params, () => el.customAction!(params));
        },
        [invoke],
    );

    const callGoToTime = useCallback(
        async (timestamp: number): Promise<void> => {
            const el = elementRef.current;
            if (!el?.goToTime) return;
            await invoke('goToTime', { timestamp }, () => el.goToTime!({ timestamp }));
        },
        [invoke],
    );

    const callSetSchedule = useCallback(
        async (schedule: ScheduleEntry[]): Promise<void> => {
            const el = elementRef.current;
            if (!el?.setActionsSchedule) return;
            await invoke('setActionsSchedule', { schedule }, () => el.setActionsSchedule!({ schedule }));
        },
        [invoke],
    );

    const reMount = useCallback(async (): Promise<void> => {
        const reg = registrationRef.current;
        if (!reg) return;
        await mountGraphicClass(reg.GraphicClass);
    }, [mountGraphicClass]);

    // ─── Simple setters ────────────────────────────────────────────────────

    const setCurrentData = useCallback((data: Record<string, unknown>) => {
        setState((prev) => ({ ...prev, currentData: data }));
    }, []);

    const setRenderType = useCallback((type: 'realtime' | 'non-realtime') => {
        setState((prev) => ({ ...prev, renderType: type }));
    }, []);

    const setRenderCharacteristics = useCallback((rc: RenderCharacteristics) => {
        setState((prev) => ({ ...prev, renderCharacteristics: rc }));
    }, []);

    const setSkipAnimationDefault = useCallback((skip: boolean) => {
        setState((prev) => ({ ...prev, skipAnimationDefault: skip }));
    }, []);

    const resetData = useCallback(() => {
        setState((prev) => ({ ...prev, currentData: buildPreviewData(manifest) }));
    }, [manifest]);

    const clearLog = useCallback(() => {
        setState((prev) => ({ ...prev, log: [] }));
    }, []);

    const isMounted = elementRef.current !== null;

    return {
        state,
        containerRef,
        isMounted,
        setCurrentData,
        setRenderType,
        setRenderCharacteristics,
        setSkipAnimationDefault,
        resetData,
        callLoad,
        callDispose,
        callPlay,
        callStop,
        callUpdate,
        callCustom,
        callGoToTime,
        callSetSchedule,
        clearLog,
        reMount,
    };
}
