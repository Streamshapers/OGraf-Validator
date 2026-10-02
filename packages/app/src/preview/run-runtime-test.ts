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
} from './preview-runner-client.js';
import { parsePreviewResourceUrl } from './preview-resources.js';
import { selectRuntimeRenderRequirement } from './render-requirements.js';
import type { RuntimeDiagnosticDetails } from './runtime-diagnostic-types.js';
import type { RuntimeTestResult, RuntimeTestStep } from './runtime-test-types.js';
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
    const steps: RuntimeTestStep[] = [];
    let inconclusive = false;
    const push = (step: RuntimeTestStep) => {
        steps.push(step);
        options.onStepComplete?.(step);
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
        return result(steps, started, inconclusive);
    }

    const manifest = record(options.manifest);
    let data: Record<string, unknown>;
    try {
        data = buildPreviewData(options.manifest, { throwOnGenerationLimit: true });
    } catch (error) {
        push(generationLimitationStep('load() test data', 'load', error));

        return result(steps, started, inconclusive);
    }
    const supportsRealTime = manifest['supportsRealTime'] === true;
    const supportsNonRealTime = manifest['supportsNonRealTime'] === true;

    if (options.signal?.aborted) {
        push(warningStep('Runtime test', 'Runtime test was aborted before it started.', {
            code: 'RUNTIME_ABORTED',
        }));
    } else if (supportsRealTime) {
        await runFreshCycle('RT', 'realtime', options, parsedResource.path, data, push);
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
        await runFreshCycle('NRT', 'non-realtime', options, parsedResource.path, data, push);
    } else {
        push(skipStep('NRT cycle (not declared)'));
    }

    return result(steps, started, inconclusive);
}

async function runFreshCycle(
    label: 'RT' | 'NRT',
    renderType: 'realtime' | 'non-realtime',
    options: RunRuntimeTestOptions,
    mainPath: string,
    data: Record<string, unknown>,
    push: (step: RuntimeTestStep) => void,
): Promise<void> {
    const session = createPreviewSession(options.dirHandle);
    try {
        await runCycle(label, renderType, {
            ...options,
            importUrl: session.buildUrl(mainPath),
            sessionId: session.sessionId,
        }, data, push);
    } finally {
        session.close();
    }
}

async function runCycle(
    label: 'RT' | 'NRT',
    renderType: 'realtime' | 'non-realtime',
    options: RunRuntimeTestOptions,
    data: Record<string, unknown>,
    push: (step: RuntimeTestStep) => void,
): Promise<void> {
    const schema = record(options.manifest)['schema'];
    if (schema !== undefined && schema !== null && !checkGeneratedInput(
        `${label}: load() test data`, 'load', schema, data, push,
    )) return;

    let runner: PreviewRunner | null = null;
    const importStarted = performance.now();
    const renderRequirement = selectRuntimeRenderRequirement(options.manifest);
    try {
        runner = await createPreviewRunner({
            sessionId: parsePreviewResourceUrl(options.importUrl).sessionId,
            importUrl: options.importUrl,
            mount: document.body,
            width: renderRequirement.characteristics.width,
            height: renderRequirement.characteristics.height,
            hidden: true,
            timeoutMs: RUNTIME_STEP_TIMEOUT_MS,
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
        return;
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
            return;
        }
        push({ name: `${label}: required methods`, status: 'pass', durationMs: 0 });

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
        );
        if (!loaded) return;

        const manifestStepCount = record(options.manifest)['stepCount'];
        const stepCount = Number.isInteger(manifestStepCount) ? manifestStepCount as number : 1;
        for (const call of createRuntimeCycleCalls(renderType, data, stepCount)) {
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
            )) return;
        }

        for (const action of readCustomActions(options.manifest)) {
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
            }, options.signal, push)) return;
        }

        await runCall(runner, `${label}: dispose()`, 'dispose', {}, options.signal, push);
    } finally {
        try {
            // destroy() waits for the runner's final error-event delivery before removing it.
            await runner.destroy();
        } catch (error) {
            push(classifyError(`${label}: cleanup`, performance.now(), error, {
                code: 'RUNTIME_CHECK_FAILED', method: 'dispose',
            }));
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
): Promise<boolean> {
    const started = performance.now();
    try {
        const call = await runner.call(method, params, {
            timeoutMs: RUNTIME_STEP_TIMEOUT_MS,
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
                    `expected ${formatStep(expected.currentStep)} for the requested first step.`,
                diagnostic: {
                    code: 'CURRENT_STEP_MISMATCH', method, field: 'currentStep',
                },
            });
            return false;
        }
        push({ name, status: 'pass', durationMs: elapsed(started) });
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
