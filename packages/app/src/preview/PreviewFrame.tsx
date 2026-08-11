import { useState, useEffect } from 'react';
import type {
    GddSchema,
    OgrafCustomAction,
} from '@streamshapers/ograf-validator-core';
import { DEFAULT_BACKGROUND, type PreviewBackground } from './preview-types.js';
import { usePreviewGraphic } from './use-preview-graphic.js';
import {
    getRenderRequirementOptions,
    sameRenderCharacteristics,
    type RenderRequirementOption,
} from './render-requirements.js';
import PreviewStage, { StatusBadge } from './PreviewStage.js';
import PreviewLifecycleBar from './PreviewLifecycleBar.js';
import PreviewBackgroundPicker from './PreviewBackgroundPicker.js';
import PreviewActionPanel from './PreviewActionPanel.js';
import PreviewDataEditor from './PreviewDataEditor.js';
import PreviewNonRealtimePanel from './PreviewNonRealtimePanel.js';
import PreviewEventLog from './PreviewEventLog.js';

// ─── Background persistence ───────────────────────────────────────────────────

const BG_KEY       = 'ograf-preview-background';
const BG_IMAGE_KEY = 'ograf-preview-background-image';

function loadBackground(): PreviewBackground {
    try {
        const raw = localStorage.getItem(BG_KEY);
        if (!raw) return DEFAULT_BACKGROUND;
        const parsed = JSON.parse(raw) as { type: string; value?: string };
        if (parsed.type === 'color' && typeof parsed.value === 'string') {
            return { type: 'color', value: parsed.value };
        }
        if (parsed.type === 'image') {
            const dataUrl = localStorage.getItem(BG_IMAGE_KEY);
            if (typeof dataUrl === 'string') return { type: 'image', dataUrl };
        }

        return DEFAULT_BACKGROUND;
    } catch {
        return DEFAULT_BACKGROUND;
    }
}

function saveBackground(bg: PreviewBackground): void {
    try {
        if (bg.type === 'image') {
            localStorage.setItem(BG_KEY, JSON.stringify({ type: 'image' }));
            localStorage.setItem(BG_IMAGE_KEY, bg.dataUrl);
        } else {
            localStorage.setItem(BG_KEY, JSON.stringify(bg));
            localStorage.removeItem(BG_IMAGE_KEY);
        }
    } catch { /* quota exceeded */ }
}

interface Props {
    swReady: boolean;
    dirHandle: FileSystemDirectoryHandle;
    manifest: unknown;
    packagePath: string;
}

export default function PreviewFrame({ swReady, dirHandle, manifest, packagePath }: Props) {
    const mainFile = readString(manifest, 'main');
    const supportsRealTime = readBool(manifest, 'supportsRealTime') ?? true;
    const supportsNonRealTime = readBool(manifest, 'supportsNonRealTime') ?? false;
    const stepCount = readNumber(manifest, 'stepCount');
    const schema = readSchema(manifest);
    const customActions = readCustomActions(manifest);
    const renderRequirementOptions = getRenderRequirementOptions(manifest);

    const [background, setBackground] = useState<PreviewBackground>(loadBackground);
    const preview = usePreviewGraphic({ swReady, dirHandle, manifest, packagePath, background });

    useEffect(() => {
        saveBackground(background);
    }, [background]);

    if (!mainFile) {
        return <Notice icon="⚠" text='No "main" field in the manifest. Preview is not available.' />;
    }
    if (!swReady) {
        return <Notice icon="⏳" text="Registering Service Worker…" />;
    }

    return (
        <div className="flex h-full">
            {/* ── Left panel: Player (60%) ──────────────────────────────────── */}
            <div className="flex flex-col min-w-0 flex-[3] overflow-y-auto bg-ss-surface-dim"
                 style={{ borderRight: '1px solid var(--ss-border-subtle)' }}>

                {/* Top bar: render controls + step + status */}
                <div className="shrink-0 flex items-center gap-4 px-4 h-10 bg-ss-surface"
                     style={{ borderBottom: '1px solid var(--ss-border-subtle)' }}>
                    <RenderCharacteristicsRow
                        value={preview.state.renderCharacteristics}
                        options={renderRequirementOptions}
                        onChange={preview.setRenderCharacteristics}
                    />
                    <div className="ml-auto flex items-center gap-3">
                        {preview.state.renderType === 'realtime' && stepCount !== undefined && stepCount !== 0 && (
                            <span className="text-xs font-mono text-ss-on-surface-variant">
                                STEP{' '}
                                <span className="text-ss-on-surface">
                                    {preview.state.currentStep === null
                                        ? 'END'
                                        : preview.state.currentStep !== undefined
                                            ? String(preview.state.currentStep)
                                            : 'START'}
                                </span>
                                {' '}/{' '}
                                {stepCount === -1 ? '∞' : stepCount}
                            </span>
                        )}
                        <StatusBadge phase={preview.state.phase} error={preview.state.error} />
                    </div>
                </div>

                {/* Stage -- aspect ratio from renderCharacteristics */}
                <PreviewStage
                    containerRef={preview.containerRef}
                    background={background}
                    width={preview.state.renderCharacteristics.width}
                    height={preview.state.renderCharacteristics.height}
                />

                {/* Bottom bar: background picker right-aligned */}
                <div className="shrink-0 flex items-center justify-end gap-3 px-4 h-10 bg-ss-surface"
                     style={{ borderTop: '1px solid var(--ss-border-subtle)' }}>
                    <PreviewBackgroundPicker value={background} onChange={setBackground} />
                </div>

            </div>

            {/* ── Right panel: Controls (40%, scrollable) ───────────────────── */}
            <div className="flex flex-col min-w-0 flex-[2] overflow-y-auto bg-ss-surface-dim">

                {/* Lifecycle bar as section title */}
                <div className="shrink-0 flex items-center px-4 h-10 bg-ss-surface"
                     style={{ borderBottom: '1px solid var(--ss-border-subtle)' }}>
                    <PreviewLifecycleBar
                        phase={preview.state.phase}
                        renderType={preview.state.renderType}
                        supportsRealTime={supportsRealTime}
                        supportsNonRealTime={supportsNonRealTime}
                        isMounted={preview.isMounted}
                        onChangeRenderType={preview.setRenderType}
                        onLoad={() => void preview.callLoad()}
                        onReload={() => void preview.reMount()}
                        onDispose={() => void preview.callDispose()}
                    />
                </div>

                {/* ACTIONS — switches based on render type */}
                <div className="p-4" style={{ borderBottom: '1px solid var(--ss-border-subtle)' }}>
                    {preview.state.renderType === 'realtime' ? (
                        <PreviewActionPanel
                            isMounted={preview.isMounted}
                            stepCount={stepCount}
                            customActions={customActions}
                            onPlay={(opts) => void preview.callPlay(opts)}
                            onStop={(opts) => void preview.callStop(opts)}
                            onUpdate={(opts) => void preview.callUpdate(opts)}
                            onCustom={(id, payload, opts) => void preview.callCustom(id, payload, opts)}
                        />
                    ) : (
                        <PreviewNonRealtimePanel
                            disabled={!preview.isMounted}
                            manifest={manifest}
                            onGoToTime={(t) => void preview.callGoToTime(t)}
                            onSetSchedule={(s) => void preview.callSetSchedule(s)}
                        />
                    )}
                </div>

                {/* TEMPLATE DATA */}
                <RightSection title="Template Data">
                    <PreviewDataEditor
                        schema={schema}
                        value={preview.state.currentData}
                        onChange={preview.setCurrentData}
                        onReset={preview.resetData}
                    />
                </RightSection>

                {/* EVENT LOG — title bar is inside PreviewEventLog */}
                <div className="shrink-0" style={{ borderBottom: '1px solid var(--ss-border-subtle)' }}>
                    <PreviewEventLog log={preview.state.log} onClear={preview.clearLog} />
                </div>

            </div>
        </div>
    );
}

// ─── Right panel section wrapper ─────────────────────────────────────────────

function RightSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="shrink-0" style={{ borderBottom: '1px solid var(--ss-border-subtle)' }}>
            <div className="flex items-center px-4 h-10 bg-ss-surface"
                 style={{ borderBottom: '1px solid rgba(64, 72, 80, 0.3)' }}>
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ss-on-surface-variant">
                    {title}
                </span>
            </div>
            <div className="p-4">
                {children}
            </div>
        </div>
    );
}

// ─── Manifest accessors ───────────────────────────────────────────────────────

function readString(manifest: unknown, key: string): string | undefined {
    if (typeof manifest !== 'object' || manifest === null) return undefined;
    const v = (manifest as Record<string, unknown>)[key];

    return typeof v === 'string' ? v : undefined;
}

function readBool(manifest: unknown, key: string): boolean | undefined {
    if (typeof manifest !== 'object' || manifest === null) return undefined;
    const v = (manifest as Record<string, unknown>)[key];

    return typeof v === 'boolean' ? v : undefined;
}

function readNumber(manifest: unknown, key: string): number | undefined {
    if (typeof manifest !== 'object' || manifest === null) return undefined;
    const v = (manifest as Record<string, unknown>)[key];

    return typeof v === 'number' ? v : undefined;
}

function readSchema(manifest: unknown): GddSchema | undefined {
    if (typeof manifest !== 'object' || manifest === null) return undefined;
    const s = (manifest as Record<string, unknown>)['schema'];
    if (typeof s !== 'object' || s === null || Array.isArray(s)) return undefined;

    return s as GddSchema;
}

function readCustomActions(manifest: unknown): OgrafCustomAction[] {
    if (typeof manifest !== 'object' || manifest === null) return [];
    const arr = (manifest as Record<string, unknown>)['customActions'];
    if (!Array.isArray(arr)) return [];

    return arr.filter(
        (a): a is OgrafCustomAction =>
            typeof a === 'object' &&
            a !== null &&
            typeof (a as Record<string, unknown>)['id'] === 'string' &&
            typeof (a as Record<string, unknown>)['name'] === 'string',
    );
}

function Notice({ icon, text }: { icon: string; text: string }) {
    return (
        <div className="flex items-center gap-2 text-sm text-ss-on-surface-variant py-6 justify-center h-full">
            <span>{icon}</span><span>{text}</span>
        </div>
    );
}

// ─── Render characteristics row ───────────────────────────────────────────────

function RenderCharacteristicsRow({
    value,
    options,
    onChange,
}: {
    value: import('./preview-types.js').RenderCharacteristics;
    options: RenderRequirementOption[];
    onChange: (rc: import('./preview-types.js').RenderCharacteristics) => void;
}) {
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const inputCls =
        'w-16 px-1.5 py-0.5 rounded-sm bg-ss-surface-dim border border-ss-outline-variant/40 text-ss-on-surface font-mono text-xs ' +
        'focus:outline-hidden focus:border-ss-primary';

    const handleWidth = (raw: string) => {
        const n = parseInt(raw, 10);
        if (!Number.isNaN(n) && n > 0) {
            setSelectedIndex(null);
            onChange({ ...value, width: n });
        }
    };
    const handleHeight = (raw: string) => {
        const n = parseInt(raw, 10);
        if (!Number.isNaN(n) && n > 0) {
            setSelectedIndex(null);
            onChange({ ...value, height: n });
        }
    };
    const handleFrameRate = (raw: string) => {
        const n = parseFloat(raw);
        if (!Number.isNaN(n) && n > 0) {
            setSelectedIndex(null);
            onChange({ ...value, frameRate: n });
        }
    };
    const explicitlySelected = selectedIndex === null
        ? undefined
        : options.find((option) => option.index === selectedIndex);
    const selected = explicitlySelected && sameRenderCharacteristics(explicitlySelected.characteristics, value)
        ? explicitlySelected
        : options.find((option) => sameRenderCharacteristics(option.characteristics, value));

    return (
        <div className="flex items-center gap-2 text-[10px] text-ss-on-surface-variant">
            <span className="uppercase tracking-wide font-semibold">Render</span>
            {options.length > 0 && (
                <select
                    value={selected ? String(selected.index) : ''}
                    onChange={(event) => {
                        const option = options.find((candidate) => String(candidate.index) === event.target.value);
                        if (option) {
                            setSelectedIndex(option.index);
                            onChange(option.characteristics);
                        } else {
                            setSelectedIndex(null);
                        }
                    }}
                    className="max-w-64 px-1.5 py-0.5 rounded-sm bg-ss-surface-dim border border-ss-outline-variant/40 text-ss-on-surface text-xs focus:outline-hidden focus:border-ss-primary"
                    title={selected?.label ?? 'Custom render characteristics'}
                >
                    <option value="">Custom</option>
                    {options.map((option) => (
                        <option key={option.index} value={String(option.index)}>{option.label}</option>
                    ))}
                </select>
            )}
            <input
                type="number" min={1}
                defaultValue={value.width} key={`w-${value.width}`}
                onBlur={(e) => handleWidth(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleWidth((e.target as HTMLInputElement).value); }}
                className={inputCls} title="Width (px)"
            />
            <span>×</span>
            <input
                type="number" min={1}
                defaultValue={value.height} key={`h-${value.height}`}
                onBlur={(e) => handleHeight(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleHeight((e.target as HTMLInputElement).value); }}
                className={inputCls} title="Height (px)"
            />
            <span>px @</span>
            <input
                type="number" min={1} step={0.01}
                defaultValue={value.frameRate} key={`f-${value.frameRate}`}
                onBlur={(e) => handleFrameRate(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleFrameRate((e.target as HTMLInputElement).value); }}
                className={inputCls} title="Frame rate (fps)"
            />
            <span>fps</span>
        </div>
    );
}
