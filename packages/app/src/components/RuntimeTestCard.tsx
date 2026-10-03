import RuntimeEvidence from './RuntimeEvidence.js';
import { explainRuntimeStep } from '../preview/runtime-explanation.js';
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
    diagnoseRuntimeError,
    type RuntimeFailureGroup,
    type RuntimeMode,
} from '../preview/runtime-diagnostics.js';
import { safeSpecReference } from '../readiness/spec-reference.js';
import SpecReferenceLink from './SpecReferenceLink.js';
import RuntimeFindingLinks from './RuntimeFindingLinks.js';
import { isConclusiveRuntimeResult } from '../preview/runtime-suite-state.js';

interface Props {
    result?: RuntimeTestResult;
    phase?: RuntimeTestPhase;
    liveSteps?: RuntimeTestStep[];
    onRerun?: () => void;
    findings: RuntimeFailureGroup[];
}

export default function RuntimeTestCard({ result, phase, liveSteps, onRerun, findings }: Props) {
    if (!result && !phase) return null;
    const failed = result && (!result.passed || result.steps.some((step) => step.status === 'fail'));
    const inconclusive = result && !isConclusiveRuntimeResult(result);
    const status = failed ? 'Failed' : phase === 'pending' ? 'Pending'
        : phase === 'running' ? 'Running' : inconclusive ? 'Inconclusive' : 'Passed';
    const steps = phase ? liveSteps ?? [] : result?.steps ?? [];
    const warnings = steps.filter((step) => step.status === 'warning');
    const checks = steps.filter((step) => step.status === 'pass' || step.status === 'skip');

    return <section aria-label="Standard runtime test"
        className="rounded-sm overflow-hidden bg-ss-surface border border-ss-outline-variant/40">
        <div className="flex flex-wrap justify-between items-center gap-3 px-3 sm:px-4 py-3 border-b border-ss-outline-variant/30">
            <div className="flex items-center gap-2">
                {phase ? <Loader2 size={14} className="animate-spin text-ss-primary-container" />
                    : failed ? <XCircle size={14} className="text-ss-error" />
                        : inconclusive ? <AlertTriangle size={14} className="text-ss-warning" />
                            : <CheckCircle2 size={14} className="text-ss-success" />}
                <h3 className="text-xs font-semibold text-ss-on-surface">Standard Runtime Test</h3>
                <span className={`text-[10px] ${failed ? 'text-ss-error' : 'text-ss-on-surface-variant'}`}>{status}</span>
            </div>
            {!phase && <RerunButton onRerun={onRerun} />}
        </div>
        <div className="px-3 sm:px-4 py-3 space-y-3">
            <p className="text-xs text-ss-on-surface-variant">
                {phase === 'pending' ? 'Waiting to start.' : phase === 'running'
                    ? 'Checking the basic API contracts. Previous findings remain visible.'
                    : `Basic API contracts checked · ${result?.totalDurationMs ?? 0} ms`}
            </p>
            <RuntimeFindingLinks findings={findings} suite="standard" />
            {inconclusive && <p className="text-xs text-ss-warning">
                Not fully tested. Some checks could not be completed.
            </p>}
            {warnings.map((step, index) => <StepRow key={index} step={step} />)}
            {checks.length > 0 && <details>
                <summary className="cursor-pointer text-xs text-ss-on-surface-variant">
                    Passed and skipped checks ({checks.length})
                </summary>
                {checks.map((step, index) => <StepRow key={index} step={step} />)}
            </details>}
        </div>
    </section>;
}

export function FailureDiagnostic({ failure }: { failure: RuntimeFailureGroup }) {
    const modes = uniqueModes(failure);
    const occurrenceLabel = failure.occurrences.length === 1
        ? '1 occurrence'
        : `${failure.occurrences.length} occurrences`;
    const suites = [...new Set(failure.occurrences.map(({ step }) =>
        step.suite === 'extended' ? 'Extended test' : 'Standard test'))];
    const modePrefix = modes.length > 0 ? `${modes.join('/')}: ` : '';
    const contexts = [...new Set(failure.occurrences.map(({ step }) => stepContext(step)).filter(Boolean))];
    const copyText = [
        `${modePrefix}${failure.label}`,
        failure.code,
        failure.error,
        `${occurrenceLabel} · ${suites.join(' · ')}`,
        modes.length > 0 ? `Affected modes: ${modes.join(', ')}` : undefined,
        ...contexts,
        ...failure.occurrences.map(({ step }) => {
            const explanation = explainRuntimeStep(step);
            return `${stepContext(step)}\n${step.name}\n${explanation.expected ? `Expected: ${explanation.expected}\n` : ''}Received: ${explanation.received}\nCall inputs: ${explanation.parameters}`;
        }),
        failure.hint,
        safeSpecReference(failure.specRef),
    ].filter(Boolean).join('\n');

    return (
        <article id={failure.id} tabIndex={-1} aria-label={`${modePrefix}${failure.label} failed`} className="rounded-sm overflow-hidden bg-ss-error/5"
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
                            <span>{suites.join(' · ')}</span>
                        </div>
                        <p className="text-[10px] font-semibold font-mono text-ss-error mt-2 tracking-wide">
                            {failure.code}
                        </p>

                    </div>
                    <button
                        type="button"
                        onClick={() => void navigator.clipboard?.writeText(copyText)}
                        className="inline-flex h-8 w-8 sm:h-auto sm:w-auto items-center justify-center gap-1 sm:px-2 sm:py-1 rounded-sm text-[10px] text-ss-on-surface-variant hover:text-ss-on-surface hover:bg-ss-surface-high transition-colors shrink-0"
                        title="Copy diagnostic, including captured inputs and responses"
                        aria-label="Copy diagnostic"
                    >
                        <Copy size={10} />
                        <span className="hidden sm:inline">Copy</span>
                    </button>
                </div>
                <p title={failure.error} className="mt-2 text-[13px] sm:text-xs leading-relaxed text-ss-error whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {failure.error ?? 'The runtime check failed without an error message.'}
                </p>
                {failure.occurrences[0] && <RuntimeEvidence step={failure.occurrences[0].step} />}
                {failure.occurrences.length > 1 && <p className="mt-1 text-[11px] text-ss-on-surface-variant">
                    First observation shown. Expand calls below to inspect each observation and its inputs.
                </p>}
                {failure.hint && (
                    <div className="mt-3 rounded-sm px-3 sm:px-4 py-3 bg-ss-surface-lowest text-xs leading-relaxed text-ss-on-surface-variant"
                         style={{ border: '1px solid rgba(64, 72, 80, 0.28)' }}>
                        <strong className="text-ss-on-surface font-semibold">How to fix: </strong>
                        {failure.hint}
                    </div>
                )}
                <SpecReferenceLink reference={failure.specRef} />
                <details className="mt-3 text-xs text-ss-on-surface-variant">
                    <summary className="cursor-pointer">Show calls and scenarios ({failure.occurrences.length})</summary>
                    <ul className="mt-2 space-y-2 list-disc pl-4">
                        {failure.occurrences.map(({ step }, index) => <li key={index}>
                            <span className="font-medium">{step.suite === 'extended' ? 'Extended test' : 'Standard test'}</span>
                            {' · '}{step.name} · {step.durationMs} ms
                            <p className="mt-1 [overflow-wrap:anywhere]">{stepContext(step)}</p>
                            <RuntimeEvidence step={step} inputs />
                        </li>)}
                    </ul>
                </details>
            </div>
        </article>
    );
}

function uniqueModes(failure: RuntimeFailureGroup): RuntimeMode[] {
    return [...new Set(failure.occurrences.flatMap(({ mode }) => mode ? [mode] : []))];
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

export function StepRow({ step }: { step: RuntimeTestStep }) {
    const diagnostic = step.status === 'fail' || step.status === 'warning' || step.diagnostic
        ? diagnoseRuntimeError(step.error, step.diagnostic)
        : undefined;
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
                {stepContext(step) && (
                    <p className="text-[10px] mt-1 text-ss-on-surface-variant [overflow-wrap:anywhere]">
                        {stepContext(step)}
                    </p>
                )}
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
                {diagnostic && (
                    <div className="mt-2 text-[11px] leading-relaxed text-ss-on-surface-variant">
                        <code className="font-mono [overflow-wrap:anywhere]">{diagnostic.code}</code>
                        <p className="mt-1"><strong>Next step: </strong>{diagnostic.hint}</p>
                        <SpecReferenceLink reference={diagnostic.specRef} />
                    </div>
                )}
            </div>
        </div>
    );
}

function stepContext(step: RuntimeTestStep): string {
    const context = [step.suite, step.renderMode, step.scenarioId, step.checkId];
    if (step.expectedCurrentStep !== undefined) {
        context.push(`Expected step: ${step.expectedCurrentStep === null ? 'END' : step.expectedCurrentStep}`);
        context.push(`Actual step: ${step.actualCurrentStep === null
            ? 'END' : step.actualCurrentStep ?? 'not reported'}`);
    }

    return context.filter(Boolean).join(' · ');
}
