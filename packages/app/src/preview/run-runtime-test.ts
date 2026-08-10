import {
    NON_REALTIME_METHODS,
    REQUIRED_METHODS,
    createRuntimeCycleCalls,
    type OgrafApiMethod,
} from './preview-contract.js';
import {
    PreviewRunnerAbortError,
    PreviewRunnerTimeoutError,
    createPreviewRunner,
    type PreviewRunner,
} from './preview-runner-client.js';
import { parsePreviewResourceUrl } from './preview-resources.js';
import { selectRuntimeRenderRequirement } from './render-requirements.js';
import type { RuntimeTestResult, RuntimeTestStep } from './runtime-test-types.js';
import { buildSchemaDefaultValue } from './schema-defaults.js';
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
        push(failStep('Preview session URL', error));
        return result(steps, started, inconclusive);
    }

    const manifest = record(options.manifest);
    const data = buildPreviewData(options.manifest);
    const supportsRealTime = manifest['supportsRealTime'] === true;
    const supportsNonRealTime = manifest['supportsNonRealTime'] === true;

    if (options.signal?.aborted) {
        push(warningStep('Runtime test', 'Runtime test was aborted before it started.'));
    } else if (supportsRealTime) {
        await runFreshCycle('RT', 'realtime', options, parsedResource.path, data, push);
    } else {
        push(skipStep('RT cycle (not declared)'));
    }

    if (options.signal?.aborted) {
        if (!steps.some((step) => step.name === 'Runtime test' && step.status === 'warning')) {
            push(warningStep('Runtime test', 'Runtime test was aborted; remaining checks are inconclusive.'));
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
            ...(options.signal ? { signal: options.signal } : {}),
        });
        push({ name: `${label}: sandbox import`, status: 'pass', durationMs: elapsed(importStarted) });
        for (const diagnostic of runner.diagnostics) {
            push({
                name: `${label}: isolated preview limitation`,
                status: 'warning',
                durationMs: 0,
                error: diagnostic.message,
            });
        }
    } catch (error) {
        push(classifyError(`${label}: sandbox import`, importStarted, error));
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

        const stepCount = Number.isInteger(record(options.manifest)['stepCount'])
            ? record(options.manifest)['stepCount'] as number
            : undefined;
        for (const call of createRuntimeCycleCalls(renderType, data, stepCount)) {
            if (!await runCall(
                runner,
                `${label}: ${call.label}`,
                call.method,
                call.params,
                options.signal,
                push,
            )) return;
        }

        for (const action of readCustomActions(options.manifest)) {
            const payload = buildSchemaDefaultValue(action.schema);
            if (!payload.ok) {
                push({
                    name: `${label}: customAction(${action.id})`,
                    status: 'skip',
                    durationMs: 0,
                    error: `Skipped: ${payload.reason}`,
                });
                continue;
            }
            if (!await runCall(runner, `${label}: customAction(${action.id})`, 'customAction', {
                id: action.id,
                payload: payload.value,
                skipAnimation: true,
            }, options.signal, push)) return;
        }

        await runCall(runner, `${label}: dispose()`, 'dispose', {}, options.signal, push);
    } finally {
        await runner.destroy();
    }
}

async function runCall(
    runner: PreviewRunner,
    name: string,
    method: OgrafApiMethod,
    params: unknown,
    signal: AbortSignal | undefined,
    push: (step: RuntimeTestStep) => void,
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
            });
            return false;
        }
        if (!call.normalized.valid) {
            push({
                name,
                status: 'fail',
                durationMs: elapsed(started),
                error: call.normalized.error ?? `${method}() returned an invalid payload.`,
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
            });
            return false;
        }
        push({ name, status: 'pass', durationMs: elapsed(started) });
        return true;
    } catch (error) {
        const step = classifyError(name, started, error);
        push(step);
        return false;
    }
}

function classifyError(name: string, started: number, error: unknown): RuntimeTestStep {
    if (error instanceof Error && error.message.includes('OGRAF_PREVIEW_INCONCLUSIVE:')) {
        return {
            name,
            status: 'warning',
            durationMs: elapsed(started),
            error: error.message.replace(/^.*OGRAF_PREVIEW_INCONCLUSIVE:\s*/, ''),
        };
    }
    if (error instanceof PreviewRunnerTimeoutError || error instanceof PreviewRunnerAbortError) {
        return {
            name,
            status: 'warning',
            durationMs: elapsed(started),
            error: error instanceof PreviewRunnerTimeoutError
                ? `${error.message} Result is inconclusive; manifest actionDurations are not a test timeout.`
                : error.message,
        };
    }
    return failStep(name, error, elapsed(started));
}

function failStep(name: string, error: unknown, durationMs = 0): RuntimeTestStep {
    return {
        name,
        status: 'fail',
        durationMs,
        error: error instanceof Error ? error.message : String(error),
    };
}

function warningStep(name: string, message: string): RuntimeTestStep {
    return { name, status: 'warning', durationMs: 0, error: message };
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
