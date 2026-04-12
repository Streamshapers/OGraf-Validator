import { useState } from 'react';
import { RotateCw, Check, Lock, Minus, Plus, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import type { AppSettings } from '../settings/types.js';

interface Props {
    settings: AppSettings;
    onUpdateSettings: (patch: Partial<AppSettings>) => void;
    onResetSW: () => Promise<void>;
    onClose: () => void;
}

export default function SettingsPanel({ settings, onUpdateSettings, onResetSW, onClose }: Props) {
    return (
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden bg-ss-surface-dim">
            {/* Header */}
            <div className="flex-shrink-0 px-6 py-5 bg-ss-surface-dim" style={{ borderBottom: '1px solid var(--ss-border-subtle)' }}>
                <div className="max-w-2xl mx-auto flex items-start justify-between">
                    <div>
                        <h2 className="text-base font-semibold text-ss-on-surface">Settings</h2>
                        <p className="text-xs text-ss-on-surface-variant mt-0.5">Configure your local validation environment and UI preferences.</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="ml-4 p-1 rounded text-ss-on-surface-variant hover:text-ss-on-surface hover:bg-ss-surface-high transition-colors"
                        title="Close settings"
                    >
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 pb-8 pt-6">
                <div className="max-w-2xl mx-auto space-y-6">
                    {/* ── General ────────────────────────────────────── */}
                    <SectionHeader>General</SectionHeader>

                    <SettingRow
                        label="Theme"
                        description="UI color scheme. Only dark mode is currently supported."
                    >
                        <SegmentGroup
                            options={[
                                { value: 'dark', label: 'Dark' },
                                { value: 'light', label: 'Light' },
                                { value: 'system', label: 'System' },
                            ]}
                            value={settings.theme}
                            onChange={(v) => onUpdateSettings({ theme: v as AppSettings['theme'] })}
                        />
                    </SettingRow>

                    <SettingRow
                        label="Scan Depth"
                        description="How many directory levels deep the package scanner should search (1–20)."
                    >
                        <NumberStepper
                            value={settings.scanDepth}
                            min={1}
                            max={20}
                            onChange={(v) => onUpdateSettings({ scanDepth: v })}
                        />
                    </SettingRow>

                    <SettingRow
                        label="Preview Service Worker"
                        description="Force re-register the preview Service Worker if the live preview gets stuck."
                    >
                        <ResetSWButton onReset={onResetSW} />
                    </SettingRow>

                    {/* ── Validation & Export ─────────────────────────── */}
                    <SectionHeader>Validation &amp; Export</SectionHeader>

                    <SettingRow
                        label="Severity Filter"
                        description="Choose which issue severities to display. Errors are always shown."
                    >
                        <div className="flex flex-col gap-2">
                            <SeverityToggle severity="error" label="Errors" checked disabled />
                            <SeverityToggle
                                severity="warning"
                                label="Warnings"
                                checked={!settings.hiddenSeverities.includes('warning')}
                                onChange={(show) =>
                                    onUpdateSettings({
                                        hiddenSeverities: show
                                            ? settings.hiddenSeverities.filter((s) => s !== 'warning')
                                            : [...settings.hiddenSeverities.filter((s) => s !== 'warning'), 'warning'],
                                    })
                                }
                            />
                            <SeverityToggle
                                severity="info"
                                label="Infos"
                                checked={!settings.hiddenSeverities.includes('info')}
                                onChange={(show) =>
                                    onUpdateSettings({
                                        hiddenSeverities: show
                                            ? settings.hiddenSeverities.filter((s) => s !== 'info')
                                            : [...settings.hiddenSeverities.filter((s) => s !== 'info'), 'info'],
                                    })
                                }
                            />
                        </div>
                    </SettingRow>

                    <SettingRow
                        label="Auto-Revalidate"
                        description="Automatically re-run validation when source files change. Polls for file modifications at the selected interval."
                    >
                        <div className="flex items-center gap-3">
                            <ToggleSwitch
                                checked={settings.autoRevalidate}
                                onChange={(v) => onUpdateSettings({ autoRevalidate: v })}
                            />
                            <SegmentGroup
                                options={[
                                    { value: '2', label: '2s' },
                                    { value: '5', label: '5s' },
                                    { value: '10', label: '10s' },
                                ]}
                                value={String(settings.revalidateInterval)}
                                onChange={(v) => onUpdateSettings({ revalidateInterval: Number(v) as 2 | 5 | 10 })}
                                disabled={!settings.autoRevalidate}
                            />
                        </div>
                    </SettingRow>

                    {/* ── Workspace Sync ───────────────────────────────── */}
                    <WorkspaceSyncCard />
                </div>
            </div>
        </main>
    );
}

// ─── Primitives ──────────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
    return (
        <h3
            className="text-[10px] font-semibold uppercase tracking-[0.08em] pt-2"
            style={{ color: '#4ba1e2' }}
        >
            {children}
        </h3>
    );
}

function SettingRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-6 rounded px-4 py-3.5 bg-ss-surface"
             style={{ border: '1px solid var(--ss-border-subtle)' }}>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ss-on-surface">{label}</p>
                <p className="text-xs text-ss-on-surface-variant mt-0.5 leading-relaxed">{description}</p>
            </div>
            <div className="flex-shrink-0 flex items-center">
                {children}
            </div>
        </div>
    );
}


function WorkspaceSyncCard() {
    return (
        <div
            className="rounded px-4 py-3.5 bg-ss-surface flex items-start gap-3"
            style={{
                border: '1px solid var(--ss-border-subtle)',
                borderLeft: '3px solid #4ba1e2',
            }}
        >
            <Info size={16} className="flex-shrink-0 mt-0.5" style={{ color: '#4ba1e2' }} />
            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ss-on-surface">Workspace Sync</p>
                <p className="text-xs text-ss-on-surface-variant mt-0.5 leading-relaxed">
                    All settings are stored locally in your browser's <span className="font-mono text-ss-on-surface">localStorage</span>.
                    They persist across sessions but are not synced between devices or browsers.
                </p>
            </div>
        </div>
    );
}

// ─── Controls ────────────────────────────────────────────────────────────────

interface SegmentOption {
    value: string;
    label: string;
    disabled?: boolean;
}

function SegmentGroup({ options, value, onChange, disabled: groupDisabled }: { options: SegmentOption[]; value: string; onChange: (v: string) => void; disabled?: boolean }) {
    return (
        <div className={`flex rounded overflow-hidden transition-opacity ${groupDisabled ? 'opacity-40' : ''}`} style={{ border: '1px solid var(--ss-border-subtle)' }}>
            {options.map((opt) => {
                const active = opt.value === value;
                const disabled = groupDisabled || (opt.disabled ?? false);
                return (
                    <button
                        key={opt.value}
                        onClick={() => !disabled && onChange(opt.value)}
                        disabled={disabled}
                        style={active ? { backgroundColor: '#4ba1e2', color: '#ffffff' } : undefined}
                        className={`px-3 py-1.5 text-xs font-medium transition-colors relative
                            ${active
                                ? ''
                                : 'bg-ss-surface-high text-ss-on-surface-variant hover:text-ss-on-surface'}
                            ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                        `}
                    >
                        {opt.label}
                        {disabled && (
                            <Lock size={8} className="absolute top-1 right-1 text-ss-on-surface-variant/40" />
                        )}
                    </button>
                );
            })}
        </div>
    );
}

function NumberStepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
    return (
        <div className="flex items-center rounded overflow-hidden" style={{ border: '1px solid var(--ss-border-subtle)' }}>
            <button
                onClick={() => value > min && onChange(value - 1)}
                disabled={value <= min}
                className="px-2 py-1.5 bg-ss-surface-high text-ss-on-surface-variant hover:text-ss-on-surface hover:bg-ss-surface-highest transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
                <Minus size={14} />
            </button>
            <span className="px-3 py-1.5 text-sm font-mono text-ss-on-surface bg-ss-surface min-w-[40px] text-center">
                {value}
            </span>
            <button
                onClick={() => value < max && onChange(value + 1)}
                disabled={value >= max}
                className="px-2 py-1.5 bg-ss-surface-high text-ss-on-surface-variant hover:text-ss-on-surface hover:bg-ss-surface-highest transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
                <Plus size={14} />
            </button>
        </div>
    );
}

function ToggleSwitch({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            style={checked ? { backgroundColor: '#4ba1e2' } : undefined}
            className={`relative w-9 h-5 rounded-full transition-colors
                ${checked ? '' : 'bg-ss-surface-highest'}
                ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
            `}
        >
            <span
                className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform
                    ${checked ? 'translate-x-4' : 'translate-x-0'}
                `}
            />
        </button>
    );
}

type SeverityLevel = 'error' | 'warning' | 'info';

function SeverityIcon({ severity }: { severity: SeverityLevel }) {
    if (severity === 'error') {
        return <XCircle size={14} style={{ color: '#cc5662' }} className="flex-shrink-0" />;
    }
    if (severity === 'warning') {
        return <AlertTriangle size={14} style={{ color: '#e2b06f' }} className="flex-shrink-0" />;
    }
    return <Info size={14} style={{ color: '#4ba1e2' }} className="flex-shrink-0" />;
}

function SeverityToggle({
    severity,
    label,
    checked,
    disabled,
    onChange,
}: {
    severity: SeverityLevel;
    label: string;
    checked: boolean;
    disabled?: boolean;
    onChange?: (show: boolean) => void;
}) {
    return (
        <label className={`inline-flex items-center gap-2 text-xs ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
            <ToggleSwitch checked={checked} disabled={disabled} onChange={(v) => onChange?.(v)} />
            <SeverityIcon severity={severity} />
            <span className="text-ss-on-surface-variant">{label}</span>
            {disabled && <Lock size={10} className="text-ss-on-surface-variant/40" />}
        </label>
    );
}

function ResetSWButton({ onReset }: { onReset: () => Promise<void> }) {
    const [state, setState] = useState<'idle' | 'resetting' | 'done'>('idle');

    const handleClick = async () => {
        setState('resetting');
        await onReset();
        setState('done');
        setTimeout(() => setState('idle'), 2000);
    };

    return (
        <button
            onClick={() => void handleClick()}
            disabled={state === 'resetting'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-ss-surface-high hover:bg-ss-surface-highest text-ss-on-surface transition-colors disabled:opacity-50"
        >
            {state === 'resetting' ? (
                <>
                    <RotateCw size={14} className="animate-spin" />
                    Resetting…
                </>
            ) : state === 'done' ? (
                <>
                    <Check size={14} style={{ color: '#28af62' }} />
                    Done
                </>
            ) : (
                <>
                    <RotateCw size={14} />
                    Reset Service Worker
                </>
            )}
        </button>
    );
}
