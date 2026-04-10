import type { PreviewPhase } from './preview-types.js';

interface Props {
    phase: PreviewPhase;
    renderType: 'realtime' | 'non-realtime';
    supportsRealTime: boolean;
    supportsNonRealTime: boolean;
    currentStep: number | undefined;
    stepCount: number | undefined;
    isMounted: boolean;
    onChangeRenderType: (type: 'realtime' | 'non-realtime') => void;
    onLoad: () => void;
    onDispose: () => void;
    onReload: () => void;
}

export default function PreviewLifecycleBar({
    phase,
    renderType,
    supportsRealTime,
    supportsNonRealTime,
    currentStep,
    stepCount,
    isMounted,
    onChangeRenderType,
    onLoad,
    onDispose,
    onReload,
}: Props) {
    const busy = phase === 'importing' || phase === 'loading';

    return (
        <div className="flex items-center gap-3 flex-wrap">
            {/* Render type selector */}
            <div className="flex items-center gap-2 text-xs">
                <span className="text-ss-text-2 uppercase tracking-wide font-semibold">Type</span>
                <div className="flex rounded-md border border-ss-border overflow-hidden">
                    <RenderTypeButton
                        label="realtime"
                        active={renderType === 'realtime'}
                        disabled={!supportsRealTime}
                        onClick={() => onChangeRenderType('realtime')}
                    />
                    <RenderTypeButton
                        label="non-realtime"
                        active={renderType === 'non-realtime'}
                        disabled={!supportsNonRealTime}
                        onClick={() => onChangeRenderType('non-realtime')}
                    />
                </div>
            </div>

            {/* Step counter */}
            {renderStepCounter(currentStep, stepCount)}

            {/* Lifecycle buttons */}
            <div className="flex gap-2 ml-auto">
                <LifecycleButton label="Load"     disabled={busy || isMounted} onClick={onLoad} />
                <LifecycleButton label="↺ Reload" disabled={busy}              onClick={onReload} />
                <LifecycleButton label="Dispose"  disabled={busy || !isMounted} onClick={onDispose} variant="danger" />
            </div>
        </div>
    );
}

function renderStepCounter(
    currentStep: number | undefined,
    stepCount: number | undefined,
): React.ReactNode {
    if (stepCount === undefined || stepCount === 0) return null;
    const display = stepCount === -1 ? 'dynamic' : String(stepCount);

    return (
        <div className="flex items-center gap-1.5 text-xs">
            <span className="text-ss-text-2 uppercase tracking-wide font-semibold">Step</span>
            <span className="font-mono text-ss-text-1">
                {currentStep ?? 0} <span className="text-ss-text-2">/ {display}</span>
            </span>
        </div>
    );
}

function RenderTypeButton({
    label,
    active,
    disabled,
    onClick,
}: {
    label: string;
    active: boolean;
    disabled: boolean;
    onClick: () => void;
}) {
    const base = 'px-2.5 py-1 text-xs font-medium transition-colors';
    const stateCls = active
        ? 'bg-ss-primary text-ss-text-1'
        : disabled
            ? 'bg-ss-dark-2 text-ss-text-2/40 cursor-not-allowed'
            : 'bg-ss-dark-1 text-ss-text-2 hover:text-ss-text-1';

    return (
        <button disabled={disabled} onClick={onClick} className={`${base} ${stateCls}`}>
            {label}
        </button>
    );
}

function LifecycleButton({
    label,
    disabled,
    onClick,
    variant = 'default',
}: {
    label: string;
    disabled: boolean;
    onClick: () => void;
    variant?: 'default' | 'danger';
}) {
    const variantCls =
        variant === 'danger'
            ? 'bg-ss-error/10 hover:bg-ss-error/20 text-ss-error'
            : 'bg-ss-dark-1 hover:bg-ss-grey text-ss-text-1';

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`px-3 py-1 rounded text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${variantCls}`}
        >
            {label}
        </button>
    );
}

