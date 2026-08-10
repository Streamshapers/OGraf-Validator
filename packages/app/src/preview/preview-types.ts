/** Types used by the sandboxed OGraf v1 preview/runtime harness. */

/** Editable display values used by the validator UI. */
export interface RenderCharacteristics {
    width: number;
    height: number;
    frameRate: number;
    accessToPublicInternet?: boolean;
}

/** Normative wire shape passed to graphic.load(). */
export interface OgrafRenderCharacteristics {
    resolution?: {
        width: number;
        height: number;
    };
    frameRate?: number;
    accessToPublicInternet?: boolean;
}

export function toOgrafRenderCharacteristics(
    value: RenderCharacteristics,
): OgrafRenderCharacteristics {
    return {
        resolution: { width: value.width, height: value.height },
        frameRate: value.frameRate,
        ...(value.accessToPublicInternet === undefined
            ? {}
            : { accessToPublicInternet: value.accessToPublicInternet }),
    };
}

export interface LoadParams {
    data: Record<string, unknown>;
    renderType: 'realtime' | 'non-realtime';
    renderCharacteristics: OgrafRenderCharacteristics;
}

export interface PlayActionParams {
    delta?: number;
    /** Zero-based target step. */
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

export type ScheduleAction =
    | { type: 'playAction'; params: PlayActionParams }
    | { type: 'stopAction'; params: StopActionParams }
    | { type: 'updateAction'; params: UpdateActionParams }
    | { type: 'customAction'; params: CustomActionParams };

export interface ScheduleEntry {
    timestamp: number;
    action: ScheduleAction;
}

export interface ReturnPayload {
    statusCode: number;
    statusMessage?: string;
    result?: unknown;
}

export interface PlayActionReturnPayload extends ReturnPayload {
    /** Normative, zero-based current step. Undefined means the end was reached. */
    currentStep?: number;
}

export type EmptyParams = Record<`v_${string}`, unknown>;
export type EmptyPayload = Record<`v_${string}`, unknown>;

/** Shape exposed only for method inspection; execution happens in the sandbox. */
export interface OgrafElement extends HTMLElement {
    load?: (params: LoadParams) => Promise<ReturnPayload | void> | ReturnPayload | void;
    dispose?: (params: EmptyParams) => Promise<ReturnPayload | void> | ReturnPayload | void;
    playAction?: (params: PlayActionParams) => Promise<PlayActionReturnPayload | void> | PlayActionReturnPayload | void;
    stopAction?: (params: StopActionParams) => Promise<ReturnPayload | void> | ReturnPayload | void;
    updateAction?: (params: UpdateActionParams) => Promise<ReturnPayload | void> | ReturnPayload | void;
    customAction?: (params: CustomActionParams) => Promise<ReturnPayload | void> | ReturnPayload | void;
    goToTime?: (params: { timestamp: number }) => Promise<ReturnPayload | void> | ReturnPayload | void;
    setActionsSchedule?: (params: { schedule: ScheduleEntry[] }) => Promise<EmptyPayload | void> | EmptyPayload | void;
}

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
    currentStep: number | null | undefined;
    currentData: Record<string, unknown>;
    renderType: 'realtime' | 'non-realtime';
    renderCharacteristics: RenderCharacteristics;
    skipAnimationDefault: boolean;
    log: LogEntry[];
    error: string | null;
}

export type PreviewBackground =
    | { type: 'checker' }
    | { type: 'color'; value: string }
    | { type: 'image'; dataUrl: string };

export const DEFAULT_BACKGROUND: PreviewBackground = { type: 'checker' };

export const DEFAULT_RENDER_CHARACTERISTICS: RenderCharacteristics = {
    width: 1920,
    height: 1080,
    frameRate: 50,
};

export const MAX_LOG_ENTRIES = 100;
