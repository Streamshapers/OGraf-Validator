import type { RuntimeSuiteState, RuntimeTestResult, RuntimeTestStep, RuntimeTestSuite } from './runtime-test-types.js';
import { groupRuntimeFailures, type RuntimeFailureGroup } from './runtime-diagnostics.js';
import { getRuntimeSuiteResult } from './runtime-suite-state.js';

/** Keep every observation; only the presentation groups equivalent contract failures. */
export function getRuntimeFindings(standard?: RuntimeTestResult, extended?: RuntimeSuiteState): RuntimeFailureGroup[] {
    return groupRuntimeFailures([
        ...failureSteps(standard, 'standard'),
        ...failureSteps(getRuntimeSuiteResult(extended), 'extended'),
    ]);
}

function failureSteps(result: RuntimeTestResult | undefined, suite: RuntimeTestSuite): RuntimeTestStep[] {
    if (!result) return [];
    const steps = result.steps.filter((step) => step.status === 'fail');
    if (steps.length === 0 && !result.passed) {
        steps.push({ name: 'Runtime test', status: 'fail', durationMs: 0,
            error: 'The runtime test failed without returning a failed check.' });
    }

    return steps.map((step) => ({ ...step, suite }));
}
