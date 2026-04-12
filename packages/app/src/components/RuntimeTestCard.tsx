import { CheckCircle2, XCircle, Loader2, MinusCircle, RotateCcw } from 'lucide-react';
import type { RuntimeTestResult, RuntimeTestStep } from '../preview/runtime-test-types.js';

interface Props {
    result?: RuntimeTestResult;
    running?: boolean;
    liveSteps?: RuntimeTestStep[];
    onRerun?: () => void;
}

export default function RuntimeTestCard({ result, running, liveSteps, onRerun }: Props) {
    if (running) {
        return (
            <div className="rounded overflow-hidden bg-ss-surface"
                 style={{ border: '1px solid rgba(64, 72, 80, 0.35)' }}>
                {/* Header */}
                <div className="flex items-center gap-2 px-3 py-2"
                     style={{ borderBottom: liveSteps && liveSteps.length > 0 ? '1px solid rgba(64, 72, 80, 0.2)' : undefined }}>
                    <Loader2 size={14} className="animate-spin text-ss-primary-container flex-shrink-0" />
                    <span className="text-xs text-ss-on-surface-variant">Running runtime test…</span>
                </div>
                {/* Live steps so far */}
                {liveSteps && liveSteps.length > 0 && (
                    <div className="flex flex-col">
                        {liveSteps.map((step, idx) => (
                            <StepRow key={idx} step={step} />
                        ))}
                    </div>
                )}
            </div>
        );
    }

    if (!result) return null;

    return (
        <div className="rounded overflow-hidden bg-ss-surface"
             style={{ border: `1px solid ${result.passed ? 'rgba(40, 175, 98, 0.3)' : 'rgba(204, 86, 98, 0.3)'}` }}>
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2"
                 style={{ borderBottom: '1px solid rgba(64, 72, 80, 0.2)' }}>
                <div className="flex items-center gap-2">
                    {result.passed
                        ? <CheckCircle2 size={14} style={{ color: '#28af62' }} />
                        : <XCircle size={14} style={{ color: '#cc5662' }} />
                    }
                    <span className="text-xs font-semibold text-ss-on-surface">
                        Runtime Test
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-ss-on-surface-variant/60">
                        {result.totalDurationMs.toLocaleString()} ms
                    </span>
                    {onRerun && (
                        <button
                            onClick={onRerun}
                            title="Rerun runtime test"
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-ss-on-surface-variant hover:text-ss-on-surface transition-colors"
                            style={{ border: '1px solid rgba(64, 72, 80, 0.4)' }}
                        >
                            <RotateCcw size={9} />
                            Rerun
                        </button>
                    )}
                </div>
            </div>

            {/* Steps */}
            <div className="flex flex-col">
                {result.steps.map((step, idx) => (
                    <StepRow key={idx} step={step} />
                ))}
            </div>
        </div>
    );
}

function StepRow({ step }: { step: RuntimeTestStep }) {
    const icon = step.status === 'pass'
        ? <CheckCircle2 size={11} style={{ color: '#28af62' }} />
        : step.status === 'fail'
        ? <XCircle size={11} style={{ color: '#cc5662' }} />
        : <MinusCircle size={11} className="text-ss-on-surface-variant/40" />;

    return (
        <div className={`flex items-center gap-2.5 px-3 py-1.5 ${step.status === 'fail' ? 'bg-[#cc566210]' : ''}`}
             style={{ borderBottom: '1px solid rgba(64, 72, 80, 0.1)' }}>
            <span className="flex-shrink-0">{icon}</span>
            <span className={`flex-1 text-[11px] font-mono ${step.status === 'skip' ? 'text-ss-on-surface-variant/40' : 'text-ss-on-surface'}`}>
                {step.name}
            </span>
            {step.status !== 'skip' && (
                <span className="text-[10px] font-mono text-ss-on-surface-variant/50 tabular-nums">
                    {step.durationMs} ms
                </span>
            )}
            {step.error && (
                <span className="text-[10px] text-[#cc5662] truncate max-w-[200px]" title={step.error}>
                    {step.error}
                </span>
            )}
        </div>
    );
}
