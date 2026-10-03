import { describe, expect, it } from 'vitest';
import type { PackageCache } from '../components/ContentArea.js';
import { completeRuntimeSuite, startRuntimeSuite } from '../preview/runtime-suite-state.js';
import type { RuntimeTestResult } from '../preview/runtime-test-types.js';
import { readRuntimeSuite, updateRuntimeAttempt, writeRuntimeSuite } from '../runtime-package-state.js';

const failed: RuntimeTestResult = {
    passed: false, totalDurationMs: 1,
    steps: [{ name: 'playAction()', status: 'fail', durationMs: 1, error: 'Wrong step' }],
};
const passed: RuntimeTestResult = { passed: true, steps: [], totalDurationMs: 1 };
const cache = (): PackageCache => ({
    validationResult: { valid: true, issues: [], errors: [], warnings: [], infos: [] },
    manifest: {}, assets: [], runtimeTest: failed,
});
const attempt = (runId: string) => ({
    runId, phase: 'running' as const, budgetMinutes: 2 as const, steps: [],
});

describe('runtime package state integration', () => {
    it('treats legacy results as standard and never as extended evidence', () => {
        expect(readRuntimeSuite(cache(), 'standard')?.latestAttempt).toBe(failed);
        expect(readRuntimeSuite(cache(), 'extended')).toBeUndefined();
    });

    it('keeps existing standard errors in legacy projections while retrying and cancelling', () => {
        const initial = cache();
        const retry = writeRuntimeSuite(initial, 'standard', startRuntimeSuite(
            readRuntimeSuite(initial, 'standard'), attempt('retry'),
        ));
        expect(retry.runtimeTestPhase).toBe('running');
        expect(retry.runtimeTest?.steps).toContainEqual(failed.steps[0]);

        const cancelling = updateRuntimeAttempt(retry, 'standard', 'retry', (state) => ({
            ...state, active: { ...state.active!, phase: 'cancelling' },
        }));
        expect(cancelling.runtimeTestPhase).toBe('running');
        expect(cancelling.runtimeTest?.passed).toBe(false);

        const cancelled = updateRuntimeAttempt(cancelling, 'standard', 'retry', (state) => (
            completeRuntimeSuite(state, { ...passed, outcome: 'cancelled', inconclusive: true })
        ));
        expect(cancelled.runtimeTest?.passed).toBe(false);
        expect(cancelled.runtimeTest?.inconclusive).toBe(true);
        expect(cancelled.runtimeTestPhase).toBeUndefined();
    });

    it('rejects late progress and completion after a replacement run is started', () => {
        const current = writeRuntimeSuite(cache(), 'extended', startRuntimeSuite(undefined, attempt('new')));
        expect(updateRuntimeAttempt(current, 'extended', 'old', () => ({ latestAttempt: failed })))
            .toBe(current);
        const completed = updateRuntimeAttempt(current, 'extended', 'new', (state) => (
            completeRuntimeSuite(state, passed)
        ));
        expect(completed.extendedRuntimeTest?.latestAttempt).toBe(passed);
        expect(updateRuntimeAttempt(completed, 'extended', 'new', () => ({ latestAttempt: failed })))
            .toBe(completed);
    });

    it('keeps the other suite untouched when extended progress or completion arrives', () => {
        const initial = writeRuntimeSuite(cache(), 'extended', startRuntimeSuite(undefined, attempt('extended')));
        const updated = updateRuntimeAttempt(initial, 'extended', 'extended', (state) => (
            completeRuntimeSuite(state, passed)
        ));
        expect(updated.runtimeTest).toBe(failed);
        expect(updated.extendedRuntimeTest?.latestAttempt).toBe(passed);
        expect(updated.validationResult).toBe(initial.validationResult);
    });

    it('discards completion for a new package generation with no active attempt', () => {
        const fresh = cache();
        expect(updateRuntimeAttempt(fresh, 'extended', 'previous-generation', () => ({ latestAttempt: failed })))
            .toBe(fresh);
    });
});
