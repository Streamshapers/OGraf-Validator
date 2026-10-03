import { expect, it } from 'vitest';
import { coverageIssueText, deriveRuntimeCoverage } from '../runtime-coverage.js';
import type { RuntimeTestStep } from '../../preview/runtime-test-types.js';

function call(method: string, value: unknown, extra: Partial<RuntimeTestStep> = {}): RuntimeTestStep {
    return { name: method, status: 'pass', durationMs: 1, renderMode: 'RT',
        invocation: { method, dispatched: true, startedAt: '', parameters: { type: 'json', value } }, ...extra };
}

it('counts actual successful steps, attempted profiles and custom actions without inventing coverage', () => {
    const result = deriveRuntimeCoverage({ stepCount: 21, supportsRealTime: true, customActions: [{ id: 'a' }, { id: 'b' }] }, {
        passed: false, totalDurationMs: 1, steps: [
            call('load', { renderCharacteristics: { resolution: { width: 1920, height: 1080 }, frameRate: 50 } }),
            call('playAction', { goto: 0 }, { actualCurrentStep: 0 }),
            call('playAction', { goto: 1 }, { actualCurrentStep: 999, status: 'fail' }),
            call('customAction', { id: 'a' }),
        ],
    });
    expect(result[0]).toMatchObject({ status: 'Failed', declaredStepCount: 21,
        customActions: [{ id: 'a', status: 'Passed' }, { id: 'b', status: 'Not run' }] });
    expect(result[0]?.modes[0]).toMatchObject({ steps: [0], profiles: ['1920 × 1080 · 50 fps'] });
    expect(result[0]?.modes[1]?.declared).toBe(false);
    expect(result[1]?.status).toBe('Not run');
});

it('does not infer execution from method names in older results or treat skipped checks as passes', () => {
    const [coverage] = deriveRuntimeCoverage({}, { passed: true, totalDurationMs: 1,
        steps: [{ name: 'RT: playAction()', status: 'skip', durationMs: 0 }] });
    expect(coverage).toMatchObject({ evidenceMissing: true, checks: { skip: 1, pass: 0 } });
    expect(coverage?.modes[0]?.steps).toEqual([]);
});

it('distinguishes missing historical evidence from an unrun action', () => {
    const manifest = { customActions: [{ id: 'a' }] };
    const [legacy, unrun] = deriveRuntimeCoverage(manifest, { passed: true, totalDurationMs: 0, steps: [] });
    expect(legacy?.customActions[0]?.status).toBe('Not recorded');
    expect(unrun?.customActions[0]?.status).toBe('Not run');
});

it('keeps incomplete action observations inconclusive and excludes invalid step indices', () => {
    const [coverage] = deriveRuntimeCoverage({ stepCount: 2, customActions: [{ id: 'a' }] }, {
        passed: true, totalDurationMs: 0, steps: [
            call('customAction', { id: 'a' }), call('customAction', { id: 'a' }, { status: 'warning' }),
            ...[-1, 0, 0, 1, 2, 1.5].map((actualCurrentStep) => call('playAction', {}, { actualCurrentStep })),
        ],
    });
    expect(coverage?.customActions[0]?.status).toBe('Inconclusive');
    expect(coverage?.modes[0]?.steps).toEqual([0, 1]);
});

it('counts grouped issues separately from repeated failing checks in each suite', () => {
    const failure = call('setActionsSchedule', {}, { status: 'fail', error: 'Invalid empty payload',
        diagnostic: { code: 'INVALID_EMPTY_PAYLOAD', method: 'setActionsSchedule',
            field: 'statusCode', reason: 'non-vendor-field' } });
    const standard = { passed: false, totalDurationMs: 1, steps: [failure] };
    const extended = { latestAttempt: { ...standard, steps: [
        { ...failure, scenarioId: 'contract' }, { ...failure, scenarioId: 'seeking' },
    ] } };
    const suites = deriveRuntimeCoverage({}, standard, extended);
    expect(suites[0]).toMatchObject({ issueCount: 1, issueOccurrences: 1, checks: { fail: 1 } });
    expect(suites[1]).toMatchObject({ issueCount: 1, issueOccurrences: 2, checks: { fail: 2 } });
    expect(coverageIssueText(suites[0]!)).toBe('1 issue · detected once');
    expect(coverageIssueText(suites[1]!)).toBe('1 issue · detected in 2 checks');
    expect(coverageIssueText(deriveRuntimeCoverage({})[1]!)).toBe('Not tested yet');
});
