import { AlertTriangle, CheckCircle2, Loader2, Play, XCircle } from 'lucide-react';
import type {
    RuntimeBudgetMinutes,
    RuntimeSuiteState,
    RuntimeTestResult,
    RuntimeTestStep,
} from '../preview/runtime-test-types.js';
import { getRuntimeSuiteResult, isConclusiveRuntimeResult } from '../preview/runtime-suite-state.js';
import { groupRuntimeFailures, type RuntimeFailureGroup } from '../preview/runtime-diagnostics.js';
import { StepRow } from './RuntimeTestCard.js';

import RuntimeFindingLinks from './RuntimeFindingLinks.js';

interface Props {
    findings: RuntimeFailureGroup[];
    state?: RuntimeSuiteState;
    onRun?: (budgetMinutes: RuntimeBudgetMinutes) => void;
    onCancel?: () => void;
}

const BUTTON_CLASS = 'inline-flex items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 '
    + 'text-xs font-medium bg-ss-surface-high hover:bg-ss-surface-highest '
    + 'text-ss-on-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors';

export default function ExtendedRuntimeTestCard({ state, onRun, onCancel, findings }: Props) {
    const active = state?.active;
    const result = getRuntimeSuiteResult(state);
    const latest = state?.latestAttempt;
    const failures = groupRuntimeFailures(result?.steps ?? []);
    const failed = result && (!result.passed || failures.length > 0);
    const inconclusive = result && !isConclusiveRuntimeResult(result);
    const status = failed ? 'Failed'
        : active ? active.phase === 'pending' ? 'Pending'
            : active.phase === 'cancelling' ? 'Cancelling' : 'Running'
            : inconclusive ? 'Inconclusive' : result ? 'Passed' : 'Not run';
    const tone = failed ? 'text-ss-error'
        : active ? 'text-ss-primary-container'
            : inconclusive ? 'text-ss-warning' : result ? 'text-ss-success' : 'text-ss-on-surface-variant';
    const progress = active?.progress;
    const retryBudgets = availableRetryBudgets(latest);
    const otherSteps = result?.steps.filter((step) => step.status !== 'fail' && step.diagnostic?.code !== 'RESOURCE_LOAD_FAILED') ?? [];

    return (
        <section aria-label="Extended runtime test" className="rounded-sm overflow-hidden bg-ss-surface border border-ss-outline-variant/40">
            <div className="flex flex-wrap items-start justify-between gap-3 px-3 sm:px-4 py-3 border-b border-ss-outline-variant/30">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        {failed ? <XCircle size={15} className={tone} />
                            : active ? <Loader2 size={15} className={`${tone} animate-spin`} />
                                : inconclusive ? <AlertTriangle size={15} className={tone} />
                                    : result ? <CheckCircle2 size={15} className={tone} />
                                        : <Play size={15} className={tone} />}
                        <h3 className="text-xs font-semibold text-ss-on-surface">Extended Runtime Test</h3>
                        <span className={`text-[10px] font-semibold ${tone}`}>{status}</span>
                    </div>
                    <p className="mt-1 text-xs text-ss-on-surface-variant">
                        Step navigation, animations, repeated playback and NRT seeking.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {active ? (
                        <button type="button" className={BUTTON_CLASS} onClick={onCancel}
                            disabled={!onCancel || active.phase === 'cancelling'}>
                            {active.phase === 'cancelling' ? 'Cancelling…' : 'Cancel'}
                        </button>
                    ) : (
                        <>
                            <button type="button" className={BUTTON_CLASS} onClick={() => onRun?.(2)} disabled={!onRun}>
                                {latest || state?.lastCompleted ? 'Rerun extended tests' : 'Run extended tests'}
                            </button>
                            {retryBudgets.map((budget) => (
                                <button key={budget} type="button" className={BUTTON_CLASS}
                                    onClick={() => onRun?.(budget)} disabled={!onRun}>
                                    Retry with {budget} minutes
                                </button>
                            ))}
                        </>
                    )}
                </div>
            </div>
            <div className="px-3 sm:px-4 py-3 space-y-3">
                <p className="text-[11px] text-ss-on-surface-variant">
                    {active ? `Current budget: ${active.budgetMinutes} minutes.`
                        : latest?.budgetMinutes ? `Last budget: ${latest.budgetMinutes} minutes. New runs use 2 minutes.`
                            : 'Optional test. Default budget: 2 minutes.'}
                    {' '}These are validator time limits, not OGraf requirements.
                </p>
                {active && (
                    <div role="status" aria-label="Extended test progress" className="text-xs text-ss-primary-container space-y-1">
                        <p>{active.phase === 'pending' ? 'Waiting to start.'
                            : active.phase === 'cancelling' ? 'Cancelling and cleaning up.'
                                : progress ? `${progress.completedScenarios}/${progress.totalScenarios} scenarios completed`
                                    : 'Starting extended checks.'}</p>
                        {progress && <p>{[progress.renderMode, progress.scenarioLabel, progress.currentCheck].filter(Boolean).join(' · ')}</p>}
                    </div>
                )}
                {latest?.outcome && latest.outcome !== 'completed' && (
                    <p className="text-xs text-ss-warning">
                        {latest.outcome === 'cancelled' ? 'The last attempt was cancelled.' : 'The last attempt exhausted its time budget.'}
                        {' '}Remaining checks were not completed.
                    </p>
                )}
                {(active && result || state?.retainedFailures?.some((step) => step.runId !== latest?.runId)) && (
                    <p className="text-xs text-ss-on-surface-variant">
                        Previous findings remain visible until a complete, conclusive replacement test finishes.
                    </p>
                )}
                <RuntimeFindingLinks findings={findings} suite="extended" />
                {inconclusive && <p className="text-xs text-ss-warning">
                    Not fully tested. See scenario coverage for checks that could not be completed.
                </p>}
                <ScenarioCoverage result={latest ?? state?.lastCompleted} />
                {active && active.steps.length > 0 && (
                    <GroupedSteps title="Current attempt checks" steps={active.steps.filter((step) => step.status !== 'fail' && step.diagnostic?.code !== 'RESOURCE_LOAD_FAILED')} />
                )}
                {otherSteps.length > 0 && <GroupedSteps title="Completed attempt checks" steps={otherSteps} />}
                <p className="text-[11px] text-ss-on-surface-variant/70">
                    Checks cover API contracts and observed runtime errors. Visual correctness is not tested.
                </p>
            </div>
        </section>
    );
}

function ScenarioCoverage({ result }: { result?: RuntimeTestResult }) {
    if (!result?.scenarios?.length) return null;

    return (
        <details className="overflow-x-auto">
            <summary className="cursor-pointer text-xs text-ss-on-surface-variant mb-2">Scenario coverage</summary>
            <table aria-label="Extended scenario coverage" className="w-full text-left text-[11px]">
                <thead className="text-ss-on-surface-variant"><tr>
                    <th className="py-2 pr-3">Mode</th><th className="pr-3">Scenario</th>
                    <th className="pr-3">Status</th><th>Checks</th>
                </tr></thead>
                <tbody>{result.scenarios.map((scenario) => (
                    <tr key={`${scenario.renderMode}-${scenario.id}`} className="border-t border-ss-outline-variant/20 text-ss-on-surface">
                        <td className="py-2 pr-3 align-top font-mono">{scenario.renderMode}</td>
                        <td className="pr-3 py-2">{scenario.label}
                            {scenario.reason && <p className="mt-1 text-ss-on-surface-variant">{scenario.reason}</p>}
                        </td>
                        <td className="pr-3 align-top py-2">{scenario.status}</td>
                        <td className="align-top py-2 whitespace-nowrap">{scenario.executedChecks}/{scenario.plannedChecks}</td>
                    </tr>
                ))}</tbody>
            </table>
            <p className="text-[10px] text-ss-on-surface-variant mt-1">Checks executed / planned; not-applicable scenarios are separate from untested scenarios.</p>
        </details>
    );
}

function GroupedSteps({ title, steps }: { title: string; steps: RuntimeTestStep[] }) {
    return (
        <details className="rounded-sm border border-ss-outline-variant/30">
            <summary className="cursor-pointer px-3 py-2 text-xs text-ss-on-surface-variant">
                {title} ({steps.length})
            </summary>
            {(['RT', 'NRT', undefined] as const).map((mode) => {
                const group = steps.filter((step) => (
                    step.renderMode ?? step.name.match(/^(RT|NRT):/)?.[1]
                ) === mode);
                if (group.length === 0) return null;

                return <div key={mode ?? 'other'}>
                    <p className="px-3 py-1 text-[10px] font-semibold text-ss-on-surface-variant">{mode ?? 'Other checks'}</p>
                    {group.map((step, index) => <StepRow key={`${step.name}-${index}`} step={step} />)}
                </div>;
            })}
        </details>
    );
}

function availableRetryBudgets(result: RuntimeTestResult | undefined): RuntimeBudgetMinutes[] {
    if (!result || !(result.outcome === 'budget-exhausted'
        || result.steps.some((step) => step.diagnostic?.code === 'RUNTIME_TIMEOUT'))) return [];

    return ([5, 10] as const).filter((budget) => budget > (result.budgetMinutes ?? 2));
}
