import type { ApiMethod, ScheduleEntry } from './preview-types.js';
import type { RuntimeDiagnosticDetails } from './runtime-diagnostic-types.js';

export type OgrafApiMethod = Exclude<ApiMethod, `console.${string}`>;

export const REQUIRED_METHODS = [
    'load',
    'dispose',
    'playAction',
    'stopAction',
    'updateAction',
    'customAction',
] as const satisfies readonly OgrafApiMethod[];

export const NON_REALTIME_METHODS = [
    'goToTime',
    'setActionsSchedule',
] as const satisfies readonly OgrafApiMethod[];

export interface NormalizedReturnPayload {
    valid: boolean;
    successful: boolean;
    statusCode?: number;
    statusMessage?: string;
    result?: unknown;
    hasCurrentStep: boolean;
    /** null represents a present-but-undefined currentStep (the end). */
    currentStep?: number | null;
    error?: string;
    diagnostic?: RuntimeDiagnosticDetails;
    raw: unknown;
}

export function isSuccessfulStatus(statusCode: number): boolean {
    return Number.isInteger(statusCode) && statusCode >= 200 && statusCode < 300;
}

/**
 * Normalize OGraf API results. A completely absent payload is status 200 where
 * that method permits it; returned payload objects must contain statusCode.
 * Any 2xx status succeeds.
 */
export function normalizeReturnPayload(
    method: OgrafApiMethod,
    value: unknown,
): NormalizedReturnPayload {
    if (value === undefined) {
        if (method === 'playAction') {
            return invalid(value, 'playAction must resolve to a ReturnPayload containing currentStep.', {
                code: 'INVALID_CURRENT_STEP', reason: 'missing-payload', method,
                field: 'currentStep',
            });
        }
        return {
            valid: true,
            successful: true,
            statusCode: 200,
            hasCurrentStep: false,
            raw: value,
        };
    }

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return invalid(value, `${method === 'setActionsSchedule' ? 'EmptyPayload' : 'ReturnPayload'} must be an object or undefined.`, {
            code: method === 'setActionsSchedule' ? 'INVALID_EMPTY_PAYLOAD' : 'INVALID_RETURN_PAYLOAD',
            reason: 'invalid-type', method,
        });
    }

    const payload = value as Record<string, unknown>;
    if (method === 'setActionsSchedule') {
        const invalidKey = Object.keys(payload).find((key) => !key.startsWith('v_'));
        if (invalidKey !== undefined) {
            return invalid(value, `EmptyPayload contains non-vendor field "${invalidKey}".`, {
                code: 'INVALID_EMPTY_PAYLOAD', reason: 'non-vendor-field', method, field: invalidKey,
            });
        }
        return {
            valid: true,
            successful: true,
            statusCode: 200,
            hasCurrentStep: false,
            raw: value,
        };
    }

    const allowedFields = new Set([
        'statusCode',
        'statusMessage',
        'result',
        ...(method === 'playAction' ? ['currentStep'] : []),
    ]);
    const invalidField = Object.keys(payload).find((key) => !allowedFields.has(key) && !key.startsWith('v_'));
    if (invalidField !== undefined) {
        return invalid(value, `ReturnPayload contains non-vendor field "${invalidField}".`, {
            code: 'INVALID_RETURN_PAYLOAD', reason: 'non-vendor-field', method, field: invalidField,
        });
    }

    const rawStatus = payload['statusCode'];
    if (!Object.prototype.hasOwnProperty.call(payload, 'statusCode')) {
        return invalid(value, 'ReturnPayload.statusCode is required.', {
            code: 'INVALID_STATUS_CODE', reason: 'missing-field', method, field: 'statusCode',
        });
    }
    const statusCode = rawStatus;
    if (!Number.isInteger(statusCode) || (statusCode as number) < 100 || (statusCode as number) > 599) {
        return invalid(value, 'ReturnPayload.statusCode must be an integer between 100 and 599.', {
            code: 'INVALID_STATUS_CODE', reason: 'invalid-value', method, field: 'statusCode',
        });
    }
    if (payload['statusMessage'] !== undefined && typeof payload['statusMessage'] !== 'string') {
        return invalid(value, 'ReturnPayload.statusMessage must be a string when present.', {
            code: 'INVALID_STATUS_MESSAGE', reason: 'invalid-type', method, field: 'statusMessage',
        });
    }

    let hasCurrentStep = false;
    let currentStep: number | null | undefined;
    if (method === 'playAction' && Object.prototype.hasOwnProperty.call(payload, 'currentStep')) {
        hasCurrentStep = true;
        const rawStep = payload['currentStep'];
        if (rawStep === undefined) {
            currentStep = null;
        } else if (Number.isInteger(rawStep) && (rawStep as number) >= 0) {
            currentStep = rawStep as number;
        } else {
            return invalid(value, 'playAction.currentStep must be a zero-based non-negative integer or undefined.', {
                code: 'INVALID_CURRENT_STEP', reason: 'invalid-value', method, field: 'currentStep',
            });
        }
    }
    if (method === 'playAction' && !hasCurrentStep) {
        return invalid(value, 'playAction ReturnPayload must contain the currentStep field.', {
            code: 'INVALID_CURRENT_STEP', reason: 'missing-field', method, field: 'currentStep',
        });
    }

    return {
        valid: true,
        successful: isSuccessfulStatus(statusCode as number),
        statusCode: statusCode as number,
        ...(typeof payload['statusMessage'] === 'string'
            ? { statusMessage: payload['statusMessage'] as string }
            : {}),
        ...(Object.prototype.hasOwnProperty.call(payload, 'result')
            ? { result: payload['result'] }
            : {}),
        hasCurrentStep,
        ...(hasCurrentStep ? { currentStep } : {}),
        raw: value,
    };
}

function invalid(raw: unknown, error: string, diagnostic: RuntimeDiagnosticDetails): NormalizedReturnPayload {
    return {
        valid: false,
        successful: false,
        hasCurrentStep: false,
        error,
        diagnostic,
        raw,
    };
}

export interface DurationQuery {
    type: 'playAction' | 'updateAction' | 'stopAction' | 'customAction';
    /** Zero-based step used for a playAction duration override. */
    step?: number;
    customActionId?: string;
}

/**
 * Resolve informational action duration metadata in milliseconds. This value
 * is deliberately not used as the runtime RPC timeout: action completion is
 * defined by its Promise, not by manifest duration metadata.
 */
export function resolveActionDuration(
    manifest: unknown,
    query: DurationQuery,
): number | undefined {
    if (typeof manifest !== 'object' || manifest === null) return undefined;
    const durations = (manifest as Record<string, unknown>)['actionDurations'];
    if (!Array.isArray(durations)) return undefined;

    const match = durations.find((candidate) => {
        if (typeof candidate !== 'object' || candidate === null) return false;
        const entry = candidate as Record<string, unknown>;
        if (entry['type'] !== query.type) return false;
        return query.type !== 'customAction' || entry['customActionId'] === query.customActionId;
    });
    if (typeof match !== 'object' || match === null) return undefined;
    const entry = match as Record<string, unknown>;

    if (query.type === 'playAction' && Array.isArray(entry['steps'])) {
        const steps = entry['steps'] as unknown[];
        const exact = query.step === undefined
            ? undefined
            : steps.find((candidate) => isDurationStep(candidate) && candidate.step === query.step);
        if (isDurationStep(exact)) return exact.duration;
        const fallback = steps.find((candidate) => isDurationStep(candidate) && candidate.step === undefined);
        if (isDurationStep(fallback)) return fallback.duration;
    }

    return typeof entry['duration'] === 'number' && Number.isFinite(entry['duration'])
        ? entry['duration'] as number
        : undefined;
}

function isDurationStep(value: unknown): value is { step?: number; duration: number } {
    if (typeof value !== 'object' || value === null) return false;
    const entry = value as Record<string, unknown>;
    return typeof entry['duration'] === 'number' && Number.isFinite(entry['duration']) &&
        (entry['step'] === undefined || Number.isInteger(entry['step']));
}

/** Return human-readable shape errors for the normative schedule wire format. */
export function validateSchedule(schedule: unknown, manifest?: unknown): string[] {
    if (!Array.isArray(schedule)) return ['schedule must be an array.'];
    const errors: string[] = [];

    schedule.forEach((candidate, index) => {
        const at = `schedule[${index}]`;
        if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
            errors.push(`${at} must be an object.`);
            return;
        }
        const entry = candidate as Record<string, unknown>;
        validateInputFields(entry, ['timestamp', 'action'], at, errors);
        if (typeof entry['timestamp'] !== 'number' || !Number.isFinite(entry['timestamp']) || entry['timestamp'] < 0) {
            errors.push(`${at}.timestamp must be a non-negative number in milliseconds.`);
        }
        const action = entry['action'];
        if (typeof action !== 'object' || action === null || Array.isArray(action)) {
            errors.push(`${at}.action must be an object.`);
            return;
        }
        const actionRecord = action as Record<string, unknown>;
        validateInputFields(actionRecord, ['type', 'params'], `${at}.action`, errors);
        if (Object.prototype.hasOwnProperty.call(actionRecord, 'method')) {
            errors.push(`${at}.action uses "method"; OGraf v1 requires "type".`);
        }
        const type = actionRecord['type'];
        if (!['playAction', 'stopAction', 'updateAction', 'customAction'].includes(String(type))) {
            errors.push(`${at}.action.type is not a schedulable OGraf action.`);
        }
        const params = actionRecord['params'];
        if (typeof params !== 'object' || params === null || Array.isArray(params)) {
            errors.push(`${at}.action.params must be an object.`);
            return;
        }
        const actionParams = params as Record<string, unknown>;
        const fields = type === 'playAction' ? ['goto', 'delta', 'skipAnimation']
            : type === 'updateAction' ? ['data', 'skipAnimation']
                : type === 'customAction' ? ['id', 'payload', 'skipAnimation'] : ['skipAnimation'];
        validateInputFields(actionParams, fields, `${at}.action.params`, errors);
        if (actionParams['skipAnimation'] !== undefined && typeof actionParams['skipAnimation'] !== 'boolean') {
            errors.push(`${at}.action.params.skipAnimation must be a boolean.`);
        }
        if (type === 'playAction') {
            const goto = actionParams['goto'];
            if (goto !== undefined && (!Number.isInteger(goto) || (goto as number) < 0)) {
                errors.push(`${at}.action.params.goto must be a zero-based non-negative integer.`);
            }
            if (actionParams['delta'] !== undefined && !Number.isInteger(actionParams['delta'])) {
                errors.push(`${at}.action.params.delta must be an integer.`);
            }
        } else if (type === 'updateAction') {
            if (!Object.prototype.hasOwnProperty.call(actionParams, 'data')) {
                errors.push(`${at}.action.params.data is required; partial updates are allowed.`);
            }
        } else if (type === 'customAction') {
            const id = actionParams['id'];
            if (typeof id !== 'string') errors.push(`${at}.action.params.id must be a string.`);
            const manifestRecord = typeof manifest === 'object' && manifest !== null
                ? manifest as Record<string, unknown> : undefined;
            const actions = manifestRecord?.['customActions'];
            const actionDefinition = Array.isArray(actions)
                ? actions.find((item: unknown) => typeof item === 'object' && item !== null &&
                    (item as Record<string, unknown>)['id'] === id) as Record<string, unknown> | undefined
                : undefined;
            if (manifestRecord && typeof id === 'string' && !actionDefinition) {
                errors.push(`${at}.action.params.id must name a custom action declared in the manifest.`);
            }
            if (!Object.prototype.hasOwnProperty.call(actionParams, 'payload') && actionDefinition?.['schema'] !== null) {
                errors.push(`${at}.action.params.payload is required unless the action declares schema: null.`);
            }
        }
    });

    return errors;
}

function validateInputFields(
    value: Record<string, unknown>,
    allowed: readonly string[],
    path: string,
    errors: string[],
): void {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key) && !key.startsWith('v_')) {
            errors.push(`${path} contains unsupported field "${key}"; vendor fields must start with v_.`);
        }
    }
}

export function createRuntimeSchedule(
    data: Record<string, unknown>,
    stepCount?: number,
): ScheduleEntry[] {
    const playParams = stepCount === 0
        ? { skipAnimation: true }
        : { goto: 0, skipAnimation: true };
    return [
        {
            timestamp: 0,
            action: {
                type: 'updateAction',
                params: { data, skipAnimation: true },
            },
        },
        {
            timestamp: 0,
            action: {
                type: 'playAction',
                params: playParams,
            },
        },
        {
            timestamp: 1_000,
            action: {
                type: 'stopAction',
                params: { skipAnimation: true },
            },
        },
    ];
}

export interface RuntimeCycleCall {
    method: OgrafApiMethod;
    label: string;
    params: unknown;
}

/** Built-in calls shared by RT/NRT; NRT then adds scheduling and seeking. */
export function createRuntimeCycleCalls(
    renderType: 'realtime' | 'non-realtime',
    data: Record<string, unknown>,
    stepCount?: number,
): RuntimeCycleCall[] {
    const playParams = stepCount === 0
        ? { skipAnimation: true }
        : { goto: 0, skipAnimation: true };
    const calls: RuntimeCycleCall[] = [
        { method: 'updateAction', label: 'updateAction()', params: { data, skipAnimation: true } },
        {
            method: 'playAction',
            label: stepCount === 0 ? 'playAction()' : 'playAction(goto: 0)',
            params: playParams,
        },
        { method: 'stopAction', label: 'stopAction()', params: { skipAnimation: true } },
    ];
    if (renderType === 'non-realtime') {
        calls.push(
            {
                method: 'setActionsSchedule',
                label: 'setActionsSchedule()',
                params: { schedule: createRuntimeSchedule(data, stepCount) },
            },
            { method: 'goToTime', label: 'goToTime(0)', params: { timestamp: 0 } },
        );
    }
    return calls;
}
