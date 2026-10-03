import type { OgrafApiMethod } from './preview-contract.js';

export const RUNTIME_DIAGNOSTIC_CODES = [
    'INVALID_RETURN_PAYLOAD', 'INVALID_EMPTY_PAYLOAD', 'INVALID_STATUS_CODE',
    'INVALID_STATUS_MESSAGE', 'INVALID_CURRENT_STEP', 'CURRENT_STEP_MISMATCH',
    'METHOD_MUST_RETURN_PROMISE', 'MISSING_REQUIRED_METHODS', 'ACTION_RETURNED_ERROR_STATUS',
    'INVALID_DEFAULT_EXPORT', 'DEFAULT_EXPORT_NOT_HTMLELEMENT', 'SANDBOX_IMPORT_FAILED',
    'RUNTIME_TIMEOUT', 'RUNTIME_ABORTED', 'PREVIEW_LIMITATION', 'UNCAUGHT_RUNTIME_ERROR',
    'INVALID_TEST_DATA', 'UNSUPPORTED_TEST_SCHEMA', 'CUSTOM_ACTION_NOT_TESTED',
    'INVALID_SCHEDULE', 'RUNTIME_CHECK_FAILED', 'RESOURCE_LOAD_FAILED',
] as const;

export type RuntimeDiagnosticCode = typeof RUNTIME_DIAGNOSTIC_CODES[number];

/** Produced at the failing check; never inferred from a Graphic's error message. */
export interface RuntimeDiagnosticDetails {
    code: RuntimeDiagnosticCode;
    reason?: string;
    method?: OgrafApiMethod;
    field?: string;
    statusCode?: number;
    specRef?: string;
    hint?: string;
}

export function readRuntimeDiagnostic(value: unknown): RuntimeDiagnosticDetails | undefined {
    if (typeof value !== 'object' || value === null) return undefined;
    const record = value as Record<string, unknown>;
    if (!RUNTIME_DIAGNOSTIC_CODES.includes(record['code'] as RuntimeDiagnosticCode)) return undefined;
    const methods = [
        'load', 'dispose', 'playAction', 'stopAction', 'updateAction',
        'customAction', 'goToTime', 'setActionsSchedule',
    ];

    return {
        code: record['code'] as RuntimeDiagnosticCode,
        ...(typeof record['reason'] === 'string' ? { reason: record['reason'] } : {}),
        ...(typeof record['field'] === 'string' ? { field: record['field'] } : {}),
        ...(methods.includes(record['method'] as string)
            ? { method: record['method'] as OgrafApiMethod } : {}),
        ...(typeof record['statusCode'] === 'number' && Number.isInteger(record['statusCode'])
            ? { statusCode: record['statusCode'] } : {}),
    };
}
