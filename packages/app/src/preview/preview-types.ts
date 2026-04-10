/**
 * Types for the Preview test harness.
 * Mirrors the ograf v1 JavaScript Web Component API.
 * @see https://ograf.ebu.io/v1/specification/docs/Specification.html
 */

// ─── ograf API parameter types ────────────────────────────────────────────────

export interface LoadParams {
    data: Record<string, unknown>;
    renderType: 'realtime' | 'non-realtime';
    renderCharacteristics: RenderCharacteristics;
}

export interface RenderCharacteristics {
    width: number;
    height: number;
    frameRate: number;
}

export interface PlayActionParams {
    delta?: number;
    goto?: number;
    skipAnimation?: boolean;
}

export interface StopActionParams {
    skipAnimation?: boolean;
}

export interface UpdateActionParams {
    data: Record<string, unknown>;
    skipAnimation?: boolean;
}

export interface CustomActionParams {
    id: string;
    payload: unknown;
    skipAnimation?: boolean;
}

export interface ScheduleEntry {
    timestamp: number;
    action: unknown;
}

export interface ReturnPayload {
    statusCode: number;
    statusMessage?: string;
    result?: unknown;
}

export interface PlayActionReturnPayload extends ReturnPayload {
    result?: {
        currentStep?: number;
    };
}

// ─── Graphic custom element interface ────────────────────────────────────────

export interface OgrafElement extends HTMLElement {
    load?:               (params: LoadParams)                     => Promise<ReturnPayload | void> | void;
    dispose?:            (params?: Record<string, unknown>)       => Promise<ReturnPayload | void> | void;
    playAction?:         (params?: PlayActionParams)              => Promise<PlayActionReturnPayload | void> | void;
    stopAction?:         (params?: StopActionParams)              => Promise<ReturnPayload | void> | void;
    updateAction?:       (params: UpdateActionParams)             => Promise<ReturnPayload | void> | void;
    customAction?:       (params: CustomActionParams)             => Promise<ReturnPayload | void> | void;
    goToTime?:           (params: { timestamp: number })          => Promise<ReturnPayload | void> | void;
    setActionsSchedule?: (params: { schedule: ScheduleEntry[] }) => Promise<ReturnPayload | void> | void;
}

// ─── Preview state ────────────────────────────────────────────────────────────

export type PreviewPhase =
    | 'idle'
    | 'importing'
    | 'loading'
    | 'loaded'
    | 'playing'
    | 'stopped'
    | 'disposed'
    | 'error';

export type ApiMethod =
    | 'load'
    | 'dispose'
    | 'playAction'
    | 'stopAction'
    | 'updateAction'
    | 'customAction'
    | 'goToTime'
    | 'setActionsSchedule'
    | 'console.log'
    | 'console.warn'
    | 'console.error'
    | 'console.info';

export interface LogEntry {
    id: string;
    timestamp: number;
    method: ApiMethod;
    params: unknown;
    result?: unknown;
    error?: string;
    durationMs: number;
}

export interface PreviewState {
    phase: PreviewPhase;
    currentStep: number | undefined;
    currentData: Record<string, unknown>;
    renderType: 'realtime' | 'non-realtime';
    renderCharacteristics: RenderCharacteristics;
    skipAnimationDefault: boolean;
    log: LogEntry[];
    error: string | null;
}

// ─── Preview background ───────────────────────────────────────────────────────

export type PreviewBackground =
    | { type: 'checker' }
    | { type: 'color'; value: string }
    | { type: 'image'; dataUrl: string };

export const DEFAULT_BACKGROUND: PreviewBackground = { type: 'checker' };

// ─── Default render characteristics (1080p50) ───────────────────────────────

export const DEFAULT_RENDER_CHARACTERISTICS: RenderCharacteristics = {
    width: 1920,
    height: 1080,
    frameRate: 50,
};

export const MAX_LOG_ENTRIES = 100;
