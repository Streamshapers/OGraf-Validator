import type { PreviewPhase } from './preview-types.js';

interface Props {
    phase: PreviewPhase;
    renderType: 'realtime' | 'non-realtime';
    supportsRealTime: boolean;
    supportsNonRealTime: boolean;
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
    isMounted,
    onChangeRenderType,
    onLoad,
    onDispose,
    onReload,
}: Props) {
    const busy = phase === 'importing' || phase === 'loading';

    return (
        <div className="flex items-center gap-3 w-full overflow-hidden">
            {/* Render type selector */}
            <div className="flex items-center gap-2 text-xs">
                <div className="flex rounded-md border border-ss-outline-variant/40 overflow-hidden">
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


            {/* Lifecycle buttons */}
            <div className="flex gap-2 ml-auto">
                <LifecycleButton label="Load"     disabled={busy || isMounted} onClick={onLoad} />
                <LifecycleButton label="↺ Reload" disabled={busy}              onClick={onReload} />
                <LifecycleButton label="Dispose"  disabled={busy || !isMounted} onClick={onDispose} variant="danger" />
            </div>
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
        ? 'bg-ss-surface-highest text-ss-on-surface font-semibold'
        : disabled
            ? 'bg-ss-surface text-ss-on-surface-variant/40 cursor-not-allowed'
            : 'bg-ss-surface-high text-ss-on-surface-variant hover:text-ss-on-surface';

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
            : 'bg-ss-surface-high hover:bg-ss-surface-highest text-ss-on-surface';

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`px-3 py-1 rounded-sm text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${variantCls}`}
        >
            {label}
        </button>
    );
}

