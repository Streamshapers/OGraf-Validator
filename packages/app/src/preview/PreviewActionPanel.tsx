import { useState } from 'react';
import { Play, Square, ArrowLeftRight } from 'lucide-react';
import type { OgrafCustomAction } from '@streamshapers/ograf-validator-core';
import type { PlayActionParams, StopActionParams } from './preview-types.js';

interface Props {
    isMounted: boolean;
    stepCount: number | undefined;
    customActions: OgrafCustomAction[];
    onPlay: (opts: PlayActionParams) => void;
    onStop: (opts: StopActionParams) => void;
    onUpdate: (opts: { skipAnimation?: boolean }) => void;
    onCustom: (id: string, payload: unknown, opts: { skipAnimation?: boolean }) => void;
}

export default function PreviewActionPanel({
    isMounted,
    stepCount,
    customActions,
    onPlay,
    onStop,
    onUpdate,
    onCustom,
}: Props) {
    const [skipAnimation, setSkipAnimation] = useState(false);
    const [delta, setDelta] = useState('1');
    const [goto, setGoto] = useState('');

    const knownSteps = typeof stepCount === 'number' && stepCount > 0 && stepCount !== -1;

    return (
        <div className="flex flex-col gap-2">
            {/* Equal-height action buttons */}
            <div className="grid grid-cols-3 gap-2">
                <BigActionButton icon={<Play size={16} />}   label="Play"   variant="primary" disabled={!isMounted} onClick={() => {
                    const opts: PlayActionParams = { skipAnimation };
                    const d = parseInt(delta, 10);
                    if (!Number.isNaN(d)) opts.delta = d;
                    if (goto !== '') { const g = parseInt(goto, 10); if (!Number.isNaN(g)) opts.goto = g; }
                    onPlay(opts);
                }} />
                <BigActionButton icon={<Square size={16} />}   label="Stop"   variant="surface" disabled={!isMounted} onClick={() => onStop({ skipAnimation })} />
                <BigActionButton icon={<ArrowLeftRight size={16} />} label="Update" variant="surface" disabled={!isMounted} onClick={() => onUpdate({ skipAnimation })} />
            </div>

            {/* Params row */}
            <div className="flex items-center gap-3 flex-wrap pt-1">
                <NumberField label="delta" value={delta} onChange={setDelta} width={48} />
                {knownSteps ? (
                    <GotoSelect value={goto} onChange={setGoto} stepCount={stepCount!} />
                ) : (
                    <NumberField label="goto" value={goto} onChange={setGoto} width={48} placeholder="auto" />
                )}
                <span className="text-ss-on-surface-variant/30 text-xs select-none">·</span>
                <label className="inline-flex items-center gap-1.5 text-xs text-ss-on-surface-variant cursor-pointer select-none ml-auto">
                    <input
                        type="checkbox"
                        checked={skipAnimation}
                        onChange={(e) => setSkipAnimation(e.target.checked)}
                        className="accent-ss-primary"
                    />
                    skip animation
                </label>
            </div>

            {customActions.length > 0 && (
                <div className="pt-2 border-t border-ss-outline-variant/40 space-y-3">
                    <span className="text-[10px] text-ss-on-surface-variant uppercase tracking-wide font-semibold">
                        Custom Actions
                    </span>
                    {customActions.map((action) => (
                        <CustomActionRow key={action.id} action={action} disabled={!isMounted} skipAnimation={skipAnimation} onInvoke={onCustom} />
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Large action buttons ────────────────────────────────────────────────────

function BigActionButton({
    icon,
    label,
    variant,
    disabled,
    onClick,
}: {
    icon: React.ReactNode;
    label: string;
    variant: 'primary' | 'surface';
    disabled: boolean;
    onClick: () => void;
}) {
    const cls = variant === 'primary'
        ? 'bg-ss-primary-container hover:bg-ss-primary-container/80 text-white'
        : 'bg-ss-surface-high hover:bg-ss-surface-highest text-ss-on-surface';

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`flex flex-col items-center justify-center gap-1.5 w-full py-3 rounded text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}
        >
            <span className="text-lg leading-none">{icon}</span>
            <span>{label}</span>
        </button>
    );
}

// ─── Custom Action ───────────────────────────────────────────────────────────

function CustomActionRow({
    action,
    disabled,
    skipAnimation,
    onInvoke,
}: {
    action: OgrafCustomAction;
    disabled: boolean;
    skipAnimation: boolean;
    onInvoke: (id: string, payload: unknown, opts: { skipAnimation?: boolean }) => void;
}) {
    const [payloadText, setPayloadText] = useState('{}');
    const [payloadError, setPayloadError] = useState<string | null>(null);

    const invoke = () => {
        let payload: unknown = {};
        if (payloadText.trim() !== '') {
            try {
                payload = JSON.parse(payloadText);
                setPayloadError(null);
            } catch (e) {
                setPayloadError(e instanceof Error ? e.message : String(e));
                return;
            }
        }
        onInvoke(action.id, payload, { skipAnimation });
    };

    return (
        <div className="rounded border border-ss-outline-variant/40 p-2 space-y-1.5">
            <div className="flex items-center gap-2">
                <span className="text-xs text-ss-on-surface font-semibold">{action.name}</span>
                <span className="text-[10px] text-ss-on-surface-variant/60 font-mono">{action.id}</span>
                <button
                    onClick={invoke}
                    disabled={disabled}
                    className="ml-auto px-2 py-0.5 rounded text-xs bg-ss-surface-high hover:bg-ss-surface-highest text-ss-on-surface disabled:opacity-40 transition-colors"
                >
                    Invoke
                </button>
            </div>
            {action.description && (
                <p className="text-[10px] text-ss-on-surface-variant/70">{action.description}</p>
            )}
            <textarea
                rows={2}
                spellCheck={false}
                value={payloadText}
                onChange={(e) => setPayloadText(e.target.value)}
                placeholder="payload JSON"
                className="w-full px-2 py-1 rounded text-xs bg-ss-surface border border-ss-outline-variant/40 text-ss-on-surface font-mono focus:outline-none focus:border-ss-primary resize-y"
            />
            {payloadError && <p className="text-[10px] text-ss-error">{payloadError}</p>}
        </div>
    );
}

// ─── Reusable bits ───────────────────────────────────────────────────────────

const SELECT_CLS = 'px-1.5 py-0.5 rounded bg-ss-surface border border-ss-outline-variant/40 text-ss-on-surface text-xs focus:outline-none focus:border-ss-primary';

function GotoSelect({ value, onChange, stepCount }: { value: string; onChange: (v: string) => void; stepCount: number }) {
    return (
        <label className="inline-flex items-center gap-1 text-[10px] text-ss-on-surface-variant">
            goto
            <select value={value} onChange={(e) => onChange(e.target.value)} className={SELECT_CLS}>
                <option value="">auto</option>
                {Array.from({ length: stepCount }, (_, i) => (
                    <option key={i} value={String(i)}>{i}</option>
                ))}
            </select>
        </label>
    );
}

function NumberField({
    label,
    value,
    onChange,
    width,
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (next: string) => void;
    width: number;
    placeholder?: string;
}) {
    return (
        <label className="inline-flex items-center gap-1 text-[10px] text-ss-on-surface-variant">
            {label}
            <input
                type="number"
                value={value}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
                style={{ width }}
                className="px-1.5 py-0.5 rounded bg-ss-surface border border-ss-outline-variant/40 text-ss-on-surface font-mono text-xs focus:outline-none focus:border-ss-primary"
            />
        </label>
    );
}

