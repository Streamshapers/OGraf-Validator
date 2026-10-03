import { validateGddValue } from '@streamshapers/ograf-validator-core';
import {
    NON_REALTIME_METHODS,
    REQUIRED_METHODS,
    createRuntimeCycleCalls,
    type OgrafApiMethod,
} from './preview-contract.js';
import {
    PreviewRunnerAbortError,
    PreviewRunnerError,
    PreviewRunnerTimeoutError,
    createPreviewRunner,
    type PreviewRunner,
    type PreviewRunnerCallResult,
} from './preview-runner-client.js';
import { parsePreviewResourceUrl } from './preview-resources.js';
import { selectRuntimeRenderRequirement } from './render-requirements.js';
import type { RuntimeDiagnosticDetails } from './runtime-diagnostic-types.js';
import type {
    RuntimeBudgetMinutes, RuntimeScenarioResult, RuntimeTestOutcome,
    RuntimeTestProgress, RuntimeTestResult, RuntimeTestStep, RuntimeTestSuite,
} from './runtime-test-types.js';
import { createExtendedRuntimeScenarios, type RuntimeScenario } from './runtime-scenarios.js';
import { buildSchemaDefaultValue, type SchemaDefaultResult } from './schema-defaults.js';
import {
    toOgrafRenderCharacteristics,
} from './preview-types.js';
import {
    buildPreviewData,
    createPreviewSession,
} from './use-preview-sw.js';

export const RUNTIME_STEP_TIMEOUT_MS = 10_000;

export interface RunRuntimeTestOptions {
    importUrl: string;
    manifest: unknown;
    dirHandle: FileSystemDirectoryHandle;
    onStepComplete?: (step: RuntimeTestStep) => void;
    signal?: AbortSignal;
    /** Must match the session embedded in importUrl when supplied. */
    sessionId?: string;
    suite?: RuntimeTestSuite;
    runId?: string;
    budgetMinutes?: RuntimeBudgetMinutes;
    onProgress?: (progress: RuntimeTestProgress) => void;
}

interface CycleControl {
    scenario: RuntimeScenario;
    timeoutMs: (animated?: boolean) => number;
    onCheck: (id: string, label: string) => void;
}

interface CycleCompletion {
    /** False when dependent contract checks were abandoned before normal completion. */
    completed: boolean;
    blockedReason?: string;
}


export function runRuntimeTest(options: RunRuntimeTestOptions): Promise<RuntimeTestResult>;
export function runRuntimeTest(
    importUrl: string,
    manifest: unknown,
    dirHandle: FileSystemDirectoryHandle,
    onStepComplete?: (step: RuntimeTestStep) => void,
    signal?: AbortSignal,
): Promise<RuntimeTestResult>;
export async function runRuntimeTest(
    optionsOrUrl: RunRuntimeTestOptions | string,
    legacyManifest?: unknown,
    legacyDirHandle?: FileSystemDirectoryHandle,
    legacyOnStepComplete?: (step: RuntimeTestStep) => void,
    legacySignal?: AbortSignal,
): Promise<RuntimeTestResult> {
    const options = typeof optionsOrUrl === 'string'
        ? {
            importUrl: optionsOrUrl,
            manifest: legacyManifest,
            dirHandle: requireDirectoryHandle(legacyDirHandle),
            ...(legacyOnStepComplete ? { onStepComplete: legacyOnStepComplete } : {}),
            ...(legacySignal ? { signal: legacySignal } : {}),
        }
        : optionsOrUrl;
    const started = performance.now();
    if (options.suite === 'extended') return runExtendedTest(options, started);
    const steps: RuntimeTestStep[] = [];
    let inconclusive = false;
    const push = (step: RuntimeTestStep) => {
        const tagged = { ...step, suite: 'standard' as const, runId: options.runId };
        steps.push(tagged);
        options.onStepComplete?.(tagged);
        if (step.status === 'warning') inconclusive = true;
    };

    let parsedResource: ReturnType<typeof parsePreviewResourceUrl>;
    try {
        parsedResource = parsePreviewResourceUrl(options.importUrl);
        if (options.sessionId !== undefined && options.sessionId !== parsedResource.sessionId) {
            throw new Error('Runtime test sessionId does not match the import URL.');
        }
    } catch (error) {
        push(warningStep('Preview session URL', errorMessage(error), { code: 'PREVIEW_LIMITATION' }));
        return standardResult(steps, started, inconclusive, options);
    }

    const manifest = record(options.manifest);
    let data: Record<string, unknown>;
    try {
        data = buildPreviewData(options.manifest, { throwOnGenerationLimit: true });
    } catch (error) {
        push(generationLimitationStep('load() test data', 'load', error));

        return standardResult(steps, started, inconclusive, options);
    }
    const supportsRealTime = manifest['supportsRealTime'] === true;
    const supportsNonRealTime = manifest['supportsNonRealTime'] === true;

    if (options.signal?.aborted) {
        push(warningStep('Runtime test', 'Runtime test was aborted before it started.', {
            code: 'RUNTIME_ABORTED',
        }));
    } else if (supportsRealTime) {
        const cycle = await runFreshCycle('RT', 'realtime', options, parsedResource.path, data, push);
        if (!cycle.completed) inconclusive = true;
    } else {
        push(skipStep('RT cycle (not declared)'));
    }

    if (options.signal?.aborted) {
        if (!steps.some((step) => step.name === 'Runtime test' && step.status === 'warning')) {
            push(warningStep(
                'Runtime test',
                'Runtime test was aborted; remaining checks are inconclusive.',
                { code: 'RUNTIME_ABORTED' },
            ));
        }
    } else if (supportsNonRealTime) {
        const cycle = await runFreshCycle('NRT', 'non-realtime', options, parsedResource.path, data, push);
        if (!cycle.completed) inconclusive = true;
    } else {
        push(skipStep('NRT cycle (not declared)'));
    }

    return standardResult(steps, started, inconclusive, options);
}

const EXTENDED_BUDGETS = {
    2: { total: 120_000, ordinary: 10_000, animated: 30_000 },
    5: { total: 300_000, ordinary: 30_000, animated: 60_000 },
    10: { total: 600_000, ordinary: 60_000, animated: 120_000 },
} as const;

async function runExtendedTest(
    options: RunRuntimeTestOptions,
    started: number,
): Promise<RuntimeTestResult> {
    const budgetMinutes = options.budgetMinutes ?? 2;
    const budget = EXTENDED_BUDGETS[budgetMinutes];
    const deadline = started + budget.total;
    const controller = new AbortController();
    let budgetExpired = false;
    const abortFromUser = () => controller.abort();
    options.signal?.addEventListener('abort', abortFromUser, { once: true });
    if (options.signal?.aborted) abortFromUser();
    const timer = setTimeout(() => {
        budgetExpired = true;
        controller.abort();
    }, Math.max(0, deadline - performance.now()));
    const steps: RuntimeTestStep[] = [];
    const scenarios: RuntimeScenarioResult[] = [];
    const isExpired = () => budgetExpired || performance.now() >= deadline;
    const push = (step: RuntimeTestStep) => {
        const tagged: RuntimeTestStep = {
            ...step,
            suite: 'extended',
            runId: options.runId,
            ...(isExpired() && step.diagnostic?.code === 'RUNTIME_ABORTED' ? {
                error: 'The total runtime test budget was exhausted; remaining checks are inconclusive.',
                diagnostic: { ...step.diagnostic, code: 'RUNTIME_TIMEOUT', reason: 'total-budget' },
            } : {}),
        };
        steps.push(tagged);
        options.onStepComplete?.(tagged);
    };
    const timeoutMs = (animated = false) => {
        if (isExpired()) {
            budgetExpired = true;
            controller.abort();
            throw new PreviewRunnerTimeoutError('The total runtime test budget was exhausted.');
        }
        return Math.max(1, Math.min(animated ? budget.animated : budget.ordinary,
            deadline - performance.now()));
    };
    const finish = (): RuntimeTestResult => {
        const outcome: RuntimeTestOutcome = options.signal?.aborted
            ? 'cancelled' : isExpired() ? 'budget-exhausted' : 'completed';
        const inconclusive = outcome !== 'completed'
            || steps.some((step) => step.status === 'warning')
            || scenarios.some((scenario) => ['blocked', 'not-run', 'inconclusive'].includes(scenario.status));
        return { ...result(steps, started, inconclusive), suite: 'extended', runId: options.runId,
            budgetMinutes, outcome, scenarios };
    };
    try {
        let mainPath: string | undefined;
        let data: Record<string, unknown> = {};
        let commonBlock: string | undefined;
        try {
            const resource = parsePreviewResourceUrl(options.importUrl);
            if (options.sessionId !== undefined && options.sessionId !== resource.sessionId) {
                throw new Error('Runtime test sessionId does not match the import URL.');
            }
            mainPath = resource.path;
        } catch (error) {
            commonBlock = errorMessage(error);
            push(warningStep('Preview session URL', commonBlock, { code: 'PREVIEW_LIMITATION' }));
        }
        if (!commonBlock) {
            try {
                data = buildPreviewData(options.manifest, { throwOnGenerationLimit: true });
            } catch (error) {
                commonBlock = 'Automatic load data could not be generated.';
                push(generationLimitationStep('load() test data', 'load', error));
            }
            const schema = record(options.manifest)['schema'];
            if (!commonBlock && schema !== undefined && schema !== null && !checkGeneratedInput(
                'load() test data', 'load', schema, data, push,
            )) commonBlock = 'Generated load data cannot be used for runtime checks.';
        }
        const plan = createExtendedRuntimeScenarios(options.manifest, data);
        const blockedModes = new Map<'RT' | 'NRT', string>();
        for (const scenario of plan) {
            const plannedChecks = scenario.notApplicableReason ? 0 : 3 + (scenario.kind === 'baseline'
                ? createRuntimeCycleCalls(scenario.renderMode === 'RT' ? 'realtime' : 'non-realtime',
                    data, Number(record(options.manifest)['stepCount'] ?? 1)).length
                    + readCustomActions(options.manifest).length
                : scenario.calls.length);
            const summary: RuntimeScenarioResult = {
                id: scenario.id, label: scenario.label, renderMode: scenario.renderMode,
                status: 'not-run', plannedChecks, executedChecks: 0,
            };
            const scenarioPush = (step: RuntimeTestStep) => push({
                ...step, scenarioId: scenario.id, renderMode: scenario.renderMode,
            });
            const progress = (currentCheck?: string) => options.onProgress?.({
                completedScenarios: scenarios.length, totalScenarios: plan.length,
                scenarioId: scenario.id, scenarioLabel: scenario.label,
                renderMode: scenario.renderMode,
                ...(currentCheck ? { currentCheck } : {}),
            });
            progress();
            const block = commonBlock ?? blockedModes.get(scenario.renderMode);
            if (scenario.notApplicableReason) {
                summary.status = 'not-applicable';
                summary.reason = scenario.notApplicableReason;
            } else if (options.signal?.aborted || isExpired()) {
                summary.reason = options.signal?.aborted
                    ? 'Not run because the test was cancelled.' : 'Not run because the total budget was exhausted.';
                scenarioPush(warningStep(scenario.label, summary.reason, {
                    code: options.signal?.aborted ? 'RUNTIME_ABORTED' : 'RUNTIME_TIMEOUT',
                    reason: options.signal?.aborted ? 'user-cancelled' : 'total-budget',
                }));
            } else if (block || !mainPath) {
                summary.status = 'blocked';
                summary.reason = block ?? 'No usable graphic module URL.';
                scenarioPush(warningStep(scenario.label, `Blocked: ${summary.reason}`, {
                    code: 'PREVIEW_LIMITATION', reason: 'blocked-prerequisite',
                }));
            } else {
                const firstStep = steps.length;
                const checks = new Set<string>();
                let completed = false;
                if (scenario.coverageWarning) scenarioPush(warningStep(scenario.label,
                    scenario.coverageWarning, { code: 'PREVIEW_LIMITATION', reason: 'bounded-step-coverage' }));
                try {
                    const completion = await runFreshCycle(scenario.renderMode,
                        scenario.renderMode === 'RT' ? 'realtime' : 'non-realtime',
                        { ...options, signal: controller.signal }, mainPath, data, scenarioPush, {
                            scenario, timeoutMs,
                            onCheck: (id, label) => {
                                if (id !== 'cleanup') checks.add(id);
                                progress(label);
                            },
                        });
                    completed = completion.completed;
                    if (completion.blockedReason) blockedModes.set(scenario.renderMode, completion.blockedReason);
                } catch (error) {
                    scenarioPush(classifyError(scenario.label, performance.now(), error, {
                        code: 'RUNTIME_CHECK_FAILED',
                    }));
                }
                summary.executedChecks = checks.size;
                // A valid dynamic end deliberately omits further probes and remains complete.
                // An earlier failure must not erase evidence from checks it prevented us rerunning.
                const blockedChecks = !completed ? Math.max(0, plannedChecks - checks.size) : 0;
                const coverageReason = blockedChecks > 0
                    ? `${blockedChecks} dependent check(s) were not executed after the scenario stopped early.`
                    : undefined;
                if (coverageReason) scenarioPush({
                    ...warningStep(scenario.label, coverageReason, {
                        code: 'PREVIEW_LIMITATION', reason: 'blocked-dependent-checks',
                    }),
                    checkId: 'coverage',
                });
                const observed = steps.slice(firstStep);
                summary.status = observed.some((step) => step.status === 'fail') ? 'failed'
                    : observed.some((step) => step.status === 'warning') || controller.signal.aborted || isExpired()
                        ? 'inconclusive' : 'passed';
                if (summary.status === 'failed') summary.reason = 'A runtime contract or graphic execution failed.'
                    + (coverageReason ? ` ${coverageReason}` : '');
                else if (summary.status === 'inconclusive') summary.reason = coverageReason
                    ?? 'The scenario could not be fully verified.';
            }
            scenarios.push(summary);
            progress();
        }
        return finish();
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abortFromUser);
    }
}

function standardResult(
    steps: RuntimeTestStep[],
    started: number,
    inconclusive: boolean,
    options: RunRuntimeTestOptions,
): RuntimeTestResult {
    return {
        ...result(steps, started, inconclusive || options.signal?.aborted === true),
        suite: 'standard',
        runId: options.runId,
        outcome: options.signal?.aborted ? 'cancelled' : 'completed',
    };
}

async function runFreshCycle(
    label: 'RT' | 'NRT',
    renderType: 'realtime' | 'non-realtime',
    options: RunRuntimeTestOptions,
    mainPath: string,
    data: Record<string, unknown>,
    push: (step: RuntimeTestStep) => void,
    control?: CycleControl,
): Promise<CycleCompletion> {
    const session = createPreviewSession(options.dirHandle);
    try {
        return await runCycle(label, renderType, {
            ...options,
            importUrl: session.buildUrl(mainPath),
            sessionId: session.sessionId,
        }, data, (step) => push({ ...step, renderMode: label }), control);
    } finally {
        session.close();
    }
}

async function runCycle(
    label: 'RT' | 'NRT',
    renderType: 'realtime' | 'non-realtime',
    options: RunRuntimeTestOptions,
    data: Record<string, unknown>,
    emit: (step: RuntimeTestStep) => void,
    control?: CycleControl,
): Promise<CycleCompletion> {
    let checkId = 'input';
    let observedFailure = false;
    const push = (step: RuntimeTestStep) => {
        if (step.status === 'fail') observedFailure = true;
        emit({ ...step, ...(control ? { checkId } : {}) });
    };
    const beginCheck = (id: string, name: string) => {
        checkId = id;
        control?.onCheck(id, name);
    };
    const schema = record(options.manifest)['schema'];
    if (schema !== undefined && schema !== null && !checkGeneratedInput(
        `${label}: load() test data`, 'load', schema, data, push,
    )) return { completed: false, blockedReason: 'Generated load data cannot be used for runtime checks.' };

    let runner: PreviewRunner | null = null;
    const importStarted = performance.now();
    const renderRequirement = selectRuntimeRenderRequirement(options.manifest);
    try {
        beginCheck('import', 'Sandbox import');
        if (options.signal?.aborted) throw new PreviewRunnerAbortError();
        runner = await createPreviewRunner({
            sessionId: parsePreviewResourceUrl(options.importUrl).sessionId,
            importUrl: options.importUrl,
            mount: document.body,
            width: renderRequirement.characteristics.width,
            height: renderRequirement.characteristics.height,
            hidden: true,
            timeoutMs: control?.timeoutMs() ?? RUNTIME_STEP_TIMEOUT_MS,
            onRuntimeError: (message, diagnostic = { code: 'UNCAUGHT_RUNTIME_ERROR' }) => {
                push(isInconclusiveDiagnostic(diagnostic)
                    ? warningStep(`${label}: isolated preview limitation`, message, diagnostic)
                    : failStep(`${label}: unhandled runtime error`, message, 0, diagnostic));
            },
            ...(options.signal ? { signal: options.signal } : {}),
        });
        push({ name: `${label}: sandbox import`, status: 'pass', durationMs: elapsed(importStarted) });
        for (const diagnostic of runner.diagnostics) {
            push({
                name: `${label}: isolated preview limitation`,
                status: 'warning',
                durationMs: 0,
                error: diagnostic.message,
                diagnostic: { code: 'PREVIEW_LIMITATION', reason: diagnostic.code },
            });
        }
    } catch (error) {
        push(classifyError(`${label}: sandbox import`, importStarted, error, {
            code: 'SANDBOX_IMPORT_FAILED',
        }));
        return { completed: false, blockedReason: 'The graphic could not be imported in a fresh sandbox.' };
    }

    try {
        push({
            name: `${label}: ${renderRequirement.index < 0
                ? 'default render characteristics'
                : `renderRequirements[${renderRequirement.index}]`}`,
            status: 'pass',
            durationMs: 0,
        });
        for (const limitation of renderRequirement.unverifiable) {
            push({
                name: `${label}: render capability check`,
                status: 'warning',
                durationMs: 0,
                error: limitation,
                diagnostic: { code: 'PREVIEW_LIMITATION' },
            });
        }

        const required = renderType === 'non-realtime'
            ? [...REQUIRED_METHODS, ...NON_REALTIME_METHODS]
            : [...REQUIRED_METHODS];
        const missing = required.filter((method) => !runner?.methods.includes(method));
        if (missing.length > 0) {
            push({
                name: `${label}: required methods`,
                status: 'fail',
                durationMs: 0,
                error: `Missing required method(s): ${missing.map((method) => `${method}()`).join(', ')}.`,
                diagnostic: { code: 'MISSING_REQUIRED_METHODS' },
            });
            return { completed: false, blockedReason: 'Required runtime methods are missing.' };
        }
        push({ name: `${label}: required methods`, status: 'pass', durationMs: 0 });

        if (control && observedFailure) return { completed: false, blockedReason: 'An unhandled error occurred during import.' };
        beginCheck('load', 'load()');
        const loaded = await runCall(
            runner,
            `${label}: load()`,
            'load',
            {
                data,
                renderType,
                renderCharacteristics: toOgrafRenderCharacteristics(renderRequirement.characteristics),
            },
            options.signal,
            push,
            undefined,
            control?.timeoutMs,
        );
        if (!loaded || (control && observedFailure)) {
            return { completed: false, blockedReason: 'The load prerequisite did not complete successfully.' };
        }

        const manifestStepCount = record(options.manifest)['stepCount'];
        const stepCount = Number.isInteger(manifestStepCount) ? manifestStepCount as number : 1;
        if (control?.scenario.kind === 'calls') {
            for (const call of control.scenario.calls) {
                if (observedFailure) return { completed: false };
                beginCheck(call.id, call.label);
                let reachedEnd = false;
                if (!await runCall(runner, `${label}: ${call.label}`, call.method, call.params,
                    options.signal, push,
                    call.expectedCurrentStep !== undefined ? { currentStep: call.expectedCurrentStep } : undefined,
                    control.timeoutMs, call.animated,
                    (result) => { reachedEnd = result.normalized.currentStep === null; },
                )) return { completed: false };
                if (call.stopOnEnd && reachedEnd) break;
            }
        } else {
            let index = 0;
            for (const call of createRuntimeCycleCalls(renderType, data, stepCount)) {
                if (control && observedFailure) return { completed: false };
                beginCheck(`contract-${++index}`, call.label);
                if (!await runCall(
                    runner,
                    `${label}: ${call.label}`,
                    call.method,
                    call.params,
                    options.signal,
                    push,
                    call.method === 'playAction' && stepCount >= 0
                        ? { currentStep: stepCount === 0 ? null : 0 }
                        : undefined,
                    control?.timeoutMs,
                )) return { completed: false };
            }
        }

        for (const action of control?.scenario.kind === 'calls' ? [] : readCustomActions(options.manifest)) {
            if (control && observedFailure) return { completed: false };
            beginCheck(`custom-${action.id}`, `customAction(${action.id})`);
            const name = `${label}: customAction(${action.id})`;
            if (action.schema === undefined) {
                push(warningStep(name, 'Not tested: this custom action has no payload schema.', {
                    code: 'CUSTOM_ACTION_NOT_TESTED', method: 'customAction',
                }));
                continue;
            }
            let payload: SchemaDefaultResult;
            try {
                payload = action.schema === null
                    ? { ok: true, value: undefined }
                    : buildSchemaDefaultValue(action.schema);
            } catch (error) {
                push(generationLimitationStep(name, 'customAction', error));
                continue;
            }
            if (!payload.ok) {
                push(warningStep(name, `Cannot generate valid test data: ${payload.reason}`, {
                    code: 'INVALID_TEST_DATA', method: 'customAction',
                }));
                continue;
            }
            if (action.schema !== null && !checkGeneratedInput(
                name, 'customAction', action.schema, payload.value, push,
            )) continue;
            if (!await runCall(runner, name, 'customAction', {
                id: action.id,
                payload: payload.value,
                skipAnimation: true,
            }, options.signal, push, undefined, control?.timeoutMs)) return { completed: false };
        }

        const completed = !control || !observedFailure;
        if (completed) {
            beginCheck('dispose', 'dispose()');
            await runCall(runner, `${label}: dispose()`, 'dispose', {}, options.signal, push,
                undefined, control?.timeoutMs);
        }
        return { completed };
    } finally {
        try {
            beginCheck('cleanup', 'Cleanup');
            // destroy() waits for the runner's final error-event delivery before removing it.
            await runner.destroy();
        } catch (error) {
            push(classifyError(`${label}: cleanup`, performance.now(), error, {
                code: 'RUNTIME_CHECK_FAILED', method: 'dispose',
            }));
        } finally {
            runner.remove?.();
        }
    }
}

async function runCall(
    runner: PreviewRunner,
    name: string,
    method: OgrafApiMethod,
    params: unknown,
    signal: AbortSignal | undefined,
    push: (step: RuntimeTestStep) => void,
    expected?: { currentStep: number | null },
    timeoutMs?: (animated?: boolean) => number,
    animated?: boolean,
    onResult?: (result: PreviewRunnerCallResult) => void,
): Promise<boolean> {
    const started = performance.now();
    try {
        if (signal?.aborted) throw new PreviewRunnerAbortError();
        const call = await runner.call(method, params, {
            timeoutMs: timeoutMs?.(animated) ?? RUNTIME_STEP_TIMEOUT_MS,
            ...(signal ? { signal } : {}),
        });
        if (!call.wasPromise) {
            push({
                name,
                status: 'fail',
                durationMs: elapsed(started),
                error: `${method}() must return a Promise.`,
                diagnostic: { code: 'METHOD_MUST_RETURN_PROMISE', method },
            });
            return false;
        }
        if (!call.normalized.valid) {
            push({
                name,
                status: 'fail',
                durationMs: elapsed(started),
                error: call.normalized.error ?? `${method}() returned an invalid payload.`,
                diagnostic: call.normalized.diagnostic ?? { code: 'INVALID_RETURN_PAYLOAD', method },
            });
            return false;
        }
        if (!call.normalized.successful) {
            push({
                name,
                status: 'fail',
                durationMs: elapsed(started),
                error: `${method}() returned status ${call.normalized.statusCode}${
                    call.normalized.statusMessage ? `: ${call.normalized.statusMessage}` : ''
                }.`,
                diagnostic: {
                    code: 'ACTION_RETURNED_ERROR_STATUS', method,
                    statusCode: call.normalized.statusCode,
                },
            });
            return false;
        }
        if (expected && call.normalized.currentStep !== expected.currentStep) {
            push({
                name,
                status: 'fail',
                durationMs: elapsed(started),
                error: `playAction() reported currentStep ${formatStep(call.normalized.currentStep)}; ` +
                    `expected ${formatStep(expected.currentStep)} for the requested step.`,
                expectedCurrentStep: expected.currentStep,
                actualCurrentStep: call.normalized.currentStep,
                diagnostic: {
                    code: 'CURRENT_STEP_MISMATCH', method, field: 'currentStep',
                },
            });
            return false;
        }
        push({ name, status: 'pass', durationMs: elapsed(started),
            ...(expected ? { expectedCurrentStep: expected.currentStep } : {}),
            ...(call.normalized.hasCurrentStep ? { actualCurrentStep: call.normalized.currentStep } : {}),
        });
        onResult?.(call);
        return true;
    } catch (error) {
        const step = classifyError(name, started, error, { code: 'RUNTIME_CHECK_FAILED', method });
        push(step);
        return false;
    }
}

function classifyError(
    name: string,
    started: number,
    error: unknown,
    context: RuntimeDiagnosticDetails,
): RuntimeTestStep {
    if (error instanceof PreviewRunnerTimeoutError || error instanceof PreviewRunnerAbortError) {
        return {
            name,
            status: 'warning',
            durationMs: elapsed(started),
            error: error instanceof PreviewRunnerTimeoutError
                ? `${error.message} Result is inconclusive; manifest actionDurations are not a test timeout.`
                : error.message,
            diagnostic: {
                ...context,
                code: error instanceof PreviewRunnerTimeoutError ? 'RUNTIME_TIMEOUT' : 'RUNTIME_ABORTED',
            },
        };
    }
    const diagnostic = error instanceof PreviewRunnerError && error.diagnostic
        ? { ...context, ...error.diagnostic } : context;
    if (isInconclusiveDiagnostic(diagnostic)) {
        return {
            ...warningStep(name, errorMessage(error), diagnostic),
            durationMs: elapsed(started),
        };
    }

    return failStep(name, error, elapsed(started), diagnostic);
}

function failStep(
    name: string,
    error: unknown,
    durationMs: number,
    diagnostic: RuntimeDiagnosticDetails,
): RuntimeTestStep {
    return {
        name,
        status: 'fail',
        durationMs,
        error: errorMessage(error),
        diagnostic,
    };
}

function warningStep(
    name: string,
    message: string,
    diagnostic: RuntimeDiagnosticDetails,
): RuntimeTestStep {
    return { name, status: 'warning', durationMs: 0, error: message, diagnostic };
}

function isInconclusiveDiagnostic(diagnostic: RuntimeDiagnosticDetails): boolean {
    return diagnostic.code === 'PREVIEW_LIMITATION'
        || diagnostic.code === 'RUNTIME_TIMEOUT'
        || diagnostic.code === 'RUNTIME_ABORTED';
}

function generationLimitationStep(
    name: string,
    method: 'load' | 'customAction',
    error: unknown,
): RuntimeTestStep {
    return warningStep(name, `Cannot generate test data: ${errorMessage(error)}`, {
        code: 'PREVIEW_LIMITATION', method, reason: 'test-data-generation',
        hint: 'Automatic test data exceeds the validator generation budget. Supply suitable data ' +
            'manually in Preview or test with another renderer; this is not an OGraf schema violation.',
    });
}

function checkGeneratedInput(
    name: string,
    method: 'load' | 'customAction',
    schema: unknown,
    value: unknown,
    push: (step: RuntimeTestStep) => void,
): boolean {
    const validation = validateGddValue(schema, value);
    if (validation.status === 'valid') return true;

    const reason = validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join(' ');
    const unsupported = validation.status === 'unsupported';
    push(warningStep(
        name,
        `${unsupported ? 'Cannot verify generated test data' : 'Generated test data is invalid'}: ${reason}`,
        { code: unsupported ? 'UNSUPPORTED_TEST_SCHEMA' : 'INVALID_TEST_DATA', method },
    ));

    return false;
}

function formatStep(step: number | null | undefined): string {
    return step === null || step === undefined ? 'undefined' : String(step);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function skipStep(name: string): RuntimeTestStep {
    return { name, status: 'skip', durationMs: 0 };
}

function elapsed(started: number): number {
    return Math.round(performance.now() - started);
}

function result(
    steps: RuntimeTestStep[],
    started: number,
    inconclusive: boolean,
): RuntimeTestResult {
    return {
        passed: steps.every((step) => step.status !== 'fail'),
        ...(inconclusive ? { inconclusive: true } : {}),
        steps,
        totalDurationMs: elapsed(started),
    };
}

function record(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null
        ? value as Record<string, unknown>
        : {};
}

function readCustomActions(manifest: unknown): Array<{ id: string; schema: unknown }> {
    const actions = record(manifest)['customActions'];
    if (!Array.isArray(actions)) return [];
    return actions.flatMap((candidate) => {
        const action = record(candidate);
        return typeof action['id'] === 'string'
            ? [{ id: action['id'], schema: action['schema'] }]
            : [];
    });
}

function requireDirectoryHandle(
    handle: FileSystemDirectoryHandle | undefined,
): FileSystemDirectoryHandle {
    if (!handle) throw new Error('runRuntimeTest requires a package directory handle.');
    return handle;
}
