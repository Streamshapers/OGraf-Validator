import { describe, expect, it } from 'vitest';
import {
    createRuntimeSchedule,
    createRuntimeCycleCalls,
    normalizeReturnPayload,
    resolveActionDuration,
    validateSchedule,
} from '../preview-contract.js';

describe('normalizeReturnPayload', () => {
    it('treats an undefined non-play payload as status 200', () => {
        expect(normalizeReturnPayload('load', undefined)).toMatchObject({
            valid: true,
            successful: true,
            statusCode: 200,
        });
    });

    it('requires statusCode when a ReturnPayload object is returned', () => {
        expect(normalizeReturnPayload('updateAction', { result: { ok: true } })).toMatchObject({
            valid: false,
            successful: false,
        });
    });

    it('allows only v_-prefixed vendor extension fields', () => {
        expect(normalizeReturnPayload('load', { statusCode: 200, v_vendor: true }).valid).toBe(true);
        expect(normalizeReturnPayload('load', { statusCode: 200, vendor: true }).valid).toBe(false);
    });

    it('accepts every 2xx status and exposes non-2xx as unsuccessful', () => {
        expect(normalizeReturnPayload('stopAction', { statusCode: 204 }).successful).toBe(true);
        expect(normalizeReturnPayload('stopAction', { statusCode: 400 }).successful).toBe(false);
    });

    it('requires the direct, zero-based currentStep field for playAction', () => {
        expect(normalizeReturnPayload('playAction', { statusCode: 200, currentStep: 0 })).toMatchObject({
            valid: true,
            hasCurrentStep: true,
            currentStep: 0,
        });
        expect(normalizeReturnPayload('playAction', { statusCode: 200, result: { currentStep: 0 } }).valid).toBe(false);
        expect(normalizeReturnPayload('playAction', undefined).valid).toBe(false);
    });

    it('maps a present undefined currentStep to the end sentinel', () => {
        expect(normalizeReturnPayload('playAction', {
            statusCode: 200,
            currentStep: undefined,
        })).toMatchObject({ valid: true, hasCurrentStep: true, currentStep: null });
    });

    it('uses EmptyPayload semantics for setActionsSchedule', () => {
        expect(normalizeReturnPayload('setActionsSchedule', undefined).valid).toBe(true);
        expect(normalizeReturnPayload('setActionsSchedule', {}).valid).toBe(true);
        expect(normalizeReturnPayload('setActionsSchedule', { v_vendor: true }).valid).toBe(true);
        expect(normalizeReturnPayload('setActionsSchedule', { statusCode: 200 }).valid).toBe(false);
    });
});

describe('resolveActionDuration', () => {
    const manifest = {
        actionDurations: [
            {
                type: 'playAction',
                duration: 300,
                steps: [
                    { step: 0, duration: 50 },
                    { duration: 75 },
                ],
            },
            { type: 'stopAction', duration: -1 },
            { type: 'customAction', customActionId: 'reveal', duration: 125 },
        ],
    };

    it('uses exact step, fallback step, then action duration resolution', () => {
        expect(resolveActionDuration(manifest, { type: 'playAction', step: 0 })).toBe(50);
        expect(resolveActionDuration(manifest, { type: 'playAction', step: 1 })).toBe(75);
        expect(resolveActionDuration({ actionDurations: [{ type: 'playAction', duration: 300 }] }, {
            type: 'playAction',
            step: 2,
        })).toBe(300);
    });

    it('preserves -1 as dynamic metadata and resolves custom ids', () => {
        expect(resolveActionDuration(manifest, { type: 'stopAction' })).toBe(-1);
        expect(resolveActionDuration(manifest, { type: 'customAction', customActionId: 'reveal' })).toBe(125);
        expect(resolveActionDuration(manifest, { type: 'customAction', customActionId: 'other' })).toBeUndefined();
    });
});

describe('schedule wire format', () => {
    it('runs update/play/stop in both cycles and adds schedule/seek for NRT', () => {
        expect(createRuntimeCycleCalls('realtime', {}).map((call) => call.method)).toEqual([
            'updateAction', 'playAction', 'stopAction',
        ]);
        expect(createRuntimeCycleCalls('non-realtime', {}).map((call) => call.method)).toEqual([
            'updateAction', 'playAction', 'stopAction', 'setActionsSchedule', 'goToTime',
        ]);
    });

    it('creates normative action.type entries with zero-based goto', () => {
        const schedule = createRuntimeSchedule({ title: 'Test' });
        expect(validateSchedule(schedule)).toEqual([]);
        expect(schedule[1]).toMatchObject({
            timestamp: 0,
            action: { type: 'playAction', params: { goto: 0, skipAnimation: true } },
        });
    });

    it('omits goto when a Graphic declares zero steps', () => {
        const calls = createRuntimeCycleCalls('realtime', {}, 0);
        expect(calls.find((call) => call.method === 'playAction')).toMatchObject({
            label: 'playAction()',
            params: { skipAnimation: true },
        });
        expect(createRuntimeSchedule({}, 0)[1]).toMatchObject({
            action: { type: 'playAction', params: { skipAnimation: true } },
        });
        expect((createRuntimeSchedule({}, 0)[1]?.action.params as Record<string, unknown>)['goto']).toBeUndefined();
    });

    it('rejects legacy action.method and negative goto', () => {
        expect(validateSchedule([{
            timestamp: 0,
            action: { method: 'playAction', params: { goto: -1 } },
        }])).toEqual(expect.arrayContaining([
            expect.stringContaining('requires "type"'),
        ]));
    });
});
