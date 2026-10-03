import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    NON_REALTIME_METHODS, REQUIRED_METHODS, normalizeReturnPayload, type OgrafApiMethod,
} from '../preview-contract.js';
import {
    PreviewRunnerAbortError, PreviewRunnerError, PreviewRunnerTimeoutError,
    type PreviewRunnerCallOptions, type PreviewRunnerCallResult, type PreviewRunnerOptions,
} from '../preview-runner-client.js';
import { runRuntimeTest, type RunRuntimeTestOptions } from '../run-runtime-test.js';
import type { RuntimeTestProgress } from '../runtime-test-types.js';
import { completeRuntimeSuite, getRuntimeSuiteResult, isConclusiveRuntimeResult } from '../runtime-suite-state.js';

const mocks = vi.hoisted(() => ({ createRunner: vi.fn(), closeSession: vi.fn(), nextSession: 0 }));
vi.mock('../preview-runner-client.js', async (original) => ({
    ...await original<typeof import('../preview-runner-client.js')>(), createPreviewRunner: mocks.createRunner,
}));
vi.mock('../preview-resources.js', async (original) => ({
    ...await original<typeof import('../preview-resources.js')>(),
    parsePreviewResourceUrl: (url: string) => ({ sessionId: new URL(url).pathname.split('/')[1], path: 'main.mjs' }),
}));
vi.mock('../use-preview-sw.js', async () => {
    const { buildSchemaDefaultsValue } = await import('../schema-defaults.js');
    return {
        createPreviewSession: () => {
            const sessionId = `fresh-${++mocks.nextSession}`;
            return { sessionId, buildUrl: () => `https://validator.test/${sessionId}/main.mjs`,
                close: () => mocks.closeSession(sessionId) };
        },
        buildPreviewData: (manifest: { schema?: unknown }) => buildSchemaDefaultsValue(manifest.schema) ?? {},
    };
});

interface Instance {
    scenario: string;
    options: PreviewRunnerOptions;
    playCount: number;
    call: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
}

describe('extended runtime scenarios', () => {
    let instances: Instance[];
    let stepCount: number;
    let progress: RuntimeTestProgress[];
    let effect: ((instance: Instance, method: OgrafApiMethod, params: Record<string, unknown>,
        options?: PreviewRunnerCallOptions) => Promise<PreviewRunnerCallResult | undefined>) | undefined;
    let cleanupEffect: ((instance: Instance) => Promise<void>) | undefined;

    const run = (manifest: Record<string, unknown> = {}, extra: Partial<RunRuntimeTestOptions> = {}) => {
        stepCount = typeof manifest['stepCount'] === 'number' ? manifest['stepCount'] : 1;
        return runRuntimeTest({
            importUrl: 'https://validator.test/session/main.mjs', sessionId: 'session',
            manifest: { supportsRealTime: true, ...manifest }, dirHandle: {} as FileSystemDirectoryHandle,
            suite: 'extended', runId: 'test-run', onProgress: (value) => progress.push(value), ...extra,
        });
    };

    beforeEach(() => {
        vi.stubGlobal('document', { body: {} });
        mocks.createRunner.mockReset();
        mocks.closeSession.mockReset();
        mocks.nextSession = 0;
        instances = [];
        progress = [];
        effect = undefined;
        cleanupEffect = undefined;
        mocks.createRunner.mockImplementation(async (options: PreviewRunnerOptions) => {
            let current: number | null = null;
            const instance: Instance = {
                scenario: progress.at(-1)?.scenarioId ?? '', options, playCount: 0,
                call: vi.fn(), destroy: vi.fn(), remove: vi.fn(),
            };
            instance.call.mockImplementation(async (method: OgrafApiMethod,
                params: Record<string, unknown>, callOptions?: PreviewRunnerCallOptions) => {
                if (method === 'playAction') instance.playCount++;
                const overridden = await effect?.(instance, method, params, callOptions);
                if (overridden) return overridden;
                if (method === 'playAction') {
                    if (stepCount === 0) current = null;
                    else if (stepCount === -1) current = 999;
                    else {
                        current = typeof params['goto'] === 'number' ? params['goto']
                            : current === null ? 0 : current + Number(params['delta'] ?? 1);
                        if (current >= stepCount) current = null;
                    }
                }
                if (method === 'stopAction') current = null;
                return response(method, method === 'playAction'
                    ? { statusCode: 200, currentStep: current === null ? undefined : current } : undefined);
            });
            instance.destroy.mockImplementation(async () => { await cleanupEffect?.(instance); });
            instances.push(instance);
            return { methods: [...REQUIRED_METHODS, ...NON_REALTIME_METHODS], diagnostics: [],
                call: instance.call, destroy: instance.destroy, remove: instance.remove };
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('uses isolated sessions, reports progress and preserves baseline custom action checks', async () => {
        const result = await run({ supportsNonRealTime: true, stepCount: 3,
            customActions: [{ id: 'refresh', schema: null }] });
        expect(result).toMatchObject({ passed: true, suite: 'extended', runId: 'test-run',
            budgetMinutes: 2, outcome: 'completed' });
        expect(result.inconclusive).toBeUndefined();
        expect(instances.slice(0, 2).map((instance) => instance.scenario)).toEqual(['rt.baseline', 'nrt.baseline']);
        expect(new Set(instances.map((instance) => instance.options.sessionId)).size).toBe(instances.length);
        for (const instance of instances) {
            expect(instance.call.mock.calls[0]?.[0]).toBe('load');
            expect(instance.call.mock.calls.at(-1)?.[0]).toBe('dispose');
            expect(instance.destroy).toHaveBeenCalledOnce();
            expect(instance.remove).toHaveBeenCalledOnce();
        }
        expect(instances.filter((instance) => instance.call.mock.calls.some(([method]) => method === 'customAction')))
            .toHaveLength(2);
        expect(result.steps.every((step) => step.suite === 'extended' && step.runId === 'test-run'
            && step.scenarioId && step.renderMode)).toBe(true);
        expect(result.scenarios?.every((scenario) => scenario.status === 'passed')).toBe(true);
        expect(progress.at(-1)).toMatchObject({ completedScenarios: result.scenarios?.length,
            totalScenarios: result.scenarios?.length });
    });

    it('fails on a later incorrect step and continues independent fresh scenarios', async () => {
        effect = async (instance, method, params) => instance.scenario === 'rt.steps'
            && method === 'playAction' && params['goto'] === 2
            ? response(method, { statusCode: 200, currentStep: 999 }) : undefined;
        const result = await run({ stepCount: 4 });
        expect(result.passed).toBe(false);
        expect(result.inconclusive).toBe(true);
        expect(result.steps).toContainEqual(expect.objectContaining({
            scenarioId: 'rt.steps', checkId: 'coverage', status: 'warning',
            diagnostic: expect.objectContaining({ reason: 'blocked-dependent-checks' }),
        }));
        expect(result.steps).toContainEqual(expect.objectContaining({
            scenarioId: 'rt.steps', checkId: 'rt.steps.goto-2', renderMode: 'RT',
            expectedCurrentStep: 2, actualCurrentStep: 999,
            diagnostic: expect.objectContaining({ code: 'CURRENT_STEP_MISMATCH' }),
        }));
        const failed = instances.find((instance) => instance.scenario === 'rt.steps');
        expect(failed?.call.mock.calls.some(([, params]) => params['goto'] === 3)).toBe(false);
        expect(result.scenarios).toContainEqual(expect.objectContaining({ id: 'rt.absolute-end', status: 'passed' }));
    });

    it('finds failures occurring only during a second animated play', async () => {
        effect = async (instance, method) => {
            if (instance.scenario === 'rt.animation-repeat' && method === 'playAction' && instance.playCount === 2) {
                throw new Error('Second play failed');
            }
            return undefined;
        };
        const result = await run();
        expect(result.steps).toContainEqual(expect.objectContaining({
            status: 'fail', scenarioId: 'rt.animation-repeat', checkId: 'rt.animation-repeat.play-2',
            error: 'Second play failed',
        }));
        const calls = instances.find((instance) => instance.scenario === 'rt.animation-repeat')?.call.mock.calls;
        expect(calls?.map(([method]) => method)).toEqual(['load', 'playAction', 'updateAction', 'stopAction', 'playAction']);
    });

    it.each([0, -1])('uses two fresh animated lifecycles for stepCount %i', async (count) => {
        const result = await run({ stepCount: count });
        expect(result.passed).toBe(true);
        expect(result.inconclusive).toBeUndefined();
        const lifecycles = instances.filter((instance) => instance.scenario.startsWith('rt.animation-lifecycle'));
        expect(lifecycles).toHaveLength(2);
        for (const instance of lifecycles) expect(instance.call.mock.calls.map(([method]) => method))
            .toEqual(['load', 'updateAction', 'playAction', 'stopAction', 'dispose']);
        expect(result.scenarios).toContainEqual(expect.objectContaining({ id: 'rt.absolute-end', status: 'not-applicable' }));
    });

    it('stops dynamic probes on reported end without treating it as an incomplete test', async () => {
        effect = async (instance, method) => instance.scenario === 'rt.steps' && method === 'playAction'
            ? response(method, { statusCode: 200, currentStep: undefined }) : undefined;
        const result = await run({ stepCount: -1 });
        expect(result).toMatchObject({ passed: true, outcome: 'completed' });
        expect(result.inconclusive).toBeUndefined();
        expect(instances.find((instance) => instance.scenario === 'rt.steps')?.playCount).toBe(1);
        expect(isConclusiveRuntimeResult(result)).toBe(true);
        const scenario = result.scenarios?.find((item) => item.id === 'rt.steps');
        expect(scenario!.executedChecks).toBeLessThan(scenario!.plannedChecks);
    });

    it('does not invent bounds or require an end from a dynamic graphic', async () => {
        const result = await run({ stepCount: -1 });
        expect(result.passed).toBe(true);
        expect(result.inconclusive).toBeUndefined();
        expect(instances.find((instance) => instance.scenario === 'rt.steps')?.playCount).toBe(3);
    });

    it('marks bounded coverage as inconclusive when more than twenty targets exist', async () => {
        const result = await run({ stepCount: 1000 });
        expect(result).toMatchObject({ passed: true, inconclusive: true });
        expect(result.steps).toContainEqual(expect.objectContaining({
            scenarioId: 'rt.steps', diagnostic: expect.objectContaining({ reason: 'bounded-step-coverage' }),
        }));
        expect(result.scenarios).toContainEqual(expect.objectContaining({ id: 'rt.steps', status: 'inconclusive' }));
    });

    it('blocks all scenarios before creating a runner for invalid generated input', async () => {
        const result = await run({ supportsNonRealTime: true,
            schema: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } } });
        expect(result).toMatchObject({ passed: true, inconclusive: true });
        expect(instances).toHaveLength(0);
        expect(result.scenarios?.every((scenario) => scenario.status === 'blocked')).toBe(true);
    });

    it('blocks all scenarios when no declared render requirement can be selected', async () => {
        const result = await run({ supportsNonRealTime: true,
            renderRequirements: [{ frameRate: { exact: 40, min: 50 } }] });
        expect(result).toMatchObject({ passed: true, inconclusive: true });
        expect(instances).toHaveLength(0);
        expect(result.scenarios?.every((scenario) => scenario.status === 'blocked')).toBe(true);
        expect(result.steps).toContainEqual(expect.objectContaining({
            diagnostic: expect.objectContaining({ reason: 'unmatched-render-requirements' }),
        }));
    });

    it('blocks dependent scenarios after an import failure', async () => {
        mocks.createRunner.mockRejectedValueOnce(new PreviewRunnerError('No default export', { code: 'INVALID_DEFAULT_EXPORT' }));
        const result = await run();
        expect(result.passed).toBe(false);
        expect(mocks.createRunner).toHaveBeenCalledOnce();
        expect(result.scenarios?.slice(1).every((scenario) => scenario.status === 'blocked')).toBe(true);
        expect(mocks.closeSession).toHaveBeenCalledOnce();
    });

    it('blocks dependent scenarios after missing methods or failed load', async () => {
        mocks.createRunner.mockResolvedValueOnce({ methods: [], diagnostics: [], call: vi.fn(),
            destroy: vi.fn(), remove: vi.fn() });
        const result = await run();
        expect(result.passed).toBe(false);
        expect(mocks.createRunner).toHaveBeenCalledOnce();
        expect(result.scenarios?.slice(1).every((scenario) => scenario.status === 'blocked')).toBe(true);
    });

    it.each(['later', 'rewind', 'repeated'])('detects NRT %s seeking errors', async (failure) => {
        const visited: number[] = [];
        effect = async (instance, method, params) => {
            if (instance.scenario !== 'nrt.seeking' || method !== 'goToTime') return undefined;
            const timestamp = Number(params['timestamp']);
            const previous = visited.at(-1);
            visited.push(timestamp);
            if ((failure === 'later' && timestamp === 750)
                || (failure === 'rewind' && previous === 1250 && timestamp === 500)
                || (failure === 'repeated' && previous === 1250 && timestamp === 1250)) {
                throw new Error(`${failure} seeking failure`);
            }
            return undefined;
        };
        const result = await run({ supportsRealTime: false, supportsNonRealTime: true });
        expect(result.passed).toBe(false);
        expect(result.steps).toContainEqual(expect.objectContaining({
            scenarioId: 'nrt.seeking', status: 'fail', error: `${failure} seeking failure`,
        }));
    });

    it('keeps EmptyPayload violations in later schedule calls', async () => {
        effect = async (instance, method) => instance.scenario === 'nrt.seeking' && method === 'setActionsSchedule'
            ? response(method, { statusCode: 200 }) : undefined;
        const result = await run({ supportsRealTime: false, supportsNonRealTime: true });
        expect(result.steps).toContainEqual(expect.objectContaining({ scenarioId: 'nrt.seeking',
            diagnostic: expect.objectContaining({ code: 'INVALID_EMPTY_PAYLOAD' }) }));
    });

    it('does not reuse a timed-out runner and keeps fresh independent checks', async () => {
        effect = async (instance, method) => {
            if (instance.scenario === 'rt.steps' && method === 'playAction') throw new PreviewRunnerTimeoutError('Timeout');
            return undefined;
        };
        const result = await run();
        expect(result).toMatchObject({ passed: true, inconclusive: true, outcome: 'completed' });
        expect(instances.find((instance) => instance.scenario === 'rt.steps')?.call.mock.calls.map(([method]) => method))
            .toEqual(['load', 'playAction']);
        expect(result.scenarios).toContainEqual(expect.objectContaining({ id: 'rt.animation-repeat', status: 'passed' }));
    });

    it.each([
        [2, 10_000, 30_000], [5, 30_000, 60_000], [10, 60_000, 120_000],
    ] as const)('uses ordinary and animated limits for a %i-minute budget', async (minutes, ordinary, animated) => {
        vi.spyOn(performance, 'now').mockReturnValue(0);
        const result = await run({}, { budgetMinutes: minutes });
        expect(result.budgetMinutes).toBe(minutes);
        for (const instance of instances) {
            expect(instance.options.timeoutMs).toBe(ordinary);
            for (const [method, params, options] of instance.call.mock.calls) {
                const isAnimated = ['playAction', 'updateAction', 'stopAction'].includes(method)
                    && params['skipAnimation'] === false;
                expect(options.timeoutMs).toBe(isAnimated ? animated : ordinary);
            }
        }
    });

    it('caps the next call at the remaining shared budget across scenarios and modes', async () => {
        let clock = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => clock);
        effect = async (instance, method, _params, options) => {
            if (instance.scenario === 'rt.baseline' && method === 'dispose') clock = 119_000;
            if (instance.scenario === 'nrt.baseline' && method === 'load') {
                expect(options?.timeoutMs).toBe(1000);
                clock = 120_000;
                throw new PreviewRunnerTimeoutError('Remaining budget elapsed');
            }
            return undefined;
        };
        const result = await run({ supportsNonRealTime: true });
        expect(result).toMatchObject({ passed: true, inconclusive: true, outcome: 'budget-exhausted' });
        expect(instances).toHaveLength(2);
        expect(result.scenarios?.slice(2).every((scenario) => scenario.status === 'not-run')).toBe(true);
    });

    it.each([2, 5, 10] as const)('actively aborts an import at the %i-minute total deadline', async (minutes) => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
        mocks.createRunner.mockImplementationOnce((options: PreviewRunnerOptions) => new Promise((_, reject) => {
            options.signal?.addEventListener('abort', () => reject(new PreviewRunnerAbortError()), { once: true });
        }));
        const pending = run({}, { budgetMinutes: minutes });
        await vi.advanceTimersByTimeAsync(minutes * 60_000);
        const result = await pending;
        expect(result).toMatchObject({ passed: true, inconclusive: true, outcome: 'budget-exhausted' });
        expect(result.steps).toContainEqual(expect.objectContaining({ diagnostic: expect.objectContaining({
            code: 'RUNTIME_TIMEOUT', reason: 'total-budget',
        }) }));
        expect(mocks.closeSession).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('retains partial failures after user cancellation and still observes asynchronous cleanup errors', async () => {
        const controller = new AbortController();
        const ordering: string[] = [];
        effect = async (instance, method) => {
            if (instance.scenario === 'rt.steps' && method === 'playAction') {
                instance.options.onRuntimeError?.('Earlier failure');
                controller.abort();
                throw new PreviewRunnerAbortError();
            }
            return undefined;
        };
        cleanupEffect = async (instance) => {
            if (instance.scenario !== 'rt.steps') return;
            await Promise.resolve();
            ordering.push('cleanup');
            instance.options.onRuntimeError?.('Cleanup rejection');
        };
        mocks.closeSession.mockImplementation(() => { ordering.push('close'); });
        const result = await run({}, { signal: controller.signal });
        expect(result).toMatchObject({ passed: false, inconclusive: true, outcome: 'cancelled' });
        expect(result.steps.filter((step) => step.status === 'fail').map((step) => step.error))
            .toEqual(['Earlier failure', 'Cleanup rejection']);
        expect(ordering.slice(-2)).toEqual(['cleanup', 'close']);
        expect(result.scenarios?.slice(2).every((scenario) => scenario.status === 'not-run')).toBe(true);
        expect(instances[1]?.remove).toHaveBeenCalledOnce();
    });

    it('performs no import after pre-start cancellation, with terminal outcome even for standard tests', async () => {
        const controller = new AbortController();
        controller.abort();
        const extended = await run({}, { signal: controller.signal });
        const standard = await run({}, { signal: controller.signal, suite: 'standard' });
        expect(extended).toMatchObject({ outcome: 'cancelled', inconclusive: true });
        expect(standard).toMatchObject({ outcome: 'cancelled', inconclusive: true });
        expect(mocks.createRunner).not.toHaveBeenCalled();
    });

    it.each(['standard', 'extended'] as const)(
        'preserves unrechecked failures across an earlier failing %s retry, then clears them on full success',
        async (suite) => {
            let failure: 'late' | 'early' = 'late';
            effect = async (instance, method, params) => {
                const isTarget = suite === 'standard'
                    ? method === (failure === 'late' ? 'stopAction' : 'updateAction')
                    : instance.scenario === 'rt.steps' && method === 'playAction'
                        && (failure === 'late' ? params['goto'] === 2 : instance.playCount === 1);
                if (isTarget) throw new Error(`${failure} graphic failure`);
                return undefined;
            };
            const first = await run({ stepCount: 4 }, { suite });
            expect(first).toMatchObject({ passed: false, inconclusive: true });
            let state = completeRuntimeSuite(undefined, first);
            failure = 'early';
            const retry = await run({ stepCount: 4 }, { suite, runId: 'earlier-failing-retry' });
            expect(retry).toMatchObject({ passed: false, inconclusive: true });
            state = completeRuntimeSuite(state, retry);
            expect(getRuntimeSuiteResult(state)?.steps.filter((step) => step.status === 'fail')
                .map((step) => step.error)).toEqual(['late graphic failure', 'early graphic failure']);
            if (suite === 'standard') {
                // Existing contract diagnoses are unchanged; completeness is additive metadata.
                expect(retry.steps.some((step) => step.status === 'warning')).toBe(false);
            } else {
                expect(retry.scenarios).toContainEqual(expect.objectContaining({
                    id: 'rt.steps', status: 'failed', reason: expect.stringContaining('dependent check'),
                }));
            }
            effect = undefined;
            const complete = await run({ stepCount: 4 }, { suite, runId: 'full-success' });
            expect(isConclusiveRuntimeResult(complete)).toBe(true);
            state = completeRuntimeSuite(state, complete);
            expect(getRuntimeSuiteResult(state)).toMatchObject({ passed: true, runId: 'full-success' });
            expect(getRuntimeSuiteResult(state)?.steps.filter((step) => step.status === 'fail')).toEqual([]);
        },
    );

    it.each([
        ['standard', 'dispose'], ['standard', 'cleanup'], ['extended', 'dispose'], ['extended', 'cleanup'],
    ] as const)('keeps a final %s %s failure conclusive when all checks were evaluated', async (suite, stage) => {
        if (stage === 'dispose') effect = async (_instance, method) => {
            if (method === 'dispose') throw new Error('Final disposal failed');
            return undefined;
        };
        else cleanupEffect = async (instance) => { instance.options.onRuntimeError?.('Final cleanup failed'); };
        const result = await run({}, { suite });
        expect(result.passed).toBe(false);
        expect(result.inconclusive).toBeUndefined();
        expect(isConclusiveRuntimeResult(result)).toBe(true);
        expect(result.steps.some((step) => step.diagnostic?.reason === 'blocked-dependent-checks')).toBe(false);
    });

    it('allocates fresh sessions on a budget retry', async () => {
        await run();
        const first = instances.map((instance) => instance.options.sessionId);
        await run({}, { budgetMinutes: 5, runId: 'retry' });
        const second = instances.slice(first.length).map((instance) => instance.options.sessionId);
        expect(second.every((sessionId) => !first.includes(sessionId))).toBe(true);
    });
});

function response(method: OgrafApiMethod, payload: unknown): PreviewRunnerCallResult {
    return { wasPromise: true, normalized: normalizeReturnPayload(method, payload), durationMs: 0 };
}
