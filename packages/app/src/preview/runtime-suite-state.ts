import type {
    RuntimeActiveAttempt,
    RuntimeSuiteState,
    RuntimeTestResult,
    RuntimeTestStep,
} from './runtime-test-types.js';

export function startRuntimeSuite(
    state: RuntimeSuiteState | undefined,
    active: RuntimeActiveAttempt,
): RuntimeSuiteState {
    return {
        ...state,
        retainedFailures: collectFailures(getRuntimeSuiteResult(state)),
        active: { ...active, steps: [...active.steps] },
    };
}

export function completeRuntimeSuite(
    state: RuntimeSuiteState | undefined,
    result: RuntimeTestResult,
): RuntimeSuiteState {
    if (isConclusiveRuntimeResult(result)) {
        return { lastCompleted: result, latestAttempt: result };
    }

    return {
        ...(state?.lastCompleted ? { lastCompleted: state.lastCompleted } : {}),
        latestAttempt: result,
        retainedFailures: uniqueFailures([
            ...collectFailures(getRuntimeSuiteResult(state)),
            ...collectFailures(result),
        ]),
    };
}

/** Keep established failures until a complete, conclusive replacement run exists. */
export function getRuntimeSuiteResult(
    state: RuntimeSuiteState | undefined,
): RuntimeTestResult | undefined {
    if (!state) return undefined;

    const previous = state.latestAttempt ?? state.lastCompleted;
    const failures = uniqueFailures([
        ...(state.retainedFailures ?? []),
        ...collectFailures(previous),
        ...(state.active?.steps.filter((step) => step.status === 'fail') ?? []),
    ]);
    if (!previous && failures.length === 0) return undefined;

    return {
        ...previous,
        passed: failures.length === 0 && (previous?.passed ?? true),
        ...((!previous && state.active) || (previous && !isConclusiveRuntimeResult(previous))
            ? { inconclusive: true } : {}),
        steps: [...(previous?.steps.filter((step) => step.status !== 'fail') ?? []), ...failures],
        totalDurationMs: previous?.totalDurationMs ?? 0,
    };
}

export function isConclusiveRuntimeResult(result: RuntimeTestResult): boolean {
    return !result.inconclusive
        && (result.outcome === undefined || result.outcome === 'completed')
        && !result.steps.some((step) => step.status === 'warning')
        && !result.scenarios?.some((scenario) => (
            scenario.status === 'inconclusive'
            || scenario.status === 'blocked'
            || scenario.status === 'not-run'
        ));
}

function collectFailures(result: RuntimeTestResult | undefined): RuntimeTestStep[] {
    if (!result) return [];

    const failures = result.steps.filter((step) => step.status === 'fail');
    if (failures.length > 0 || result.passed) return failures;

    return [{
        name: 'Runtime test',
        status: 'fail',
        durationMs: 0,
        error: 'The runtime test failed without returning a failed check.',
        ...(result.suite ? { suite: result.suite } : {}),
        ...(result.runId ? { runId: result.runId } : {}),
    }];
}

function uniqueFailures(steps: RuntimeTestStep[]): RuntimeTestStep[] {
    const failures = new Map<string, RuntimeTestStep>();
    for (const step of steps) {
        const key = JSON.stringify([
            step.name, step.scenarioId, step.checkId, step.renderMode,
            step.error, step.diagnostic?.code, step.diagnostic?.reason,
            step.diagnostic?.method, step.diagnostic?.field,
            step.expectedCurrentStep, step.actualCurrentStep,
        ]);
        failures.set(key, step);
    }

    return [...failures.values()];
}
