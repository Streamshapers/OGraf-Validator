import { describe, expect, it } from 'vitest';
import {
    createExtendedRuntimeScenarios,
    type RuntimeScenario,
} from '../runtime-scenarios.js';
import type { PlayActionParams, ScheduleEntry } from '../preview-types.js';

const DEFAULT_DATA = Object.freeze({ name: 'Example' });

function scenarios(stepCount?: number): RuntimeScenario[] {
    return createExtendedRuntimeScenarios({
        supportsRealTime: true,
        ...(stepCount === undefined ? {} : { stepCount }),
    }, DEFAULT_DATA);
}

function getScenario(planned: RuntimeScenario[], id: string): RuntimeScenario {
    const found = planned.find((scenario) => scenario.id === id);
    if (!found) throw new Error(`Missing scenario ${id}`);

    return found;
}

describe('extended runtime scenario planning', () => {
    it('plans only declared modes and runs all baseline contracts first', () => {
        const both = createExtendedRuntimeScenarios({
            supportsRealTime: true, supportsNonRealTime: true,
        }, DEFAULT_DATA);
        expect(both.slice(0, 2).map(({ id, kind, calls }) => ({ id, kind, calls }))).toEqual([
            { id: 'rt.baseline', kind: 'baseline', calls: [] },
            { id: 'nrt.baseline', kind: 'baseline', calls: [] },
        ]);
        expect(scenarios().every((scenario) => scenario.renderMode === 'RT')).toBe(true);
        const nrtOnly = createExtendedRuntimeScenarios({ supportsNonRealTime: true }, {});
        expect(nrtOnly.every((scenario) => scenario.renderMode === 'NRT')).toBe(true);
        expect(nrtOnly.some((scenario) => scenario.id.startsWith('rt.'))).toBe(false);
        expect(createExtendedRuntimeScenarios({}, {})).toEqual([]);
        expect(createExtendedRuntimeScenarios(null, {})).toEqual([]);
    });

    it('uses a single step when omitted, then independently checks direct transition to end', () => {
        expect(scenarios()).toEqual(scenarios(1));
        const navigation = getScenario(scenarios(), 'rt.steps');
        expect(navigation.calls.map(({ params, expectedCurrentStep }) => ({
            params, expectedCurrentStep,
        }))).toEqual([
            { params: { skipAnimation: true }, expectedCurrentStep: 0 },
            { params: { delta: 0, skipAnimation: true }, expectedCurrentStep: 0 },
            { params: { goto: 0, skipAnimation: true }, expectedCurrentStep: 0 },
            { params: { delta: 1, skipAnimation: true }, expectedCurrentStep: null },
        ]);
        const directEnd = getScenario(scenarios(), 'rt.absolute-end');
        expect(directEnd.calls).toHaveLength(1);
        expect(directEnd.calls[0]).toMatchObject({
            method: 'playAction', params: { goto: 1, skipAnimation: true },
            expectedCurrentStep: null,
        });
    });

    it('checks forward, backward and unchanged relative navigation with absolute targets', () => {
        const navigation = getScenario(scenarios(2), 'rt.steps');
        expect(navigation.calls.map((call) => [call.params, call.expectedCurrentStep])).toEqual([
            [{ skipAnimation: true }, 0],
            [{ delta: 1, skipAnimation: true }, 1],
            [{ delta: -1, skipAnimation: true }, 0],
            [{ delta: 0, skipAnimation: true }, 0],
            [{ goto: 0, skipAnimation: true }, 0],
            [{ goto: 1, skipAnimation: true }, 1],
            [{ delta: 1, skipAnimation: true }, null],
        ]);
        expect(navigation.calls.every((call) => call.method === 'playAction')).toBe(true);
        expect(navigation.coverageWarning).toBeUndefined();
    });

    it.each([1, 2, 20])('covers every target for %i steps without a coverage warning', (count) => {
        const navigation = getScenario(scenarios(count), 'rt.steps');
        const absoluteTargets = navigation.calls.map((call) => (call.params as PlayActionParams).goto)
            .filter((target) => target !== undefined);
        expect(absoluteTargets).toEqual(Array.from({ length: count }, (_, index) => index));
        expect(navigation.coverageWarning).toBeUndefined();
        expect(navigation.calls.at(-1)?.expectedCurrentStep).toBeNull();
    });

    it.each([21, 1_000_000_000])('bounds %i steps while retaining first and last targets', (count) => {
        const navigation = getScenario(scenarios(count), 'rt.steps');
        const targets = navigation.calls.map((call) => (call.params as PlayActionParams).goto)
            .filter((target) => target !== undefined);
        expect(targets).toEqual([
            ...Array.from({ length: 18 }, (_, index) => index), count - 2, count - 1,
        ]);
        expect(new Set(targets).size).toBe(20);
        expect(navigation.coverageWarning).toContain(`20 of ${count}`);
        expect(navigation.coverageWarning).toContain(`${count - 20} intermediate steps`);
        expect(navigation.calls.at(-1)).toMatchObject({
            params: { delta: 1 }, expectedCurrentStep: null,
        });
        expect(getScenario(scenarios(count), 'rt.absolute-end').calls[0]).toMatchObject({
            params: { goto: count }, expectedCurrentStep: null,
        });
    });

    it('checks zero-step graphics without inventing goto or relative controls', () => {
        const planned = scenarios(0);
        expect(getScenario(planned, 'rt.steps').calls).toEqual([
            expect.objectContaining({
                method: 'playAction', params: { skipAnimation: true }, expectedCurrentStep: null,
            }),
        ]);
        expect(getScenario(planned, 'rt.absolute-end')).toMatchObject({
            calls: [], notApplicableReason: expect.stringContaining('no numbered steps'),
        });
        for (const call of planned.flatMap((scenario) => scenario.calls)) {
            if (call.method === 'playAction') {
                expect(call.params).not.toHaveProperty('goto');
                expect(call.params).not.toHaveProperty('delta');
                expect(call.expectedCurrentStep).toBeNull();
            }
        }
    });

    it('limits dynamic probes without presuming a step number or requiring an end', () => {
        const planned = scenarios(-1);
        const navigation = getScenario(planned, 'rt.steps');
        expect(navigation.label).toContain('up to three');
        expect(navigation.calls).toHaveLength(3);
        expect(navigation.coverageWarning).toBeUndefined();
        for (const call of navigation.calls) {
            expect(call).toMatchObject({ params: { skipAnimation: true }, stopOnEnd: true });
            expect(call).not.toHaveProperty('expectedCurrentStep');
        }
        expect(getScenario(planned, 'rt.absolute-end')).toMatchObject({
            calls: [], notApplicableReason: expect.stringContaining('no known absolute end'),
        });
    });

    it('keeps both animated play/update/stop cycles in one positive-step scenario', () => {
        const animation = getScenario(scenarios(3), 'rt.animation-repeat');
        expect(animation.calls.map((call) => call.method)).toEqual([
            'playAction', 'updateAction', 'stopAction',
            'playAction', 'updateAction', 'stopAction',
        ]);
        expect(animation.calls.every((call) => call.animated === true)).toBe(true);
        expect(animation.calls.every((call) => (call.params as PlayActionParams)
            .skipAnimation === false)).toBe(true);
        for (const call of animation.calls.filter((entry) => entry.method === 'playAction')) {
            expect(call).toMatchObject({ params: { goto: 0 }, expectedCurrentStep: 0 });
        }
        for (const call of animation.calls.filter((entry) => entry.method === 'updateAction')) {
            expect(call.params).toEqual({ data: DEFAULT_DATA, skipAnimation: false });
        }
    });

    it.each([0, -1])('isolates both animated lifecycles for stepCount %i', (stepCount) => {
        const planned = scenarios(stepCount);
        expect(planned.some((scenario) => scenario.id === 'rt.animation-repeat')).toBe(false);
        const animations = planned.filter((scenario) => scenario.id.startsWith('rt.animation-'));
        expect(animations).toHaveLength(2);
        for (const scenario of animations) {
            expect(scenario.calls.map((call) => call.method)).toEqual([
                'updateAction', 'playAction', 'stopAction',
            ]);
            expect(scenario.calls[1]?.params).toEqual({ skipAnimation: false });
            if (stepCount === 0) expect(scenario.calls[1]?.expectedCurrentStep).toBeNull();
            else expect(scenario.calls[1]).not.toHaveProperty('expectedCurrentStep');
        }
    });

    it.each([undefined, 0, -1, 3])('plans distinct NRT actions and rewind for stepCount %s', (count) => {
        const planned = createExtendedRuntimeScenarios({
            supportsNonRealTime: true, ...(count === undefined ? {} : { stepCount: count }),
        }, DEFAULT_DATA);
        const seeking = getScenario(planned, 'nrt.seeking');
        const schedule = (seeking.calls[0]?.params as { schedule: ScheduleEntry[] }).schedule;
        expect(schedule.map((entry) => entry.timestamp)).toEqual([0, 250, 750, 1000]);
        expect(schedule.map((entry) => entry.action.type)).toEqual([
            'updateAction', 'playAction', 'updateAction', 'stopAction',
        ]);
        expect(schedule[1]?.action.params).toEqual({
            ...(count === undefined || count > 0 ? { goto: 0 } : {}), skipAnimation: true,
        });
        expect(schedule.every((entry) => entry.action.params.skipAnimation === true)).toBe(true);
        expect(seeking.calls.filter((call) => call.method === 'goToTime')
            .map((call) => call.params)).toEqual([
            0, 125, 250, 500, 750, 1000, 1250, 500, 0, 1250, 1250, 0,
        ].map((timestamp) => ({ timestamp })));
        expect(seeking.calls.at(-2)).toMatchObject({
            method: 'setActionsSchedule', params: { schedule: [] },
        });
        expect(seeking.calls.at(-1)).toMatchObject({
            method: 'goToTime', params: { timestamp: 0 },
        });
        expect(seeking.calls.every((call) => call.animated !== true)).toBe(true);
    });

    it('has stable unique identifiers and does not mutate manifest or defaults', () => {
        const manifest = Object.freeze({
            supportsRealTime: true, supportsNonRealTime: true, stepCount: 21,
        });
        const first = createExtendedRuntimeScenarios(manifest, DEFAULT_DATA);
        expect(first).toEqual(createExtendedRuntimeScenarios(manifest, DEFAULT_DATA));
        expect(new Set(first.map((scenario) => scenario.id)).size).toBe(first.length);
        const calls = first.flatMap((scenario) => scenario.calls);
        expect(new Set(calls.map((call) => call.id)).size).toBe(calls.length);
        for (const scenario of first) {
            expect(scenario.id.startsWith(`${scenario.renderMode.toLowerCase()}.`)).toBe(true);
        }
        expect(DEFAULT_DATA).toEqual({ name: 'Example' });
    });
});

it('does not infer last-step or end expectations beyond exact integer precision', () => {
    const planned = scenarios(1e20);
    for (const id of ['rt.steps', 'rt.absolute-end']) {
        const scenario = getScenario(planned, id);
        expect(scenario.calls).toEqual([]);
        expect(scenario.coverageWarning).toContain('exact integer precision');
        expect(scenario.notApplicableReason).toBeUndefined();
    }
    expect(getScenario(planned, 'rt.animation-repeat').calls.some((call) => call.expectedCurrentStep === 0)).toBe(true);
    expect(getScenario(scenarios(Number.MAX_SAFE_INTEGER), 'rt.steps').calls)
        .toContainEqual(expect.objectContaining({ params: { goto: Number.MAX_SAFE_INTEGER - 1, skipAnimation: true }, expectedCurrentStep: Number.MAX_SAFE_INTEGER - 1 }));
});
