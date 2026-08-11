import {
    AlertTriangle,
    CheckCircle2,
    Copy,
    Loader2,
    MinusCircle,
    RotateCcw,
    XCircle,
} from 'lucide-react';
import type { RuntimeTestResult, RuntimeTestStep } from '../preview/runtime-test-types.js';
import type { RuntimeTestPhase } from '../readiness/package-readiness.js';
import {
    groupRuntimeFailures,
    type RuntimeFailureGroup,
    type RuntimeMode,
} from '../preview/runtime-diagnostics.js';

interface Props {
    result?: RuntimeTestResult;
    phase?: RuntimeTestPhase;
    liveSteps?: RuntimeTestStep[];
    onRerun?: () => void;
}

export default function RuntimeTestCard({ result, phase, liveSteps, onRerun }: Props) {
    if (phase === 'pending') return <PendingCard />;
    if (phase === 'running') return <RunningCard steps={liveSteps ?? []} />;
    if (!result) return null;

    const failureGroups = groupRuntimeFailures(result.steps);
    const warningSteps = result.steps.filter((step) => step.status === 'warning');
    const passedSteps = result.steps.filter((step) => step.status === 'pass' || step.status === 'skip');

    if (!result.passed) {
        const visibleFailures = failureGroups.length > 0
            ? failureGroups
            : groupRuntimeFailures([{
                name: 'Runtime test',
                status: 'fail' as const,
                durationMs: 0,
                error: 'The runtime test failed without returning a failed check.',
            }]);
        return (
            <FailureCard
                failures={visibleFailures}
                warnings={warningSteps}
                passedSteps={passedSteps}
                totalDurationMs={result.totalDurationMs}
                onRerun={onRerun}
            />
        );
    }

    return (
        <CompletedCard
            result={result}
            warningSteps={warningSteps}
            onRerun={onRerun}
        />
    );
}

function PendingCard() {
    return (
        <div className="rounded-sm bg-ss-surface" style={{ border: '1px solid rgba(75, 161, 226, 0.3)' }}>
            <div className="flex items-center gap-2 px-4 py-3">
                <span className="h-2 w-2 rounded-full bg-ss-primary-container shrink-0" />
                <span className="text-xs font-semibold text-ss-on-surface">Runtime Test</span>
                <span className="text-[10px] text-ss-primary-container">Pending</span>
            </div>
        </div>
    );
}

function RunningCard({ steps }: { steps: RuntimeTestStep[] }) {
    return (
        <div className="rounded-sm overflow-hidden bg-ss-surface"
             style={{ border: '1px solid rgba(75, 161, 226, 0.3)' }}>
            <div className="flex items-center gap-2 px-4 py-3"
                 style={{ borderBottom: steps.length > 0 ? '1px solid rgba(64, 72, 80, 0.2)' : undefined }}>
                <Loader2 size={14} className="animate-spin text-ss-primary-container shrink-0" />
                <span className="text-xs font-semibold text-ss-on-surface">Runtime Test</span>
                <span className="text-[10px] text-ss-primary-container">Running</span>
            </div>
            {steps.length > 0 && (
                <div className="flex flex-col">
                    {steps.map((step, index) => <StepRow key={`${step.name}-${index}`} step={step} />)}
                </div>
            )}
        </div>
    );
}

function FailureCard({
    failures,
    warnings,
    passedSteps,
    totalDurationMs,
    onRerun,
}: {
    failures: RuntimeFailureGroup[];
    warnings: RuntimeTestStep[];
    passedSteps: RuntimeTestStep[];
    totalDurationMs: number;
    onRerun?: () => void;
}) {
    return (
        <section className="rounded-sm overflow-hidden bg-ss-surface"
                 style={{ border: '1px solid rgba(204, 86, 98, 0.45)' }}>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 px-3 sm:px-4 py-3 bg-ss-error/10"
                 style={{ borderBottom: '1px solid rgba(204, 86, 98, 0.28)' }}>
                <div className="flex items-start gap-3 min-w-0">
                    <XCircle size={18} className="text-ss-error shrink-0 mt-0.5" />
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-semibold text-ss-on-surface">Runtime validation failed</h3>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-ss-error bg-ss-error/10 border border-ss-error/30">
                                {failures.length} {failures.length === 1 ? 'issue' : 'issues'}
                            </span>
                        </div>
                        <p className="text-xs text-ss-on-surface-variant mt-1 leading-relaxed">
                            The manifest is valid, but the Graphic did not pass the OGraf runtime checks.
                        </p>
                    </div>
                </div>
                <div className="flex w-full sm:w-auto items-center justify-between sm:justify-end gap-3 shrink-0 pl-7 sm:pl-0">
                    <span className="text-[10px] font-mono text-ss-on-surface-variant/60">
                        {totalDurationMs.toLocaleString()} ms
                    </span>
                    <RerunButton onRerun={onRerun} />
                </div>
            </div>

            <div className="px-3 sm:px-4 py-3 sm:py-4 flex flex-col gap-4">
                <div>
                    <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ss-error mb-2">
                        Runtime issues ({failures.length})
                    </h4>
                    <div className="flex flex-col gap-2">
                        {failures.map((failure, index) => (
                            <FailureDiagnostic key={`${failure.code}-${failure.label}-${index}`} failure={failure} />
                        ))}
                    </div>
                </div>

                {warnings.length > 0 && (
                    <div>
                        <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ss-warning mb-2">
                            Warnings ({warnings.length})
                        </h4>
                        <div className="rounded-sm overflow-hidden border border-ss-warning/20">
                            {warnings.map((step, index) => (
                                <StepRow key={`${step.name}-${index}`} step={step} />
                            ))}
                        </div>
                    </div>
                )}

                {passedSteps.length > 0 && (
                    <details className="rounded-sm bg-ss-surface-lowest"
                             style={{ border: '1px solid rgba(64, 72, 80, 0.25)' }}>
                        <summary className="cursor-pointer select-none px-3 py-2 text-xs text-ss-on-surface-variant hover:text-ss-on-surface transition-colors">
                            Passed and skipped checks ({passedSteps.length})
                        </summary>
                        <div className="flex flex-col" style={{ borderTop: '1px solid rgba(64, 72, 80, 0.2)' }}>
                            {passedSteps.map((step, index) => (
                                <StepRow key={`${step.name}-${index}`} step={step} />
                            ))}
                        </div>
                    </details>
                )}
            </div>
        </section>
    );
}

function FailureDiagnostic({ failure }: { failure: RuntimeFailureGroup }) {
    const modes = uniqueModes(failure);
    const occurrenceLabel = failure.occurrences.length === 1
        ? '1 occurrence'
        : `${failure.occurrences.length} occurrences`;
    const durationLabel = failure.occurrences.map(({ mode, step }) => (
        `${mode ? `${mode} ` : ''}${step.durationMs} ms`
    )).join(' · ');
    const modePrefix = modes.length > 0 ? `${modes.join('/')}: ` : '';
    const copyText = [
        `${modePrefix}${failure.label}`,
        failure.code,
        failure.error,
        modes.length > 0 ? `Affected modes: ${modes.join(', ')}` : undefined,
        failure.hint,
    ].filter(Boolean).join('\n');

    return (
        <article aria-label={`${modePrefix}${failure.label} failed`} className="rounded-sm overflow-hidden bg-ss-error/5"
                 style={{ border: '1px solid rgba(204, 86, 98, 0.3)', borderLeft: '3px solid #cc5662' }}>
            <div className="p-3 sm:p-4">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            {modes.map((mode) => (
                                <span key={mode} className="px-1.5 py-0.5 rounded-sm text-[9px] font-bold font-mono text-ss-error bg-ss-error/10 border border-ss-error/25">
                                    {mode}
                                </span>
                            ))}
                            <code className="text-xs font-semibold font-mono text-ss-on-surface [overflow-wrap:anywhere]">{failure.label}</code>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[10px] font-mono text-ss-on-surface-variant/50">
                            <span>{occurrenceLabel}</span>
                            <span>{durationLabel}</span>
                        </div>
                        <p className="text-[10px] font-semibold font-mono text-ss-error mt-2 tracking-wide">
                            {failure.code}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void navigator.clipboard?.writeText(copyText)}
                        className="inline-flex h-8 w-8 sm:h-auto sm:w-auto items-center justify-center gap-1 sm:px-2 sm:py-1 rounded-sm text-[10px] text-ss-on-surface-variant hover:text-ss-on-surface hover:bg-ss-surface-high transition-colors shrink-0"
                        title="Copy diagnostic"
                        aria-label="Copy diagnostic"
                    >
                        <Copy size={10} />
                        <span className="hidden sm:inline">Copy</span>
                    </button>
                </div>
                <p title={failure.error} className="mt-2 text-[13px] sm:text-xs leading-relaxed text-ss-error whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {failure.error ?? 'The runtime check failed without an error message.'}
                </p>
                {failure.hint && (
                    <div className="mt-3 rounded-sm px-3 sm:px-4 py-3 bg-ss-surface-lowest text-xs leading-relaxed text-ss-on-surface-variant"
                         style={{ border: '1px solid rgba(64, 72, 80, 0.28)' }}>
                        <strong className="text-ss-on-surface font-semibold">How to fix: </strong>
                        {failure.hint}
                    </div>
                )}
            </div>
        </article>
    );
}

function uniqueModes(failure: RuntimeFailureGroup): RuntimeMode[] {
    return [...new Set(failure.occurrences.flatMap(({ mode }) => mode ? [mode] : []))];
}

function CompletedCard({
    result,
    warningSteps,
    onRerun,
}: {
    result: RuntimeTestResult;
    warningSteps: RuntimeTestStep[];
    onRerun?: () => void;
}) {
    const inconclusive = result.inconclusive || warningSteps.length > 0;
    return (
        <section className="rounded-sm overflow-hidden bg-ss-surface"
                 style={{ border: `1px solid ${inconclusive ? 'rgba(217, 164, 65, 0.35)' : 'rgba(40, 175, 98, 0.3)'}` }}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 sm:px-4 py-2.5"
                 style={{ borderBottom: '1px solid rgba(64, 72, 80, 0.2)' }}>
                <div className="flex items-center gap-2">
                    {inconclusive
                        ? <AlertTriangle size={14} className="text-ss-warning" />
                        : <CheckCircle2 size={14} className="text-ss-success" />}
                    <span className="text-xs font-semibold text-ss-on-surface">Runtime Test</span>
                    <span className={`text-[10px] ${inconclusive ? 'text-ss-warning' : 'text-ss-success'}`}>
                        {inconclusive ? 'Inconclusive' : 'Passed'}
                    </span>
                </div>
                <div className="flex w-full sm:w-auto items-center justify-between sm:justify-end gap-3 pl-5 sm:pl-0">
                    <span className="text-[10px] font-mono text-ss-on-surface-variant/60">
                        {result.totalDurationMs.toLocaleString()} ms
                    </span>
                    <RerunButton onRerun={onRerun} />
                </div>
            </div>
            <div className="flex flex-col">
                {result.steps.map((step, index) => (
                    <StepRow key={`${step.name}-${index}`} step={step} />
                ))}
            </div>
        </section>
    );
}

function RerunButton({ onRerun }: { onRerun?: () => void }) {
    if (!onRerun) return null;
    return (
        <button
            type="button"
            onClick={onRerun}
            title="Rerun runtime test"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[10px] font-medium text-ss-on-surface-variant hover:text-ss-on-surface hover:bg-ss-surface-high transition-colors"
            style={{ border: '1px solid rgba(64, 72, 80, 0.4)' }}
        >
            <RotateCcw size={10} />
            Rerun
        </button>
    );
}

function StepRow({ step }: { step: RuntimeTestStep }) {
    const icon = step.status === 'pass'
        ? <CheckCircle2 size={11} className="text-ss-success" />
        : step.status === 'fail'
            ? <XCircle size={11} className="text-ss-error" />
            : step.status === 'warning'
                ? <AlertTriangle size={11} className="text-ss-warning" />
                : <MinusCircle size={11} className="text-ss-on-surface-variant/40" />;

    return (
        <div className={`flex items-start gap-2.5 px-3 py-2 ${
            step.status === 'fail' ? 'bg-ss-error/5' : step.status === 'warning' ? 'bg-ss-warning/5' : ''
        }`} style={{ borderBottom: '1px solid rgba(64, 72, 80, 0.1)' }}>
            <span className="shrink-0 mt-0.5">{icon}</span>
            <div className="flex-1 min-w-0">
                <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                    <span className={`text-[11px] font-mono [overflow-wrap:anywhere] ${
                        step.status === 'skip' ? 'text-ss-on-surface-variant/50' : 'text-ss-on-surface'
                    }`}>
                        {step.name}
                    </span>
                    {step.status !== 'skip' && (
                        <span className="text-[10px] font-mono text-ss-on-surface-variant/50 tabular-nums shrink-0">
                            {step.durationMs} ms
                        </span>
                    )}
                </div>
                {step.error && (
                    <p className={`text-[11px] leading-relaxed mt-1 whitespace-pre-wrap break-words ${
                        step.status === 'warning'
                            ? 'text-ss-warning'
                            : step.status === 'skip'
                                ? 'text-ss-on-surface-variant/60'
                                : 'text-ss-error'
                    }`}>
                        {step.error}
                    </p>
                )}
            </div>
        </div>
    );
}
