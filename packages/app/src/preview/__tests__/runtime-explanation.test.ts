import { expect, it } from 'vitest';
import { explainRuntimeStep, formatCapturedValue } from '../runtime-explanation.js';
import { captureReportValue } from '../../readiness/report-evidence.js';
import type { RuntimeTestStep } from '../runtime-test-types.js';

const step: RuntimeTestStep = {
    name: 'setActionsSchedule()', status: 'fail', durationMs: 1,
    diagnostic: { code: 'INVALID_EMPTY_PAYLOAD', method: 'setActionsSchedule' },
    invocation: { method: 'setActionsSchedule', dispatched: true, startedAt: 'test',
        parameters: captureReportValue({ actions: [] }),
        response: captureReportValue({ statusCode: 200, statusMessage: 'OK' }),
    },
};

it('explains the EmptyPayload contract from structured metadata and actual captured response', () => {
    expect(explainRuntimeStep(step)).toMatchObject({
        expected: 'undefined, {}, or an object containing only v_-prefixed vendor fields.',
        received: '{\n  "statusCode": 200,\n  "statusMessage": "OK"\n}',
    });
});

it('does not infer expectations from misleading exception text', () => {
    const explanation = explainRuntimeStep({ ...step, diagnostic: { code: 'RUNTIME_CHECK_FAILED' },
        error: 'statusCode import timeout currentStep', invocation: undefined });
    expect(explanation.expected).toBeUndefined();
    expect(explanation.received).toBe('Not captured');
});

it('keeps missing evidence, undefined, null and explicit undefined fields distinct', () => {
    expect(formatCapturedValue()).toBe('Not captured');
    expect(formatCapturedValue(captureReportValue(undefined))).toBe('undefined');
    expect(formatCapturedValue(captureReportValue(null))).toBe('null');
    expect(formatCapturedValue(captureReportValue({ currentStep: undefined }))).toBe('{\n  "currentStep": undefined\n}');
    expect(explainRuntimeStep({ ...step, expectedCurrentStep: null,
        diagnostic: { code: 'CURRENT_STEP_MISMATCH' } }).expected).toContain('undefined');
});
