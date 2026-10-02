import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { normalizeReturnPayload, type OgrafApiMethod } from '../preview-contract.js';
import { deserializeRunnerError } from '../preview-runner-client.js';

const source = readFileSync(new URL('../../../public/preview-runner.js', import.meta.url), 'utf8');
const context: Record<string, unknown> = { safeClone: (value: unknown) => value };
runInNewContext(source.slice(
    source.indexOf('    function isSuccessfulStatus'),
    source.indexOf('    function updateScale'),
), context);
const normalizeInRunner = context['normalizePayload'] as typeof normalizeReturnPayload;

describe('sandbox and application return-contract parity', () => {
    const values = [
        undefined, null, 0, [], {}, { v_vendor: true },
        { statusCode: 200 }, { statusCode: 204 }, { statusCode: 400 },
        { statusCode: 302 }, { statusCode: 100 }, { statusCode: 599 },
        { statusCode: '200' }, { statusCode: undefined }, { statusCode: 600 },
        { statusCode: 199.5 }, { statusCode: NaN },
        { statusCode: 200, statusMessage: 5 },
        { statusCode: 200, currentStep: 0 }, { statusCode: 200, currentStep: undefined },
        { statusCode: 200, currentStep: -1 }, { statusCode: 200, currentStep: null },
        { statusCode: 200, result: { currentStep: 0 } },
        { statusCode: 200, extra: true }, { statusCode: 200, v_vendor: true },
        Object.create({ statusCode: 200 }),
    ];
    const methods: OgrafApiMethod[] = [
        'load', 'dispose', 'playAction', 'stopAction', 'updateAction',
        'customAction', 'goToTime', 'setActionsSchedule',
    ];

    it.each(methods)('%s uses identical rules in both execution paths', (method) => {
        for (const value of values) {
            const application = normalizeReturnPayload(method, value);
            const runner = normalizeInRunner(method, value);
            expect(runner).toEqual(application);
            if (!application.valid) {
                expect(application.statusCode).toBeUndefined();
                expect(application.diagnostic?.method).toBe(method);
            }
        }
    });
});

describe('runner error metadata', () => {
    it('only serializes diagnostics created by the runner itself', () => {
        const errorContext: Record<string, unknown> = {
            errorDiagnostics: new WeakMap(), Error,
        };
        runInNewContext(source.slice(
            source.indexOf('    function diagnosticError'),
            source.indexOf('    function safeClone'),
        ), errorContext);
        const serialize = errorContext['serializeError'] as (error: Error) => { diagnostic?: unknown };
        const create = errorContext['diagnosticError'] as (message: string, diagnostic: unknown) => Error;
        const forged = Object.assign(new Error('timeout statusCode module'), {
            diagnostic: { code: 'PREVIEW_LIMITATION' },
        });
        expect(serialize(forged).diagnostic).toBeUndefined();
        expect(serialize(create('x', { code: 'PREVIEW_LIMITATION' })).diagnostic)
            .toEqual({ code: 'PREVIEW_LIMITATION' });
    });

    it('retains known source metadata and the original remote stack', () => {
        const error = deserializeRunnerError({
            message: 'Graphic default export must extend HTMLElement.',
            stack: 'remote source location',
            diagnostic: { code: 'DEFAULT_EXPORT_NOT_HTMLELEMENT', reason: 'invalid-class' },
        });
        expect(error.diagnostic).toEqual({
            code: 'DEFAULT_EXPORT_NOT_HTMLELEMENT', reason: 'invalid-class',
        });
        expect(error.stack).toBe('remote source location');
    });

    it('does not infer metadata from messages or accept remote hint links', () => {
        expect(deserializeRunnerError('statusCode timeout module').diagnostic).toBeUndefined();
        expect(deserializeRunnerError({ message: 'x', diagnostic: { code: 'INVENTED' } }).diagnostic)
            .toBeUndefined();
        const error = deserializeRunnerError({ message: 'x', diagnostic: {
            code: 'INVALID_STATUS_CODE', specRef: 'javascript:alert(1)', hint: 'Untrusted advice',
        } });
        expect(error.diagnostic).toEqual({ code: 'INVALID_STATUS_CODE' });
    });
});
