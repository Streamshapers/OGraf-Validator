import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
    RuntimeBudgetMinutes,
    RuntimeSuiteState,
    RuntimeTestResult,
} from '../../preview/runtime-test-types.js';
import { completeRuntimeSuite, startRuntimeSuite } from '../../preview/runtime-suite-state.js';
import RuntimeFindings from '../RuntimeFindings.js';
import { getRuntimeFindings } from '../../preview/runtime-findings.js';
import ExtendedRuntimeTestCard from '../ExtendedRuntimeTestCard.js';

function renderCard(state?: RuntimeSuiteState): string {
    return renderToStaticMarkup(
        <><RuntimeFindings findings={getRuntimeFindings(undefined, state)} />
            <ExtendedRuntimeTestCard findings={getRuntimeFindings(undefined, state)}
                state={state} onRun={vi.fn()} onCancel={vi.fn()} /></>,
    );
}

function buttonLabels(html: string): string[] {
    return [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)]
        .map((match) => [...match[1]!.matchAll(/(?:^|>)([^<>]+)(?=<|$)/g)]
            .map((text) => text[1]).join('').trim());
}

function completed(overrides: Partial<RuntimeTestResult> = {}): RuntimeSuiteState {
    return completeRuntimeSuite(undefined, {
        suite: 'extended', passed: true, steps: [], totalDurationMs: 1,
        budgetMinutes: 2, outcome: 'completed', ...overrides,
    });
}

function timedOut(budgetMinutes: RuntimeBudgetMinutes): RuntimeSuiteState {
    return completed({
        budgetMinutes, inconclusive: true,
        steps: [{ name: 'RT: animated play', status: 'warning', durationMs: 30_000,
            diagnostic: { code: 'RUNTIME_TIMEOUT', method: 'playAction' } }],
    });
}

describe('extended runtime test controls', () => {
    it('offers the default run without elevated budgets before the first attempt', () => {
        const html = renderCard();
        expect(buttonLabels(html)).toEqual(['Run extended tests']);
        expect(html).toContain('Default budget: 2 minutes.');
        expect(html).not.toContain('Retry with');
    });

    it.each([
        ['passing', {}],
        ['cancelled', { outcome: 'cancelled' as const, inconclusive: true }],
        ['environment limitation', { inconclusive: true, steps: [{ name: 'Engine',
            status: 'warning' as const, durationMs: 0,
            diagnostic: { code: 'PREVIEW_LIMITATION' as const } }] }],
    ])('offers no elevated budgets after a %s attempt', (_name, overrides) => {
        expect(buttonLabels(renderCard(completed(overrides))))
            .toEqual(['Rerun extended tests']);
    });

    it.each([
        [2, ['Retry with 5 minutes', 'Retry with 10 minutes']],
        [5, ['Retry with 10 minutes']],
        [10, []],
    ] as const)('offers only larger budgets after a %i-minute timeout', (budget, retries) => {
        expect(buttonLabels(renderCard(timedOut(budget))))
            .toEqual(['Rerun extended tests', ...retries]);
    });

    it('offers larger budgets after exhaustion even without an individual call timeout', () => {
        const html = renderCard(completed({ outcome: 'budget-exhausted', inconclusive: true }));
        expect(buttonLabels(html)).toEqual([
            'Rerun extended tests', 'Retry with 5 minutes', 'Retry with 10 minutes',
        ]);
        expect(html).toContain('The last attempt exhausted its time budget.');
    });

    it.each(['pending', 'running'] as const)(
        'replaces all start and retry controls with Cancel while %s', (phase) => {
            const state = startRuntimeSuite(timedOut(2), {
                runId: 'retry', phase, budgetMinutes: 5, steps: [],
            });
            expect(buttonLabels(renderCard(state))).toEqual(['Cancel']);
        },
    );

    it('disables the cancellation button while cleanup is in progress', () => {
        const html = renderCard(startRuntimeSuite(timedOut(2), {
            runId: 'retry', phase: 'cancelling', budgetMinutes: 5, steps: [],
        }));
        expect(buttonLabels(html)).toEqual(['Cancelling…']);
        expect(html).toMatch(/<button\b[^>]*disabled=""[^>]*>Cancelling…<\/button>/);
        expect(html).toContain('Cancelling and cleaning up.');
    });
});

describe('extended runtime test evidence', () => {
    it('shows prior failures, specification guidance and step expectations during a retry', () => {
        const failure = completed({
            passed: false,
            steps: [{
                name: 'RT: playAction(goto: end)', status: 'fail', durationMs: 4,
                error: 'Expected the end state, but the Graphic reported step 2.',
                suite: 'extended', renderMode: 'RT', scenarioId: 'rt.steps', checkId: 'goto-end',
                expectedCurrentStep: null, actualCurrentStep: 2,
                diagnostic: { code: 'CURRENT_STEP_MISMATCH', method: 'playAction' },
            }],
        });
        const state = startRuntimeSuite(failure, {
            runId: 'retry', phase: 'running', budgetMinutes: 5, steps: [],
            progress: { completedScenarios: 1, totalScenarios: 4,
                renderMode: 'NRT', scenarioLabel: 'Timeline seeking', currentCheck: 'goToTime(1000)' },
        });
        const html = renderCard(state);

        expect(buttonLabels(html)).toEqual(['Copy', 'Cancel']);
        expect(html).toContain('>Failed</span>');
        expect(html).toContain('Previous findings remain visible');
        expect(html).toContain('Expected the end state, but the Graphic reported step 2.');
        expect(html).toContain('Expected step: END');
        expect(html).toContain('Actual step: 2');
        expect(html).toContain('rt.steps');
        expect(html).toContain('goto-end');
        expect(html).toContain('CURRENT_STEP_MISMATCH');
        expect(html).toContain('currentStep: undefined');
        expect(html).toContain('href="https://ograf.ebu.io/v1/specification/docs/Specification.html#playaction"');
        expect(html).toContain('1/4 scenarios completed');
        expect(html).toContain('NRT · Timeline seeking · goToTime(1000)');
        expect(html).toContain('aria-label="Extended test progress"');
    });

    it('keeps untested and not-applicable scenarios distinct in the visible coverage', () => {
        const html = renderCard(completed({
            inconclusive: true,
            scenarios: [
                { id: 'rt.animation', label: 'Animated actions', renderMode: 'RT',
                    status: 'not-run', reason: 'Budget exhausted', plannedChecks: 6, executedChecks: 0 },
                { id: 'nrt.seek', label: 'Timeline seeking', renderMode: 'NRT',
                    status: 'not-applicable', reason: 'NRT is not declared',
                    plannedChecks: 0, executedChecks: 0 },
            ],
        }));

        expect(html).toContain('aria-label="Extended scenario coverage"');
        expect(html).toContain('not-run');
        expect(html).toContain('not-applicable');
        expect(html).toContain('Budget exhausted');
        expect(html).toContain('NRT is not declared');
        expect(html).toContain('0/6');
        expect(html).toContain('Visual correctness is not tested.');
    });
});
