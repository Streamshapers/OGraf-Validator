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
            <div className="shrink-0 border-b border-ss-outline-variant/40 bg-ss-surface-dim px-3 py-4 sm:px-6 sm:py-5">
                <div className="max-w-2xl mx-auto flex items-start justify-between">
                    <div>
                        <h2 className="text-base font-semibold text-ss-on-surface">Settings</h2>
                        <p className="text-xs text-ss-on-surface-variant mt-0.5">Change how the validator works and looks.</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="ml-4 p-1 rounded-sm text-ss-on-surface-variant hover:text-ss-on-surface hover:bg-ss-surface-high transition-colors"
                        title="Close settings"
                        aria-label="Close settings"
                    >
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-3 pb-8 pt-4 sm:px-6 sm:pt-6">
                <div className="max-w-2xl mx-auto space-y-4 sm:space-y-6">
                    {/* ── General ────────────────────────────────────── */}
                    <SectionHeader>General</SectionHeader>

                    <SettingRow
                        label="Theme"
                        description="Choose dark mode, light mode, or your system setting."
                    >
                        <SegmentGroup
                            label="Theme"
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
                        description="How many folder levels to scan (1–20)."
                    >
                        <NumberStepper
                            value={settings.scanDepth}
                            min={1}
                            max={20}
                            onChange={(v) => onUpdateSettings({ scanDepth: v })}
                        />
                    </SettingRow>

                    {/* ── Validation & Export ─────────────────────────── */}
                    <SectionHeader>Validation</SectionHeader>

                    <SettingRow
                        label="Severity Filter"
                        description="Hide warnings or info messages. Errors are always shown."
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
                        label="Auto revalidate"
                        description="Check the folder again when a file changes."
                    >
                        <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
                            <ToggleSwitch
                                label="Auto revalidate"
                                checked={settings.autoRevalidate}
                                onChange={(v) => onUpdateSettings({ autoRevalidate: v })}
                            />
                            <SegmentGroup
                                label="Check interval"
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

                    <SectionHeader>Troubleshooting</SectionHeader>

                    <SettingRow
                        label="Preview service"
                        description="Reset this only if a preview stays blank or does not reload."
                    >
                        <ResetSWButton onReset={onResetSW} />
                    </SettingRow>

                    {/* ── Workspace Sync ───────────────────────────────── */}
                    <LocalSettingsCard />
                </div>
            </div>
        </main>
    );
}

// ─── Primitives ──────────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
    return (
        <h3 className="pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ss-primary-container">
            {children}
        </h3>
    );
}

function SettingRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col items-stretch gap-3 rounded-sm border border-ss-outline-variant/40 bg-ss-surface px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ss-on-surface">{label}</p>
                <p className="text-xs text-ss-on-surface-variant mt-0.5 leading-relaxed">{description}</p>
            </div>
            <div className="flex w-full shrink-0 items-center sm:w-auto sm:justify-end">
                {children}
            </div>
        </div>
    );
}


function LocalSettingsCard() {
    return (
        <div className="flex items-start gap-3 rounded-sm border border-l-[3px] border-ss-outline-variant/40 border-l-ss-primary-container bg-ss-surface px-4 py-3.5">
            <Info size={16} className="mt-0.5 shrink-0 text-ss-primary-container" />
            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ss-on-surface">Saved in this browser</p>
                <p className="text-xs text-ss-on-surface-variant mt-0.5 leading-relaxed">
                    These settings are not shared with other browsers or devices.
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

function SegmentGroup({ label, options, value, onChange, disabled: groupDisabled }: { label: string; options: SegmentOption[]; value: string; onChange: (v: string) => void; disabled?: boolean }) {
    return (
        <div
            role="group"
            aria-label={label}
            className={`flex w-full overflow-hidden rounded-sm border border-ss-outline-variant/40 transition-opacity sm:w-auto ${groupDisabled ? 'opacity-40' : ''}`}
        >
            {options.map((opt) => {
                const active = opt.value === value;
                const disabled = groupDisabled || (opt.disabled ?? false);
                return (
                    <button
                        type="button"
                        key={opt.value}
                        onClick={() => !disabled && onChange(opt.value)}
                        disabled={disabled}
                        aria-pressed={active}
                        className={`relative flex-1 px-3 py-1.5 text-xs font-medium transition-colors sm:flex-none
                            ${active
                                ? 'bg-ss-primary-container text-white'
                                : 'bg-ss-surface-high text-ss-on-surface-variant hover:text-ss-on-surface'}
                            ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                        `}
                    >
                        {opt.label}
                        {opt.disabled && (
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
        <div className="flex items-center overflow-hidden rounded-sm border border-ss-outline-variant/40">
            <button
                type="button"
                onClick={() => value > min && onChange(value - 1)}
                disabled={value <= min}
                aria-label="Decrease scan depth"
                className="px-2 py-1.5 bg-ss-surface-high text-ss-on-surface-variant hover:text-ss-on-surface hover:bg-ss-surface-highest transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
                <Minus size={14} />
            </button>
            <span className="px-3 py-1.5 text-sm font-mono text-ss-on-surface bg-ss-surface min-w-[40px] text-center">
                {value}
            </span>
            <button
                type="button"
                onClick={() => value < max && onChange(value + 1)}
                disabled={value >= max}
                aria-label="Increase scan depth"
                className="px-2 py-1.5 bg-ss-surface-high text-ss-on-surface-variant hover:text-ss-on-surface hover:bg-ss-surface-highest transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
                <Plus size={14} />
            </button>
        </div>
    );
}

function ToggleSwitch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={`relative w-9 h-5 rounded-full transition-colors
                ${checked ? 'bg-ss-primary-container' : 'bg-ss-surface-highest'}
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
        return <XCircle size={14} className="shrink-0 text-ss-error" />;
    }
    if (severity === 'warning') {
        return <AlertTriangle size={14} className="shrink-0 text-ss-warning" />;
    }
    return <Info size={14} className="shrink-0 text-ss-info" />;
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
        <div className={`inline-flex items-center gap-2 text-xs ${disabled ? 'opacity-60' : ''}`}>
            <ToggleSwitch
                label={`Show ${label.toLowerCase()}`}
                checked={checked}
                disabled={disabled}
                onChange={(v) => onChange?.(v)}
            />
            <SeverityIcon severity={severity} />
            <span className="text-ss-on-surface-variant">{label}</span>
            {disabled && <Lock size={10} className="text-ss-on-surface-variant/40" />}
        </div>
    );
}

function ResetSWButton({ onReset }: { onReset: () => Promise<void> }) {
    const [state, setState] = useState<'idle' | 'resetting' | 'done' | 'error'>('idle');

    const handleClick = async () => {
        setState('resetting');
        try {
            await onReset();
            setState('done');
            setTimeout(() => setState('idle'), 2000);
        } catch (error) {
            console.error('Could not reset the preview service.', error);
            setState('error');
        }
    };

    return (
        <button
            type="button"
            onClick={() => void handleClick()}
            disabled={state === 'resetting'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-medium bg-ss-surface-high hover:bg-ss-surface-highest text-ss-on-surface transition-colors disabled:opacity-50"
        >
            {state === 'resetting' ? (
                <>
                    <RotateCw size={14} className="animate-spin" />
                    Resetting…
                </>
            ) : state === 'done' ? (
                <>
                    <Check size={14} className="text-ss-success" />
                    Done
                </>
            ) : state === 'error' ? (
                <>
                    <XCircle size={14} className="text-ss-error" />
                    Try again
                </>
            ) : (
                <>
                    <RotateCw size={14} />
                    Reset preview
                </>
            )}
        </button>
    );
}
