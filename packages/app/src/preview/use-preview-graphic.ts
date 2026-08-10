import { useCallback, useEffect, useRef, useState } from 'react';
import {
    NON_REALTIME_METHODS,
    REQUIRED_METHODS,
    validateSchedule,
    type NormalizedReturnPayload,
    type OgrafApiMethod,
} from './preview-contract.js';
import {
    createPreviewRunner,
    type PreviewRunner,
} from './preview-runner-client.js';
import { selectRuntimeRenderRequirement } from './render-requirements.js';
import {
    MAX_LOG_ENTRIES,
    toOgrafRenderCharacteristics,
    type LogEntry,
    type PlayActionParams,
    type PreviewState,
    type RenderCharacteristics,
    type ScheduleEntry,
    type StopActionParams,
} from './preview-types.js';
import {
    buildImportUrl,
    buildPreviewData,
    createPreviewSession,
    type PreviewSession,
} from './use-preview-sw.js';

interface PersistedState {
    currentData: Record<string, unknown>;
    renderType: 'realtime' | 'non-realtime';
    renderCharacteristics: RenderCharacteristics;
    skipAnimationDefault: boolean;
}

export interface UsePreviewGraphicOptions {
    swReady: boolean;
    dirHandle: FileSystemDirectoryHandle;
    manifest: unknown;
    packagePath: string;
}

export interface UsePreviewGraphicReturn {
    state: PreviewState;
    containerRef: React.RefObject<HTMLDivElement>;
    isMounted: boolean;
    setCurrentData: (data: Record<string, unknown>) => void;
    setRenderType: (type: 'realtime' | 'non-realtime') => void;
    setRenderCharacteristics: (value: RenderCharacteristics) => void;
    setSkipAnimationDefault: (skip: boolean) => void;
    resetData: () => void;
    callLoad: () => Promise<void>;
    callDispose: () => Promise<void>;
    callPlay: (options?: PlayActionParams) => Promise<void>;
    callStop: (options?: StopActionParams) => Promise<void>;
    callUpdate: (options?: { skipAnimation?: boolean }) => Promise<void>;
    callCustom: (id: string, payload: unknown, options?: { skipAnimation?: boolean }) => Promise<void>;
    callGoToTime: (timestamp: number) => Promise<void>;
    callSetSchedule: (schedule: ScheduleEntry[]) => Promise<void>;
    clearLog: () => void;
    reMount: () => Promise<void>;
}

export function usePreviewGraphic({
    swReady,
    dirHandle,
    manifest,
    packagePath,
}: UsePreviewGraphicOptions): UsePreviewGraphicReturn {
    const containerRef = useRef<HTMLDivElement>(null);
    const runnerRef = useRef<PreviewRunner | null>(null);
    const sessionRef = useRef<PreviewSession | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const generationRef = useRef(0);
    const teardownQueueRef = useRef<Promise<void>>(Promise.resolve());
    const sessionKey = `ograf-preview:${packagePath}`;
    const supportsRealTime = readBoolean(manifest, 'supportsRealTime') !== false;
    const supportsNonRealTime = readBoolean(manifest, 'supportsNonRealTime') === true;
    const mainFile = readString(manifest, 'main');

    const [state, setState] = useState<PreviewState>(() => {
        const persisted = loadPersisted(sessionKey);
        return {
            phase: 'idle',
            currentStep: undefined,
            currentData: persisted.currentData ?? buildPreviewData(manifest),
            renderType: persisted.renderType ?? (supportsRealTime ? 'realtime' : 'non-realtime'),
            renderCharacteristics: persisted.renderCharacteristics ?? extractRenderCharacteristics(manifest),
            skipAnimationDefault: persisted.skipAnimationDefault ?? false,
            log: [],
            error: null,
        };
    });
    const stateRef = useRef(state);
    stateRef.current = state;

    useEffect(() => {
        savePersisted(sessionKey, {
            currentData: state.currentData,
            renderType: state.renderType,
            renderCharacteristics: state.renderCharacteristics,
            skipAnimationDefault: state.skipAnimationDefault,
        });
    }, [sessionKey, state.currentData, state.renderType, state.renderCharacteristics, state.skipAnimationDefault]);

    const appendLog = useCallback((entry: LogEntry) => {
        setState((previous) => ({
            ...previous,
            log: [entry, ...previous.log].slice(0, MAX_LOG_ENTRIES),
        }));
    }, []);

    const teardownCurrent = useCallback(async (callDispose: boolean): Promise<void> => {
        const runner = runnerRef.current;
        const session = sessionRef.current;
        runnerRef.current = null;
        sessionRef.current = null;

        const teardown = async () => {
            if (runner) {
                if (callDispose && runner.methods.includes('dispose')) {
                    try {
                        await runner.call('dispose', {}, { timeoutMs: 10_000 });
                    } catch {
                        // destroy() still removes the isolated browsing context.
                    }
                }
                await runner.destroy();
            }
            session?.close();
        };
        const queued = teardownQueueRef.current.then(teardown, teardown);
        teardownQueueRef.current = queued.catch(() => undefined);
        await queued;
    }, []);

    const invoke = useCallback(async (
        method: OgrafApiMethod,
        params: unknown,
    ): Promise<NormalizedReturnPayload | undefined> => {
        const runner = runnerRef.current;
        const started = performance.now();
        if (!runner || !runner.methods.includes(method)) {
            const message = `${method}() is not implemented.`;
            appendLog(logEntry(method, params, started, undefined, message));
            setState((previous) => ({ ...previous, phase: 'error', error: message }));
            return undefined;
        }

        try {
            const call = await runner.call(method, params, { timeoutMs: 10_000 });
            if (!call.wasPromise) throw new Error(`${method}() must return a Promise.`);
            if (!call.normalized.valid) throw new Error(call.normalized.error ?? 'Invalid return payload.');
            if (!call.normalized.successful) {
                throw new Error(
                    `${method}() returned status ${call.normalized.statusCode}${
                        call.normalized.statusMessage ? `: ${call.normalized.statusMessage}` : ''
                    }.`,
                );
            }
            appendLog(logEntry(method, params, started, call.normalized.raw));
            return call.normalized;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            appendLog(logEntry(method, params, started, undefined, message));
            setState((previous) => ({ ...previous, phase: 'error', error: message }));
            return undefined;
        }
    }, [appendLog]);

    const mount = useCallback(async (): Promise<void> => {
        const container = containerRef.current;
        if (!swReady || !mainFile || !container) return;
        const generation = ++generationRef.current;
        abortRef.current?.abort();
        const abortController = new AbortController();
        abortRef.current = abortController;
        await teardownCurrent(true);
        if (generation !== generationRef.current || abortController.signal.aborted) return;
        container.replaceChildren();

        const session = createPreviewSession(dirHandle);
        sessionRef.current = session;
        const importUrl = buildImportUrl(mainFile, session.sessionId);
        setState((previous) => ({
            ...previous,
            phase: 'importing',
            error: null,
            currentStep: undefined,
        }));

        try {
            const snapshot = stateRef.current;
            const runner = await createPreviewRunner({
                sessionId: session.sessionId,
                importUrl,
                mount: container,
                width: snapshot.renderCharacteristics.width,
                height: snapshot.renderCharacteristics.height,
                timeoutMs: 10_000,
                signal: abortController.signal,
                onLog: ({ level, args }) => appendLog({
                    id: makeLogId(),
                    timestamp: Date.now(),
                    method: `console.${level}`,
                    params: args.length === 1 ? args[0] : args,
                    durationMs: 0,
                }),
                onRuntimeError: (message) => {
                    appendLog({
                        id: makeLogId(),
                        timestamp: Date.now(),
                        method: 'console.error',
                        params: message,
                        error: message,
                        durationMs: 0,
                    });
                    setState((previous) => ({ ...previous, phase: 'error', error: message }));
                },
            });
            if (generation !== generationRef.current || abortController.signal.aborted) {
                await runner.destroy();
                session.close();
                return;
            }
            runnerRef.current = runner;

            const required = supportsNonRealTime
                ? [...REQUIRED_METHODS, ...NON_REALTIME_METHODS]
                : [...REQUIRED_METHODS];
            const missing = required.filter((method) => !runner.methods.includes(method));
            if (missing.length > 0) {
                throw new Error(`Missing required method(s): ${missing.map((method) => `${method}()`).join(', ')}.`);
            }

            setState((previous) => ({ ...previous, phase: 'loading', error: null }));
            const loaded = await invoke('load', {
                data: snapshot.currentData,
                renderType: snapshot.renderType,
                renderCharacteristics: toOgrafRenderCharacteristics(snapshot.renderCharacteristics),
            });
            if (loaded && generation === generationRef.current) {
                setState((previous) => ({ ...previous, phase: 'loaded', error: null }));
            }
        } catch (error) {
            if (abortController.signal.aborted || generation !== generationRef.current) return;
            const message = error instanceof Error ? error.message : String(error);
            setState((previous) => ({ ...previous, phase: 'error', error: message }));
            await teardownCurrent(true);
        }
    }, [appendLog, dirHandle, invoke, mainFile, supportsNonRealTime, swReady, teardownCurrent]);

    useEffect(() => {
        if (!swReady || !mainFile) return;
        const persisted = loadPersisted(sessionKey);
        const nextState: PreviewState = {
            ...stateRef.current,
            currentData: persisted.currentData ?? buildPreviewData(manifest),
            renderCharacteristics: persisted.renderCharacteristics ?? extractRenderCharacteristics(manifest),
            renderType: persisted.renderType ?? (supportsRealTime ? 'realtime' : 'non-realtime'),
            skipAnimationDefault: persisted.skipAnimationDefault ?? stateRef.current.skipAnimationDefault,
            currentStep: undefined,
        };
        stateRef.current = nextState;
        setState(nextState);
        void mount();

        return () => {
            // Cleanup must invalidate the latest generation, not the value captured at mount time.
            // eslint-disable-next-line react-hooks/exhaustive-deps
            ++generationRef.current;
            abortRef.current?.abort();
            abortRef.current = null;
            void teardownCurrent(true);
        };
        // packagePath is the identity boundary; manifest object identity is intentionally ignored.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [swReady, mainFile, packagePath, dirHandle]);

    const callDispose = useCallback(async (): Promise<void> => {
        if (!runnerRef.current) return;
        const disposed = await invoke('dispose', {});
        if (!disposed || stateRef.current.phase === 'error') return;
        await teardownCurrent(false);
        setState((previous) => previous.phase === 'error'
            ? previous
            : { ...previous, phase: 'disposed', currentStep: undefined });
    }, [invoke, teardownCurrent]);

    const callPlay = useCallback(async (options: PlayActionParams = {}): Promise<void> => {
        const params: PlayActionParams = {
            ...(options.goto !== undefined
                ? { goto: options.goto }
                : { delta: options.delta ?? 1 }),
            skipAnimation: options.skipAnimation ?? stateRef.current.skipAnimationDefault,
        };
        setState((previous) => ({ ...previous, phase: 'playing' }));
        const payload = await invoke('playAction', params);
        setState((previous) => ({
            ...previous,
            phase: previous.phase === 'error' ? 'error' : 'loaded',
            currentStep: payload?.hasCurrentStep ? payload.currentStep : previous.currentStep,
        }));
    }, [invoke]);

    const callStop = useCallback(async (options: StopActionParams = {}): Promise<void> => {
        await invoke('stopAction', {
            skipAnimation: options.skipAnimation ?? stateRef.current.skipAnimationDefault,
        });
        setState((previous) => ({
            ...previous,
            phase: previous.phase === 'error' ? 'error' : 'stopped',
        }));
    }, [invoke]);

    const callUpdate = useCallback(async (options: { skipAnimation?: boolean } = {}): Promise<void> => {
        await invoke('updateAction', {
            data: stateRef.current.currentData,
            skipAnimation: options.skipAnimation ?? stateRef.current.skipAnimationDefault,
        });
    }, [invoke]);

    const callCustom = useCallback(async (
        id: string,
        payload: unknown,
        options: { skipAnimation?: boolean } = {},
    ): Promise<void> => {
        await invoke('customAction', {
            id,
            payload,
            skipAnimation: options.skipAnimation ?? stateRef.current.skipAnimationDefault,
        });
    }, [invoke]);

    const callGoToTime = useCallback(async (timestamp: number): Promise<void> => {
        await invoke('goToTime', { timestamp });
    }, [invoke]);

    const callSetSchedule = useCallback(async (schedule: ScheduleEntry[]): Promise<void> => {
        const errors = validateSchedule(schedule);
        if (errors.length > 0) {
            const message = errors.join(' ');
            appendLog(logEntry('setActionsSchedule', { schedule }, performance.now(), undefined, message));
            setState((previous) => ({ ...previous, phase: 'error', error: message }));
            return;
        }
        await invoke('setActionsSchedule', { schedule });
    }, [appendLog, invoke]);

    const setCurrentData = useCallback((currentData: Record<string, unknown>) => {
        setState((previous) => ({ ...previous, currentData }));
    }, []);
    const setRenderType = useCallback((renderType: 'realtime' | 'non-realtime') => {
        const next = { ...stateRef.current, renderType };
        stateRef.current = next;
        setState(next);
        void mount();
    }, [mount]);
    const setRenderCharacteristics = useCallback((renderCharacteristics: RenderCharacteristics) => {
        const next = { ...stateRef.current, renderCharacteristics };
        stateRef.current = next;
        setState(next);
        void mount();
    }, [mount]);
    const setSkipAnimationDefault = useCallback((skipAnimationDefault: boolean) => {
        setState((previous) => ({ ...previous, skipAnimationDefault }));
    }, []);
    const resetData = useCallback(() => {
        setState((previous) => ({ ...previous, currentData: buildPreviewData(manifest) }));
    }, [manifest]);
    const clearLog = useCallback(() => {
        setState((previous) => ({ ...previous, log: [] }));
    }, []);

    return {
        state,
        containerRef,
        isMounted: runnerRef.current !== null && state.phase !== 'disposed',
        setCurrentData,
        setRenderType,
        setRenderCharacteristics,
        setSkipAnimationDefault,
        resetData,
        callLoad: mount,
        callDispose,
        callPlay,
        callStop,
        callUpdate,
        callCustom,
        callGoToTime,
        callSetSchedule,
        clearLog,
        reMount: mount,
    };
}

function loadPersisted(key: string): Partial<PersistedState> {
    try {
        const raw = sessionStorage.getItem(key);
        return raw ? JSON.parse(raw) as Partial<PersistedState> : {};
    } catch {
        return {};
    }
}

function savePersisted(key: string, value: PersistedState): void {
    try {
        sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Session persistence is optional.
    }
}

export function extractRenderCharacteristics(manifest: unknown): RenderCharacteristics {
    return selectRuntimeRenderRequirement(manifest).characteristics;
}

function logEntry(
    method: OgrafApiMethod,
    params: unknown,
    started: number,
    result?: unknown,
    error?: string,
): LogEntry {
    return {
        id: makeLogId(),
        timestamp: Date.now(),
        method,
        params,
        ...(result === undefined ? {} : { result }),
        ...(error === undefined ? {} : { error }),
        durationMs: Math.round(performance.now() - started),
    };
}

function makeLogId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readString(value: unknown, key: string): string | undefined {
    const candidate = record(value)[key];
    return typeof candidate === 'string' ? candidate : undefined;
}

function readBoolean(value: unknown, key: string): boolean | undefined {
    const candidate = record(value)[key];
    return typeof candidate === 'boolean' ? candidate : undefined;
}

function record(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
