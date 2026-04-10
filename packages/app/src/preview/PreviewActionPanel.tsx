import { useState } from 'react';
import type { OgrafCustomAction } from '@streamshapers/ograf-validator-core';
import type { PlayActionParams, StopActionParams } from './preview-types.js';

interface Props {
    isMounted: boolean;
    skipAnimationDefault: boolean;
    customActions: OgrafCustomAction[];
    onChangeSkipAnimationDefault: (skip: boolean) => void;
    onPlay: (opts: PlayActionParams) => void;
    onStop: (opts: StopActionParams) => void;
    onUpdate: (opts: { skipAnimation?: boolean }) => void;
    onCustom: (id: string, payload: unknown, opts: { skipAnimation?: boolean }) => void;
}

export default function PreviewActionPanel({
    isMounted,
    skipAnimationDefault,
    customActions,
    onChangeSkipAnimationDefault,
    onPlay,
    onStop,
    onUpdate,
    onCustom,
}: Props) {
    return (
        <section className="rounded-md border border-ss-border overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-ss-dark-1 border-b border-ss-border">
                <span className="text-xs font-semibold uppercase tracking-wide text-ss-text-2">Actions</span>
                <label className="inline-flex items-center gap-1.5 text-xs text-ss-text-2">
                    <input
                        type="checkbox"
                        checked={skipAnimationDefault}
                        onChange={(e) => onChangeSkipAnimationDefault(e.target.checked)}
                        className="accent-ss-primary"
                    />
                    skipAnimation default
                </label>
            </div>

            <div className="p-3 space-y-3 bg-ss-dark-2/40">
                <PlaySection disabled={!isMounted} onPlay={onPlay} />
                <StopSection disabled={!isMounted} onStop={onStop} />
                <UpdateSection disabled={!isMounted} onUpdate={onUpdate} />

                {customActions.length > 0 && (
                    <div className="pt-3 border-t border-ss-border/40 space-y-3">
                        <span className="text-[10px] text-ss-text-2 uppercase tracking-wide font-semibold">
                            Custom Actions
                        </span>
                        {customActions.map((action) => (
                            <CustomActionRow key={action.id} action={action} disabled={!isMounted} onInvoke={onCustom} />
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}

// ─── Play ────────────────────────────────────────────────────────────────────

function PlaySection({
    disabled,
    onPlay,
}: {
    disabled: boolean;
    onPlay: (opts: PlayActionParams) => void;
}) {
    const [delta, setDelta] = useState('1');
    const [goto, setGoto] = useState('');
    const [skipAnimation, setSkipAnimation] = useState<boolean | null>(null);

    const invoke = () => {
        const opts: PlayActionParams = {};
        const d = parseInt(delta, 10);
        if (!Number.isNaN(d)) opts.delta = d;
        if (goto.trim() !== '') {
            const g = parseInt(goto, 10);
            if (!Number.isNaN(g)) opts.goto = g;
        }
        if (skipAnimation !== null) opts.skipAnimation = skipAnimation;
        onPlay(opts);
    };

    return (
        <ActionRow label="▶ Play" disabled={disabled} onInvoke={invoke}>
            <NumberField label="delta" value={delta} onChange={setDelta} width={60} />
            <NumberField label="goto" value={goto} onChange={setGoto} width={60} placeholder="(auto)" />
            <OverrideToggle label="skip" value={skipAnimation} onChange={setSkipAnimation} />
        </ActionRow>
    );
}

// ─── Stop ────────────────────────────────────────────────────────────────────

function StopSection({
    disabled,
    onStop,
}: {
    disabled: boolean;
    onStop: (opts: StopActionParams) => void;
}) {
    const [skipAnimation, setSkipAnimation] = useState<boolean | null>(null);

    const invoke = () => {
        const opts: StopActionParams = {};
        if (skipAnimation !== null) opts.skipAnimation = skipAnimation;
        onStop(opts);
    };

    return (
        <ActionRow label="■ Stop" disabled={disabled} onInvoke={invoke}>
            <OverrideToggle label="skip" value={skipAnimation} onChange={setSkipAnimation} />
        </ActionRow>
    );
}

// ─── Update ──────────────────────────────────────────────────────────────────

function UpdateSection({
    disabled,
    onUpdate,
}: {
    disabled: boolean;
    onUpdate: (opts: { skipAnimation?: boolean }) => void;
}) {
    const [skipAnimation, setSkipAnimation] = useState<boolean | null>(null);

    const invoke = () => {
        const opts: { skipAnimation?: boolean } = {};
        if (skipAnimation !== null) opts.skipAnimation = skipAnimation;
        onUpdate(opts);
    };

    return (
        <ActionRow label="↻ Update" disabled={disabled} onInvoke={invoke}>
            <OverrideToggle label="skip" value={skipAnimation} onChange={setSkipAnimation} />
            <span className="text-[10px] text-ss-text-2/60 ml-auto">sends current data</span>
        </ActionRow>
    );
}

// ─── Custom Action ───────────────────────────────────────────────────────────

function CustomActionRow({
    action,
    disabled,
    onInvoke,
}: {
    action: OgrafCustomAction;
    disabled: boolean;
    onInvoke: (id: string, payload: unknown, opts: { skipAnimation?: boolean }) => void;
}) {
    const [payloadText, setPayloadText] = useState('{}');
    const [payloadError, setPayloadError] = useState<string | null>(null);
    const [skipAnimation, setSkipAnimation] = useState<boolean | null>(null);

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
        const opts: { skipAnimation?: boolean } = {};
        if (skipAnimation !== null) opts.skipAnimation = skipAnimation;
        onInvoke(action.id, payload, opts);
    };

    return (
        <div className="rounded border border-ss-border/60 p-2 space-y-1.5">
            <div className="flex items-center gap-2">
                <span className="text-xs text-ss-text-1 font-semibold">{action.name}</span>
                <span className="text-[10px] text-ss-text-2/60 font-mono">{action.id}</span>
                <button
                    onClick={invoke}
                    disabled={disabled}
                    className="ml-auto px-2 py-0.5 rounded text-xs bg-ss-dark-1 hover:bg-ss-grey text-ss-text-1 disabled:opacity-40 transition-colors"
                >
                    Invoke
                </button>
            </div>
            {action.description && (
                <p className="text-[10px] text-ss-text-2/70">{action.description}</p>
            )}
            <textarea
                rows={2}
                spellCheck={false}
                value={payloadText}
                onChange={(e) => setPayloadText(e.target.value)}
                placeholder="payload JSON"
                className="w-full px-2 py-1 rounded text-xs bg-ss-dark-2 border border-ss-border text-ss-text-1 font-mono focus:outline-none focus:border-ss-primary resize-y"
            />
            {payloadError && <p className="text-[10px] text-ss-error">{payloadError}</p>}
            <OverrideToggle label="skipAnimation" value={skipAnimation} onChange={setSkipAnimation} />
        </div>
    );
}

// ─── Reusable bits ───────────────────────────────────────────────────────────

function ActionRow({
    label,
    disabled,
    onInvoke,
    children,
}: {
    label: string;
    disabled: boolean;
    onInvoke: () => void;
    children: React.ReactNode;
}) {
    return (
        <div className="flex items-center gap-2 flex-wrap">
            <button
                onClick={onInvoke}
                disabled={disabled}
                className="px-3 py-1 rounded text-xs font-semibold bg-ss-dark-1 hover:bg-ss-grey text-ss-text-1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors min-w-[80px]"
            >
                {label}
            </button>
            {children}
        </div>
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
        <label className="inline-flex items-center gap-1 text-[10px] text-ss-text-2">
            {label}
            <input
                type="number"
                value={value}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
                style={{ width }}
                className="px-1.5 py-0.5 rounded bg-ss-dark-2 border border-ss-border text-ss-text-1 font-mono text-xs focus:outline-none focus:border-ss-primary"
            />
        </label>
    );
}

function OverrideToggle({
    label,
    value,
    onChange,
}: {
    label: string;
    value: boolean | null;
    onChange: (next: boolean | null) => void;
}) {
    // Tri-state: null = use default, true = force skip, false = force play
    const next = (): boolean | null => {
        if (value === null) return true;
        if (value === true) return false;

        return null;
    };
    const labelCls =
        value === null
            ? 'text-ss-text-2/60'
            : value
                ? 'text-ss-primary'
                : 'text-ss-text-1';

    return (
        <button
            onClick={() => onChange(next())}
            className={`text-[10px] px-1.5 py-0.5 rounded border border-ss-border/60 hover:border-ss-border ${labelCls}`}
            title="Click to cycle: default → true → false → default"
        >
            {label}: {value === null ? 'default' : value ? 'true' : 'false'}
        </button>
    );
}
