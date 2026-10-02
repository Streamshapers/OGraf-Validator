import { describe, expect, it } from 'vitest';
import {
    diagnoseRuntimeError,
    groupRuntimeFailures,
    splitRuntimeStepName,
} from '../runtime-diagnostics.js';

describe('runtime diagnostics', () => {
    it('separates the runtime mode from the check label', () => {
        expect(splitRuntimeStepName('NRT: playAction(goto: 0)')).toEqual({
            mode: 'NRT',
            label: 'playAction(goto: 0)',
        });
        expect(splitRuntimeStepName('Runtime harness')).toEqual({ label: 'Runtime harness' });
    });

    it('recognizes invalid return payload fields', () => {
        expect(diagnoseRuntimeError('ReturnPayload contains non-vendor field "segment".', {
            code: 'INVALID_RETURN_PAYLOAD', reason: 'non-vendor-field', field: 'segment', method: 'playAction',
        })).toMatchObject({
            code: 'INVALID_RETURN_PAYLOAD',
            hint: expect.stringContaining('result: { segment: value }'),
        });
    });

    it('recognizes missing API methods', () => {
        expect(diagnoseRuntimeError('Missing required method(s): dispose().', { code: 'MISSING_REQUIRED_METHODS' })).toMatchObject({
            code: 'MISSING_REQUIRED_METHODS',
        });
    });

    it('recognizes non-success action responses', () => {
        expect(diagnoseRuntimeError('updateAction() returned status 400.', {
            code: 'ACTION_RETURNED_ERROR_STATUS', method: 'updateAction', statusCode: 400,
        })).toMatchObject({
            code: 'ACTION_RETURNED_ERROR_STATUS',
        });
    });

    it('provides a safe fallback diagnostic', () => {
        expect(diagnoseRuntimeError('Unexpected runtime failure')).toMatchObject({
            code: 'RUNTIME_CHECK_FAILED',
        });
    });

    it.each([
        'statusCode is unavailable in my library',
        'module import timeout in the application',
        'playAction() returned status 400.',
        'currentStep was unavailable to application code',
        'Missing required method(s): dispose().',
    ])('does not infer an OGraf diagnosis from arbitrary text: %s', (message) => {
        expect(diagnoseRuntimeError(message).code).toBe('RUNTIME_CHECK_FAILED');
    });

    it('distinguishes EmptyPayload from malformed and unsuccessful status responses', () => {
        const empty = diagnoseRuntimeError('EmptyPayload contains non-vendor field "statusCode".', {
            code: 'INVALID_EMPTY_PAYLOAD', method: 'setActionsSchedule', field: 'statusCode',
        });
        expect(empty.code).toBe('INVALID_EMPTY_PAYLOAD');
        expect(empty.hint).toContain('Do not return statusCode');
        expect(empty.specRef).toContain('#setactionsschedule');
        expect(diagnoseRuntimeError(undefined, { code: 'INVALID_STATUS_CODE' }).code)
            .toBe('INVALID_STATUS_CODE');
        expect(diagnoseRuntimeError(undefined, { code: 'INVALID_STATUS_MESSAGE' }).hint)
            .toContain('return a string');
    });

    it('documents the undefined end step and validator timeout limits', () => {
        expect(diagnoseRuntimeError(undefined, { code: 'INVALID_CURRENT_STEP' }).hint)
            .toContain('currentStep: undefined');
        const timeout = diagnoseRuntimeError(undefined, { code: 'RUNTIME_TIMEOUT' });
        expect(timeout.hint).toContain('inconclusive');
        expect(timeout.specRef).toBeUndefined();
        const generation = diagnoseRuntimeError(undefined, {
            code: 'PREVIEW_LIMITATION', reason: 'test-data-generation', method: 'load',
        });
        expect(generation.hint).toContain('generate test data');
        expect(generation.hint).toContain('not OGraf schema restrictions');
        expect(generation.specRef).toBeUndefined();
    });

    it('gives direct method-specific advice for malformed return payloads', () => {
        const play = diagnoseRuntimeError(undefined, {
            code: 'INVALID_RETURN_PAYLOAD', reason: 'invalid-type', method: 'playAction',
        });
        expect(play.hint).toContain('object containing statusCode and currentStep');
        expect(play.hint).toContain('complete payload must not be undefined');
        expect(play.specRef).toMatch(/#playaction$/);
        const load = diagnoseRuntimeError(undefined, {
            code: 'INVALID_RETURN_PAYLOAD', reason: 'invalid-type', method: 'load',
        });
        expect(load.hint).toContain('load must resolve');
        expect(load.hint).toContain('undefined for success');
        expect(load.specRef).toMatch(/#load$/);
        expect(diagnoseRuntimeError(undefined, {
            code: 'INVALID_RETURN_PAYLOAD', reason: 'non-vendor-field', method: 'playAction', field: 'value',
        }).hint).toContain('statusCode: 200, currentStep, result:');
    });

    it('groups the same OGraf violation observed in RT and NRT', () => {
        const groups = groupRuntimeFailures([
            {
                name: 'RT: playAction(goto: 0)',
                status: 'fail',
                durationMs: 7,
                error: 'ReturnPayload contains non-vendor field "segment".',
                diagnostic: { code: 'INVALID_RETURN_PAYLOAD', reason: 'non-vendor-field', field: 'segment', method: 'playAction' },
            },
            {
                name: 'NRT: playAction(goto: 0)',
                status: 'fail',
                durationMs: 9,
                error: 'ReturnPayload contains non-vendor field "segment".',
                diagnostic: { code: 'INVALID_RETURN_PAYLOAD', reason: 'non-vendor-field', field: 'segment', method: 'playAction' },
            },
        ]);

        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({
            code: 'INVALID_RETURN_PAYLOAD',
            label: 'playAction(goto: 0)',
            occurrences: [
                { mode: 'RT', step: { durationMs: 7 } },
                { mode: 'NRT', step: { durationMs: 9 } },
            ],
        });
    });

    it('keeps different methods and error messages as separate issues', () => {
        const groups = groupRuntimeFailures([
            { name: 'RT: load()', status: 'fail', durationMs: 1, error: 'same failure' },
            { name: 'NRT: dispose()', status: 'fail', durationMs: 1, error: 'same failure' },
            { name: 'NRT: load()', status: 'fail', durationMs: 1, error: 'different failure' },
        ]);

        expect(groups).toHaveLength(3);
    });
});
