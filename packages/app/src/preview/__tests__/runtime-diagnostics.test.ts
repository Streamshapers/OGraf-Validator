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
        expect(diagnoseRuntimeError('ReturnPayload contains non-vendor field "segment".')).toMatchObject({
            code: 'INVALID_RETURN_PAYLOAD',
            hint: expect.stringContaining('result: { segment: value }'),
        });
    });

    it('recognizes missing API methods', () => {
        expect(diagnoseRuntimeError('Missing required method(s): dispose().')).toMatchObject({
            code: 'MISSING_REQUIRED_METHODS',
        });
    });

    it('recognizes non-success action responses', () => {
        expect(diagnoseRuntimeError('updateAction() returned status 400.')).toMatchObject({
            code: 'ACTION_RETURNED_ERROR_STATUS',
        });
    });

    it('provides a safe fallback diagnostic', () => {
        expect(diagnoseRuntimeError('Unexpected runtime failure')).toMatchObject({
            code: 'RUNTIME_CHECK_FAILED',
        });
    });

    it('groups the same OGraf violation observed in RT and NRT', () => {
        const groups = groupRuntimeFailures([
            {
                name: 'RT: playAction(goto: 0)',
                status: 'fail',
                durationMs: 7,
                error: 'ReturnPayload contains non-vendor field "segment".',
            },
            {
                name: 'NRT: playAction(goto: 0)',
                status: 'fail',
                durationMs: 9,
                error: 'ReturnPayload contains non-vendor field "segment".',
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
