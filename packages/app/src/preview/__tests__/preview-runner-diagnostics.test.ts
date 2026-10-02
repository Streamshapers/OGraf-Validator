import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../../public/preview-runner.js', import.meta.url), 'utf8');
const block = (start: string, end: string): string => source.slice(
    source.indexOf(`    function ${start}`), source.indexOf(`    function ${end}`),
);

class TestErrorEvent extends Event {
    readonly message?: string;
    readonly error?: unknown;

    constructor(type: string, options: EventInit & { message?: string; error?: unknown }) {
        super(type, options);
        this.message = options.message;
        this.error = options.error;
    }
}

function cancellationContext(): Record<string, unknown> {
    const context = { Error, teardownCancellations: new WeakSet(), errorDiagnostics: new WeakMap() };
    runInNewContext(block('createRunnerDestroyedError', 'reportResourceError'), context);
    runInNewContext(block('diagnosticError', 'serializeError'), context);

    return context;
}

describe('runner-generated error classification', () => {
    it('suppresses only the exact teardown cancellation object', () => {
        const context = cancellationContext();
        const create = context['createRunnerDestroyedError'] as () => Error;
        const expected = context['isExpectedResourceCancellation'] as (error: unknown) => boolean;
        expect(expected(create())).toBe(true);
        expect(expected(Object.assign(new Error('Preview runner was destroyed.'), {
            code: 'OGRAF_RUNNER_DESTROYED',
        }))).toBe(false);
        expect(expected(new Error('A real dispose failure'))).toBe(false);
        expect(expected(undefined)).toBe(false);
    });

    it('labels package, prepared-resource, and worker host timeouts at their source', async () => {
        const timers: Array<() => void> = [];
        const context = Object.assign(cancellationContext(), {
            shuttingDown: false, postPort: true, crypto: { randomUUID: () => 'test' },
            pendingFileRequests: new Map(), pendingResourceRequests: new Map(), pendingWorkerRequests: new Map(),
            post: () => undefined, setTimeout: (callback: () => void) => timers.push(callback), clearTimeout: () => undefined,
        });
        runInNewContext(block('requestPackageFile', 'rejectPendingFileRequests'), context);
        runInNewContext(block('requestHostedWorker', 'createWorkerProgramSource'), context);
        for (const [name, args, reason] of [
            ['requestPackageFile', ['test.txt', 'GET'], 'package-file-timeout'],
            ['requestPreparedResource', ['stylesheet-url', {}], 'resource-preparation-timeout'],
            ['requestHostedWorker', ['worker-1', 'module', '', ''], 'hosted-worker-timeout'],
        ] as const) {
            const request = context[name] as (...args: unknown[]) => Promise<unknown>;
            const failure = request(...args).catch((error: unknown) => error);
            timers.shift()?.();
            const error = await failure;
            expect((context['errorDiagnostics'] as WeakMap<object, unknown>).get(error as object))
                .toEqual({ code: 'RUNTIME_TIMEOUT', reason });
        }
    });

    it('preserves authenticated parent resource limitation metadata', () => {
        const context = cancellationContext();
        runInNewContext(block('createRemoteResourceError', 'createRunnerDestroyedError'), context);
        context['readRemoteError'] = (value: { message: string }) => value.message;
        const create = context['createRemoteResourceError'] as (value: unknown) => Error;
        const error = create({ message: 'Too many stylesheets', diagnostic: {
            code: 'PREVIEW_LIMITATION', reason: 'TOO_MANY_STYLESHEETS',
        } });
        expect((context['errorDiagnostics'] as WeakMap<object, unknown>).get(error))
            .toEqual({ code: 'PREVIEW_LIMITATION', reason: 'TOO_MANY_STYLESHEETS' });
    });
});

describe('worker proxy error propagation', () => {
    function workerContext(): { proxy: EventTarget & { onerror?: () => boolean; __ografFail: (error: Error) => void }; messages: unknown[] } {
        const messages: unknown[] = [];
        const context = Object.assign(cancellationContext(), {
            EventTarget, ErrorEvent: TestErrorEvent, activeWorkerProxies: new Set(),
            post: (message: unknown) => messages.push(message),
            serializeError: (error: Error) => ({ message: error.message }),
        });
        runInNewContext(block('createWorkerProxy', 'requestHostedWorker'), context);
        const create = context['createWorkerProxy'] as (id: string, path: string) => ReturnType<typeof workerContext>['proxy'];

        return { proxy: create('worker-1', 'worker.mjs'), messages };
    }

    it('reports unhandled worker failures to the runtime channel', () => {
        const { proxy, messages } = workerContext();
        proxy.__ografFail(new Error('Worker failed'));
        expect(messages).toEqual([expect.objectContaining({
            type: 'OGRAF_RUNNER_ERROR', error: expect.objectContaining({
                diagnostic: { code: 'UNCAUGHT_RUNTIME_ERROR', reason: 'worker-error' },
            }),
        })]);
    });

    it('honors error-event preventDefault and onerror return-false cancellation', () => {
        const first = workerContext();
        first.proxy.addEventListener('error', (event) => event.preventDefault());
        first.proxy.__ografFail(new Error('Handled error'));
        expect(first.messages).toEqual([]);
        const second = workerContext();
        second.proxy.onerror = () => false;
        second.proxy.__ografFail(new Error('Handled error'));
        expect(second.messages).toEqual([]);
    });
});
