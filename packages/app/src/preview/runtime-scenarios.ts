import type { OgrafApiMethod } from './preview-contract.js';
import type { PlayActionParams, ScheduleEntry } from './preview-types.js';
import type { RuntimeRenderMode } from './runtime-test-types.js';

export interface RuntimeScenarioCall {
    id: string;
    method: OgrafApiMethod;
    label: string;
    params: unknown;
    /** null represents the end state (currentStep: undefined) on the wire. */
    expectedCurrentStep?: number | null;
    animated?: boolean;
    stopOnEnd?: boolean;
}

export interface RuntimeScenario {
    id: string;
    label: string;
    renderMode: RuntimeRenderMode;
    kind: 'baseline' | 'calls';
    calls: RuntimeScenarioCall[];
    notApplicableReason?: string;
    coverageWarning?: string;
}

const MAX_TARGET_STEPS = 20;
const IMPRECISE_STEP_COVERAGE = 'Step navigation is not tested because stepCount exceeds '
    + 'JavaScript exact integer precision. Basic contracts and step-zero lifecycle checks remain available.';
const DYNAMIC_PLAY_LIMIT = 3;
const LIFECYCLE_REPETITIONS = 2;
const NRT_SEEK_TIMESTAMPS = [0, 125, 250, 500, 750, 1000, 1250, 500, 0, 1250, 1250];

/** Load, resource isolation and disposal are owned by the scenario executor. */
export function createExtendedRuntimeScenarios(
    manifest: unknown,
    data: Record<string, unknown>,
): RuntimeScenario[] {
    const record = typeof manifest === 'object' && manifest !== null
        ? manifest as Record<string, unknown>
        : {};
    const stepCount = typeof record['stepCount'] === 'number'
        && Number.isInteger(record['stepCount']) && record['stepCount'] >= -1
        ? record['stepCount']
        : 1;
    const modes: RuntimeRenderMode[] = [];
    if (record['supportsRealTime'] === true) modes.push('RT');
    if (record['supportsNonRealTime'] === true) modes.push('NRT');

    const scenarios = modes.map((renderMode): RuntimeScenario => ({
        id: `${renderMode.toLowerCase()}.baseline`,
        label: 'Standard contract checks',
        renderMode,
        kind: 'baseline',
        calls: [],
    }));
    for (const renderMode of modes) {
        scenarios.push(createStepScenario(renderMode, stepCount));
        scenarios.push(createAbsoluteEndScenario(renderMode, stepCount));
        if (renderMode === 'RT') {
            scenarios.push(...createAnimatedScenarios(stepCount, data));
        } else {
            scenarios.push(createNrtScenario(stepCount, data));
        }
    }

    return scenarios;
}

function playCall(
    id: string,
    label: string,
    params: PlayActionParams,
    expectedCurrentStep?: number | null,
): RuntimeScenarioCall {
    return {
        id,
        method: 'playAction',
        label,
        params,
        ...(expectedCurrentStep === undefined ? {} : { expectedCurrentStep }),
    };
}

function createStepScenario(renderMode: RuntimeRenderMode, stepCount: number): RuntimeScenario {
    const id = `${renderMode.toLowerCase()}.steps`;
    const scenario: RuntimeScenario = {
        id,
        label: stepCount === -1 ? 'Dynamic steps (up to three contract probes)' : 'Step navigation',
        renderMode,
        kind: 'calls',
        calls: [],
    };
    if (stepCount === -1) {
        scenario.calls = Array.from({ length: DYNAMIC_PLAY_LIMIT }, (_, index) => ({
            ...playCall(`${id}.play-${index + 1}`, `playAction() probe ${index + 1}`, {
                skipAnimation: true,
            }),
            stopOnEnd: true,
        }));

        return scenario;
    }
    if (!Number.isSafeInteger(stepCount)) {
        scenario.coverageWarning = IMPRECISE_STEP_COVERAGE;
        return scenario;
    }
    scenario.calls.push(playCall(`${id}.initial`, 'playAction() from start', {
        skipAnimation: true,
    }, stepCount === 0 ? null : 0));
    if (stepCount === 0) return scenario;

    if (stepCount > 1) {
        scenario.calls.push(
            playCall(`${id}.next`, 'playAction(delta: 1)', { delta: 1, skipAnimation: true }, 1),
            playCall(`${id}.previous`, 'playAction(delta: -1)', {
                delta: -1, skipAnimation: true,
            }, 0),
        );
    }
    scenario.calls.push(playCall(`${id}.unchanged`, 'playAction(delta: 0)', {
        delta: 0, skipAnimation: true,
    }, 0));
    const targetSteps = stepCount <= MAX_TARGET_STEPS
        ? Array.from({ length: stepCount }, (_, index) => index)
        : [...Array.from({ length: MAX_TARGET_STEPS - 2 }, (_, index) => index),
            stepCount - 2, stepCount - 1];
    for (const target of targetSteps) {
        scenario.calls.push(playCall(`${id}.goto-${target}`, `playAction(goto: ${target})`, {
            goto: target, skipAnimation: true,
        }, target));
    }
    scenario.calls.push(playCall(`${id}.end`, 'playAction(delta: 1) from last step', {
        delta: 1, skipAnimation: true,
    }, null));
    if (stepCount > MAX_TARGET_STEPS) {
        scenario.coverageWarning = `Only ${MAX_TARGET_STEPS} of ${stepCount} target steps are tested; `
            + `${stepCount - MAX_TARGET_STEPS} intermediate steps are not tested.`;
    }

    return scenario;
}

function createAbsoluteEndScenario(
    renderMode: RuntimeRenderMode,
    stepCount: number,
): RuntimeScenario {
    const id = `${renderMode.toLowerCase()}.absolute-end`;

    return {
        id,
        label: 'Direct transition to end',
        renderMode,
        kind: 'calls',
        calls: stepCount > 0 && Number.isSafeInteger(stepCount) ? [playCall(`${id}.goto-end`, `playAction(goto: ${stepCount})`, {
            goto: stepCount, skipAnimation: true,
        }, null)] : [],
        ...(!Number.isSafeInteger(stepCount) ? { coverageWarning: IMPRECISE_STEP_COVERAGE } : {}),
        ...(stepCount <= 0 ? {
            notApplicableReason: stepCount === 0
                ? 'This graphic has no numbered steps; play without a target is tested instead.'
                : 'A dynamic step count has no known absolute end target.',
        } : {}),
    };
}

function createAnimatedScenarios(
    stepCount: number,
    data: Record<string, unknown>,
): RuntimeScenario[] {
    const scenarios: RuntimeScenario[] = [];
    for (let index = 0; index < LIFECYCLE_REPETITIONS; index++) {
        const repeat = index + 1;
        const id = stepCount > 0 ? 'rt.animation-repeat' : `rt.animation-lifecycle-${repeat}`;
        const play = playCall(`${id}.play-${repeat}`, `playAction() animated, cycle ${repeat}`, {
            ...(stepCount > 0 ? { goto: 0 } : {}),
            skipAnimation: false,
        }, stepCount > 0 ? 0 : stepCount === 0 ? null : undefined);
        const update: RuntimeScenarioCall = {
            id: `${id}.update-${repeat}`,
            method: 'updateAction',
            label: `updateAction() animated, cycle ${repeat}`,
            params: { data, skipAnimation: false },
        };
        const stop: RuntimeScenarioCall = {
            id: `${id}.stop-${repeat}`,
            method: 'stopAction',
            label: `stopAction() animated, cycle ${repeat}`,
            params: { skipAnimation: false },
        };
        const calls = (stepCount > 0 ? [play, update, stop] : [update, play, stop])
            .map((call) => ({ ...call, animated: true }));
        const existing = scenarios[0];
        if (stepCount > 0 && existing) {
            existing.calls.push(...calls);
        } else {
            scenarios.push({
                id,
                label: stepCount > 0
                    ? 'Animated lifecycle and repeated use'
                    : `Animated lifecycle ${repeat} (fresh instance)`,
                renderMode: 'RT',
                kind: 'calls',
                calls,
            });
        }
    }

    return scenarios;
}

function createNrtScenario(stepCount: number, data: Record<string, unknown>): RuntimeScenario {
    const id = 'nrt.seeking';
    const schedule: ScheduleEntry[] = [
        { timestamp: 0, action: { type: 'updateAction', params: { data, skipAnimation: true } } },
        {
            timestamp: 250,
            action: {
                type: 'playAction',
                params: { ...(stepCount > 0 ? { goto: 0 } : {}), skipAnimation: true },
            },
        },
        { timestamp: 750, action: { type: 'updateAction', params: { data, skipAnimation: true } } },
        { timestamp: 1000, action: { type: 'stopAction', params: { skipAnimation: true } } },
    ];

    return {
        id,
        label: 'NRT seeking, rewind and schedule replacement',
        renderMode: 'NRT',
        kind: 'calls',
        calls: [
            {
                id: `${id}.schedule`, method: 'setActionsSchedule',
                label: 'setActionsSchedule() with distinct timestamps', params: { schedule },
            },
            ...NRT_SEEK_TIMESTAMPS.map((timestamp, index): RuntimeScenarioCall => ({
                id: `${id}.seek-${index + 1}`,
                method: 'goToTime',
                label: `goToTime(${timestamp})`,
                params: { timestamp },
            })),
            {
                id: `${id}.clear-schedule`, method: 'setActionsSchedule',
                label: 'setActionsSchedule() with empty replacement', params: { schedule: [] },
            },
            {
                id: `${id}.seek-empty`, method: 'goToTime',
                label: 'goToTime(0) after schedule replacement', params: { timestamp: 0 },
            },
        ],
    };
}
