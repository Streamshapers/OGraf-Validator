import { describe, expect, it } from 'vitest';
import type { RuntimeTestResult } from '../runtime-test-types.js';
import {
    completeRuntimeSuite,
    getRuntimeSuiteResult,
    startRuntimeSuite,
} from '../runtime-suite-state.js';

const FAILURE: RuntimeTestResult = {
    passed: false,
    outcome: 'completed',
    totalDurationMs: 10,
    steps: [{ name: 'RT: play()', status: 'fail', durationMs: 10, error: 'wrong step' }],
};
const PASS: RuntimeTestResult = {
    passed: true, outcome: 'completed', totalDurationMs: 5,
    steps: [{ name: 'RT: play()', status: 'pass', durationMs: 5 }],
};

describe('runtime suite evidence', () => {
    it('retains known failures while a replacement is queued and running', () => {
        const completed = completeRuntimeSuite(undefined, FAILURE);
        for (const phase of ['pending', 'running', 'cancelling'] as const) {
            const state = startRuntimeSuite(completed, {
                runId: 'retry', phase, budgetMinutes: 2, steps: [],
            });
            expect(getRuntimeSuiteResult(state)).toMatchObject({
                passed: false, steps: FAILURE.steps,
            });
            expect(completed.active).toBeUndefined();
        }
    });

    it.each(['cancelled', 'budget-exhausted'] as const)(
        'keeps old and new failures after an incomplete %s attempt', (outcome) => {
            const state = completeRuntimeSuite(completeRuntimeSuite(undefined, FAILURE), {
                ...PASS, outcome, inconclusive: true,
                steps: [{ name: 'NRT: seek()', status: 'fail', durationMs: 2 }],
            });
            expect(state.lastCompleted).toBe(FAILURE);
            expect(state.active).toBeUndefined();
            expect(getRuntimeSuiteResult(state)?.steps).toHaveLength(2);
            expect(getRuntimeSuiteResult(state)?.passed).toBe(false);
        },
    );

    it('does not clear failures when a completed attempt contains a warning', () => {
        const state = completeRuntimeSuite(completeRuntimeSuite(undefined, FAILURE), {
            ...PASS, steps: [{ name: 'timeout', status: 'warning', durationMs: 1 }],
        });
        expect(getRuntimeSuiteResult(state)).toMatchObject({ passed: false, inconclusive: true });
        expect(state.lastCompleted).toBe(FAILURE);
    });

    it('only clears old failures after a complete conclusive replacement', () => {
        const state = completeRuntimeSuite(completeRuntimeSuite(undefined, FAILURE), PASS);
        expect(state).toEqual({ lastCompleted: PASS, latestAttempt: PASS });
        expect(getRuntimeSuiteResult(state)).toEqual(PASS);
    });

    it('includes live failures and deduplicates observations across attempts', () => {
        const state = startRuntimeSuite(completeRuntimeSuite(undefined, FAILURE), {
            runId: 'new', phase: 'running', budgetMinutes: 5,
            steps: [{ ...FAILURE.steps[0]!, runId: 'new', durationMs: 20 }],
        });
        expect(getRuntimeSuiteResult(state)?.steps).toHaveLength(1);
        expect(getRuntimeSuiteResult(state)?.steps[0]?.runId).toBe('new');
    });

    it('does not manufacture a passing result before the first attempt completes', () => {
        expect(getRuntimeSuiteResult(undefined)).toBeUndefined();
        expect(getRuntimeSuiteResult(startRuntimeSuite(undefined, {
            runId: 'first', phase: 'running', budgetMinutes: 2, steps: [],
        }))).toBeUndefined();
    });

    it('keeps the completed result status while the active attempt has separate progress', () => {
        const state = startRuntimeSuite(completeRuntimeSuite(undefined, PASS), {
            runId: 'retry', phase: 'running', budgetMinutes: 2, steps: [],
        });
        expect(getRuntimeSuiteResult(state)).toEqual(PASS);
    });

    it('reports a first live failure before any attempt has completed', () => {
        const state = startRuntimeSuite(undefined, {
            runId: 'first', phase: 'running', budgetMinutes: 2, steps: FAILURE.steps,
        });
        expect(getRuntimeSuiteResult(state)).toMatchObject({
            passed: false, inconclusive: true, steps: FAILURE.steps,
        });
    });
});
