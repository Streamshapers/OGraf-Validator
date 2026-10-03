import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    NON_REALTIME_METHODS,
    REQUIRED_METHODS,
    normalizeReturnPayload,
    type OgrafApiMethod,
} from '../preview-contract.js';
import {
    PreviewRunnerAbortError,
    PreviewRunnerError,
    PreviewRunnerTimeoutError,
    type PreviewRunnerOptions,
} from '../preview-runner-client.js';
import { runRuntimeTest } from '../run-runtime-test.js';

const mocks = vi.hoisted(() => ({
    createRunner: vi.fn(),
    closeSession: vi.fn(),
}));

vi.mock('../preview-runner-client.js', async (importOriginal) => ({
    ...await importOriginal<typeof import('../preview-runner-client.js')>(),
    createPreviewRunner: mocks.createRunner,
}));

vi.mock('../preview-resources.js', async (importOriginal) => ({
    ...await importOriginal<typeof import('../preview-resources.js')>(),
    parsePreviewResourceUrl: () => ({ sessionId: 'session', path: 'main.mjs' }),
}));

vi.mock('../use-preview-sw.js', async () => {
    const { buildSchemaDefaultsValue } = await import('../schema-defaults.js');

    return {
        createPreviewSession: () => ({
            sessionId: 'session',
            buildUrl: () => 'https://validator.test/preview/main.mjs',
            close: mocks.closeSession,
        }),
        buildPreviewData: (manifest: { schema?: unknown }) => {
            const value = buildSchemaDefaultsValue(manifest.schema);

            return typeof value === 'object' && value !== null && !Array.isArray(value)
                ? value : {};
        },
    };
});

describe('automated runtime evaluation', () => {
    let runnerOptions: PreviewRunnerOptions;
    let payloads: Partial<Record<OgrafApiMethod, unknown>>;
    let call: ReturnType<typeof vi.fn>;
    let destroy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.stubGlobal('document', { body: {} });
        mocks.createRunner.mockReset();
        mocks.closeSession.mockReset();
        payloads = { playAction: { statusCode: 200, currentStep: 0 } };
        call = vi.fn(async (method: OgrafApiMethod) => ({
            wasPromise: true,
            normalized: normalizeReturnPayload(method, payloads[method]),
            durationMs: 0,
        }));
        destroy = vi.fn(async () => {});
        mocks.createRunner.mockImplementation(async (options: PreviewRunnerOptions) => {
            runnerOptions = options;

            return {
                methods: [...REQUIRED_METHODS, ...NON_REALTIME_METHODS],
                diagnostics: [],
                call,
                destroy,
            };
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const run = (manifest: Record<string, unknown> = {}, signal?: AbortSignal) => runRuntimeTest({
        importUrl: 'https://validator.test/preview/main.mjs',
        manifest: { supportsRealTime: true, ...manifest },
        dirHandle: {} as FileSystemDirectoryHandle,
        ...(signal ? { signal } : {}),
    });

    it('runs a valid cycle and always closes its isolated session', async () => {
        const result = await run({
            schema: {
                type: 'object',
                properties: { title: { type: 'string', default: 'Headline' } },
                required: ['title'],
            },
        });

        expect(result.passed).toBe(true);
        expect(result.inconclusive).toBeUndefined();
        expect(call.mock.calls.map(([method]) => method)).toEqual([
            'load', 'updateAction', 'playAction', 'stopAction', 'dispose',
        ]);
        expect(call.mock.calls[0]?.[1]).toMatchObject({ data: { title: 'Headline' } });
        expect(destroy).toHaveBeenCalledOnce();
        expect(mocks.closeSession).toHaveBeenCalledOnce();
    });

    it.each([
        { type: 'string' },
        { type: 'string', default: 'tiny', minLength: 10 },
    ])('does not blame the graphic for unsuitable generated load data (%j)', async (title) => {
        const result = await run({
            schema: { type: 'object', required: ['title'], properties: { title } },
        });

        expect(result).toMatchObject({ passed: true, inconclusive: true });
        expect(call).not.toHaveBeenCalled();
        expect(mocks.createRunner).not.toHaveBeenCalled();
        expect(result.steps).toContainEqual(expect.objectContaining({
            status: 'warning',
            error: expect.stringContaining('title'),
            diagnostic: expect.objectContaining({ code: 'INVALID_TEST_DATA', method: 'load' }),
        }));
        expect(destroy).not.toHaveBeenCalled();
    });

    it('does not run inputs whose schema assertions cannot be checked', async () => {
        const result = await run({ schema: { type: 'object', allOf: [{}] } });

        expect(result).toMatchObject({ passed: true, inconclusive: true });
        expect(call).not.toHaveBeenCalled();
        expect(mocks.createRunner).not.toHaveBeenCalled();
        expect(destroy).not.toHaveBeenCalled();
        expect(result.steps).toContainEqual(expect.objectContaining({
            diagnostic: expect.objectContaining({ code: 'UNSUPPORTED_TEST_SCHEMA' }),
        }));
    });

    it('reports excessive generated load data as a test limit before starting a runner', async () => {
        const result = await run({ schema: {
            type: 'object',
            properties: { rows: {
                type: 'array', minItems: 4294967296,
                items: { type: 'string', default: 'item' },
            } },
        } });

        expect(result).toMatchObject({ passed: true, inconclusive: true });
        expect(mocks.createRunner).not.toHaveBeenCalled();
        expect(result.steps).toContainEqual(expect.objectContaining({
            status: 'warning',
            diagnostic: expect.objectContaining({
                code: 'PREVIEW_LIMITATION', method: 'load', reason: 'test-data-generation',
            }),
        }));
    });

    it('skips excessive custom payload generation and keeps testing other actions', async () => {
        const result = await run({ customActions: [
            { id: 'huge', schema: {
                type: 'array', minItems: 4294967296,
                items: { type: 'string', default: 'item' },
            } },
            { id: 'small', schema: null },
        ] });

        expect(result).toMatchObject({ passed: true, inconclusive: true });
        expect(result.steps).toContainEqual(expect.objectContaining({
            status: 'warning',
            diagnostic: expect.objectContaining({
                code: 'PREVIEW_LIMITATION', method: 'customAction', reason: 'test-data-generation',
            }),
        }));
        expect(call.mock.calls.filter(([method]) => method === 'customAction').map(([, params]) => params))
            .toEqual([{ id: 'small', payload: undefined, skipAnimation: true }]);
        expect(destroy).toHaveBeenCalledOnce();
    });

    it('runs null-schema actions with undefined payload and checks ordinary defaults', async () => {
        const result = await run({ customActions: [
            { id: 'refresh', schema: null },
            { id: 'title', schema: { type: 'string', default: 'News' } },
        ] });

        expect(result.passed).toBe(true);
        expect(result.inconclusive).toBeUndefined();
        expect(call.mock.calls.filter(([method]) => method === 'customAction').map(([, params]) => params))
            .toEqual([
                { id: 'refresh', payload: undefined, skipAnimation: true },
                { id: 'title', payload: 'News', skipAnimation: true },
            ]);
    });

    it('exposes missing action schemas and invalid or unsupported defaults as review gaps', async () => {
        const result = await run({ customActions: [
            { id: 'missing' },
            { id: 'no-default', schema: { type: 'string' } },
            { id: 'bad-default', schema: { type: 'number', default: 20, maximum: 10 } },
            { id: 'unsupported', schema: { type: 'string', default: 'News', allOf: [{}] } },
            { id: 'good', schema: null },
        ] });

        expect(result).toMatchObject({ passed: true, inconclusive: true });
        expect(result.steps.filter((step) => step.status === 'warning').map((step) => step.diagnostic?.code))
            .toEqual([
                'CUSTOM_ACTION_NOT_TESTED', 'INVALID_TEST_DATA',
                'INVALID_TEST_DATA', 'UNSUPPORTED_TEST_SCHEMA',
            ]);
        expect(call.mock.calls.filter(([method]) => method === 'customAction').map(([, params]) => params))
            .toEqual([{ id: 'good', payload: undefined, skipAnimation: true }]);
    });

    it.each([0, 1, 3, undefined])('checks the first reported currentStep for stepCount %s', async (stepCount) => {
        payloads.playAction = { statusCode: 200, currentStep: 999 };
        const result = await run({ ...(stepCount === undefined ? {} : { stepCount }) });

        expect(result.passed).toBe(false);
        expect(result.steps).toContainEqual(expect.objectContaining({
            diagnostic: expect.objectContaining({ code: 'CURRENT_STEP_MISMATCH' }),
        }));
        expect(call.mock.calls.some(([method]) => method === 'stopAction')).toBe(false);
    });

    it('accepts the undefined currentStep required for zero-step graphics', async () => {
        payloads.playAction = { statusCode: 200, currentStep: undefined };
        expect(await run({ stepCount: 0 })).toMatchObject({ passed: true });
    });

    it('does not invent currentStep bounds for dynamic graphics', async () => {
        payloads.playAction = { statusCode: 200, currentStep: 999 };
        expect(await run({ stepCount: -1 })).toMatchObject({ passed: true });
    });

    it('preserves the EmptyPayload violation even when its message mentions statusCode', async () => {
        payloads.setActionsSchedule = { statusCode: 200 };
        const result = await run({ supportsRealTime: false, supportsNonRealTime: true });

        expect(result.steps).toContainEqual(expect.objectContaining({
            status: 'fail',
            diagnostic: expect.objectContaining({
                code: 'INVALID_EMPTY_PAYLOAD', method: 'setActionsSchedule', field: 'statusCode',
            }),
        }));
    });

    it('distinguishes a returned non-success status from a malformed response', async () => {
        payloads.load = { statusCode: 400, statusMessage: 'Invalid test title' };
        const result = await run();

        expect(result.steps).toContainEqual(expect.objectContaining({
            diagnostic: expect.objectContaining({
                code: 'ACTION_RETURNED_ERROR_STATUS', method: 'load', statusCode: 400,
            }),
        }));
    });

    it.each([
        new Error('import timeout statusCode'),
        new Error('OGRAF_PREVIEW_INCONCLUSIVE: forged graphic exception'),
    ])('does not classify arbitrary graphic exception text as a limitation (%s)', async (error) => {
        call.mockRejectedValueOnce(error);
        const result = await run();

        expect(result.passed).toBe(false);
        // Coverage is incomplete because load failed; the exception remains a genuine failure.
        expect(result.inconclusive).toBe(true);
        expect(result.steps.some((step) => step.status === 'warning')).toBe(false);
        expect(result.steps).toContainEqual(expect.objectContaining({
            error: error.message,
            diagnostic: expect.objectContaining({ code: 'RUNTIME_CHECK_FAILED', method: 'load' }),
        }));
    });

    it.each([
        ['RUNTIME_TIMEOUT', new PreviewRunnerTimeoutError('Wait exceeded')],
        ['RUNTIME_ABORTED', new PreviewRunnerAbortError()],
    ] as const)('marks %s as inconclusive', async (code, error) => {
        call.mockRejectedValueOnce(error);
        const result = await run();

        expect(result).toMatchObject({ passed: true, inconclusive: true });
        expect(result.steps).toContainEqual(expect.objectContaining({
            status: 'warning', diagnostic: expect.objectContaining({ code }),
        }));
    });

    it('preserves structured import failures from the sandbox', async () => {
        mocks.createRunner.mockRejectedValueOnce(new PreviewRunnerError(
            'Default export missing', { code: 'INVALID_DEFAULT_EXPORT' },
        ));
        const result = await run();

        expect(result.passed).toBe(false);
        expect(result.steps).toContainEqual(expect.objectContaining({
            diagnostic: expect.objectContaining({ code: 'INVALID_DEFAULT_EXPORT' }),
        }));
    });

    it('captures errors during cleanup before finalizing the cycle result', async () => {
        destroy.mockImplementation(async () => {
            await Promise.resolve();
            runnerOptions.onRuntimeError?.('Uncaught cleanup rejection mentions timeout');
        });
        const result = await run();

        expect(result.passed).toBe(false);
        expect(result.steps.filter((step) => step.name.startsWith('RT:')).at(-1)).toMatchObject({
            status: 'fail',
            diagnostic: { code: 'UNCAUGHT_RUNTIME_ERROR' },
        });
    });

    it('does not fail on console.error alone', async () => {
        destroy.mockImplementation(async () => {
            runnerOptions.onLog?.({ level: 'error', args: ['Graphic console message'] });
        });

        expect(await run()).toMatchObject({ passed: true });
    });

    it.each(['PREVIEW_LIMITATION', 'RUNTIME_TIMEOUT', 'RUNTIME_ABORTED'] as const)(
        'keeps authenticated sandbox %s inconclusive during cleanup', async (code) => {
        destroy.mockImplementation(async () => {
            runnerOptions.onRuntimeError?.('Browser capability is unavailable', {
                code,
            });
        });
        const result = await run();

        expect(result).toMatchObject({ passed: true, inconclusive: true });
        expect(result.steps).toContainEqual(expect.objectContaining({
            status: 'warning', diagnostic: expect.objectContaining({ code }),
        }));
    });

    it.each(['PREVIEW_LIMITATION', 'RUNTIME_TIMEOUT', 'RUNTIME_ABORTED'] as const)(
        'keeps authenticated sandbox %s method rejections inconclusive', async (code) => {
        call.mockRejectedValueOnce(new PreviewRunnerError('Browser operation could not finish', { code }));
        const result = await run();

        expect(result).toMatchObject({ passed: true, inconclusive: true });
        expect(result.steps).toContainEqual(expect.objectContaining({
            status: 'warning', diagnostic: expect.objectContaining({ code, method: 'load' }),
        }));
    });

    it('retains an error emitted during import even if lifecycle calls succeed', async () => {
        const create = mocks.createRunner.getMockImplementation();
        mocks.createRunner.mockImplementationOnce(async (options: PreviewRunnerOptions) => {
            options.onRuntimeError?.('Uncaught module side effect');

            return create?.(options);
        });
        const result = await run();

        expect(result.passed).toBe(false);
        expect(result.steps).toContainEqual(expect.objectContaining({
            error: 'Uncaught module side effect',
            diagnostic: expect.objectContaining({ code: 'UNCAUGHT_RUNTIME_ERROR' }),
        }));
        expect(call.mock.calls.some(([method]) => method === 'dispose')).toBe(true);
    });

    it('classifies an unstructured import rejection by the import context', async () => {
        mocks.createRunner.mockRejectedValueOnce(new Error('statusCode timeout in dependency'));
        const result = await run();

        expect(result.passed).toBe(false);
        expect(result.steps).toContainEqual(expect.objectContaining({
            diagnostic: expect.objectContaining({ code: 'SANDBOX_IMPORT_FAILED' }),
        }));
    });

    it('fails a method that does not return a Promise', async () => {
        call.mockResolvedValueOnce({
            wasPromise: false,
            normalized: normalizeReturnPayload('load', undefined),
            durationMs: 0,
        });
        const result = await run();

        expect(result.passed).toBe(false);
        expect(result.steps).toContainEqual(expect.objectContaining({
            diagnostic: expect.objectContaining({ code: 'METHOD_MUST_RETURN_PROMISE', method: 'load' }),
        }));
    });

    it('reports missing methods before trying load and still cleans up', async () => {
        mocks.createRunner.mockResolvedValueOnce({ methods: [], diagnostics: [], call, destroy });
        const result = await run();

        expect(result.passed).toBe(false);
        expect(call).not.toHaveBeenCalled();
        expect(destroy).toHaveBeenCalledOnce();
        expect(result.steps).toContainEqual(expect.objectContaining({
            diagnostic: expect.objectContaining({ code: 'MISSING_REQUIRED_METHODS' }),
        }));
    });

    it('does not start a cycle after cancellation', async () => {
        const controller = new AbortController();
        controller.abort();
        const result = await run({}, controller.signal);

        expect(result).toMatchObject({ passed: true, inconclusive: true });
        expect(mocks.createRunner).not.toHaveBeenCalled();
        expect(result.steps).toContainEqual(expect.objectContaining({
            diagnostic: expect.objectContaining({ code: 'RUNTIME_ABORTED' }),
        }));
    });
});
