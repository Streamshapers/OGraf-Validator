import type { PackageCache } from './components/ContentArea.js';
import type { RuntimeSuiteState, RuntimeTestSuite } from './preview/runtime-test-types.js';
import { getRuntimeSuiteResult } from './preview/runtime-suite-state.js';

export function readRuntimeSuite(
    cache: PackageCache,
    suite: RuntimeTestSuite,
): RuntimeSuiteState | undefined {
    if (suite === 'extended') return cache.extendedRuntimeTest;
    return cache.standardRuntimeTest ?? (cache.runtimeTest
        ? { latestAttempt: cache.runtimeTest, lastCompleted: cache.runtimeTest }
        : undefined);
}

export function writeRuntimeSuite(
    cache: PackageCache,
    suite: RuntimeTestSuite,
    state: RuntimeSuiteState,
): PackageCache {
    if (suite === 'extended') return { ...cache, extendedRuntimeTest: state };
    return {
        ...cache,
        standardRuntimeTest: state,
        runtimeTest: getRuntimeSuiteResult(state),
        runtimeTestPhase: state.active
            ? state.active.phase === 'pending' ? 'pending' : 'running'
            : undefined,
        runtimeTestSteps: state.active?.steps,
    };
}

/** Run identity is checked at state-update time, not only when an event arrives. */
export function updateRuntimeAttempt(
    cache: PackageCache,
    suite: RuntimeTestSuite,
    runId: string,
    update: (state: RuntimeSuiteState) => RuntimeSuiteState,
): PackageCache {
    const state = readRuntimeSuite(cache, suite);
    if (!state?.active || state.active.runId !== runId) return cache;
    return writeRuntimeSuite(cache, suite, update(state));
}
