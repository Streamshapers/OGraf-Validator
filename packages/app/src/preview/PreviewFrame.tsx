import { useState, useEffect } from 'react';
import type {
    GddSchema,
    OgrafCustomAction,
} from '@streamshapers/ograf-validator-core';
import { DEFAULT_BACKGROUND, type PreviewBackground } from './preview-types.js';
import { usePreviewGraphic } from './use-preview-graphic.js';
import PreviewStage from './PreviewStage.js';
import PreviewLifecycleBar from './PreviewLifecycleBar.js';
import PreviewBackgroundPicker from './PreviewBackgroundPicker.js';
import PreviewActionPanel from './PreviewActionPanel.js';
import PreviewDataEditor from './PreviewDataEditor.js';
import PreviewNonRealtimePanel from './PreviewNonRealtimePanel.js';
import PreviewEventLog from './PreviewEventLog.js';

// ─── Background persistence (localStorage, global across packages) ────────────

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
    } catch { /* quota exceeded — keep in-memory only */ }
}

interface Props {
    swReady: boolean;
    dirHandle: FileSystemDirectoryHandle;
    manifest: unknown;
    packagePath: string;
}

export default function PreviewFrame({ swReady, manifest, packagePath }: Props) {
    const mainFile = readString(manifest, 'main');
    const supportsRealTime = readBool(manifest, 'supportsRealTime') ?? true;
    const supportsNonRealTime = readBool(manifest, 'supportsNonRealTime') ?? false;
    const stepCount = readNumber(manifest, 'stepCount');
    const schema = readSchema(manifest);
    const customActions = readCustomActions(manifest);

    const preview = usePreviewGraphic({ swReady, manifest, packagePath });

    const [background, setBackground] = useState<PreviewBackground>(loadBackground);

    useEffect(() => {
        saveBackground(background);
    }, [background]);

    if (!mainFile) {
        return <Notice icon="⚠" text='No "main" field in manifest – cannot preview.' />;
    }
    if (!swReady) {
        return <Notice icon="⏳" text="Registering Service Worker…" />;
    }

    return (
        <div className="flex flex-col gap-4">
            <PreviewLifecycleBar
                phase={preview.state.phase}
                renderType={preview.state.renderType}
                supportsRealTime={supportsRealTime}
                supportsNonRealTime={supportsNonRealTime}
                currentStep={preview.state.currentStep}
                stepCount={stepCount}
                isMounted={preview.isMounted}
                onChangeRenderType={preview.setRenderType}
                onLoad={() => void preview.callLoad()}
                onReload={() => void preview.reMount()}
                onDispose={() => void preview.callDispose()}
            />

            {/* Canvas controls: render characteristics (left) + background picker (right) */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <RenderCharacteristicsRow
                    value={preview.state.renderCharacteristics}
                    onChange={preview.setRenderCharacteristics}
                />
                <PreviewBackgroundPicker value={background} onChange={setBackground} />
            </div>

            <PreviewStage
                containerRef={preview.containerRef}
                phase={preview.state.phase}
                error={preview.state.error}
                background={background}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <PreviewActionPanel
                    isMounted={preview.isMounted}
                    skipAnimationDefault={preview.state.skipAnimationDefault}
                    customActions={customActions}
                    onChangeSkipAnimationDefault={preview.setSkipAnimationDefault}
                    onPlay={(opts) => void preview.callPlay(opts)}
                    onStop={(opts) => void preview.callStop(opts)}
                    onUpdate={(opts) => void preview.callUpdate(opts)}
                    onCustom={(id, payload, opts) => void preview.callCustom(id, payload, opts)}
                />
                <PreviewDataEditor
                    schema={schema}
                    value={preview.state.currentData}
                    onChange={preview.setCurrentData}
                    onReset={preview.resetData}
                />
            </div>

            {supportsNonRealTime && (
                <PreviewNonRealtimePanel
                    disabled={!preview.isMounted}
                    onGoToTime={(t) => void preview.callGoToTime(t)}
                    onSetSchedule={(s) => void preview.callSetSchedule(s)}
                />
            )}

            <PreviewEventLog log={preview.state.log} onClear={preview.clearLog} />

            <p className="text-xs text-ss-text-2">
                Service Worker · <code className="font-mono">/__ograf_preview__/{mainFile}</code>
            </p>
        </div>
    );
}

// ─── Manifest accessors ──────────────────────────────────────────────────────

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
        <div className="flex items-center gap-2 text-sm text-ss-text-2 py-6 justify-center">
            <span>{icon}</span><span>{text}</span>
        </div>
    );
}

// ─── Render characteristics row ──────────────────────────────────────────────

function RenderCharacteristicsRow({
    value,
    onChange,
}: {
    value: import('./preview-types.js').RenderCharacteristics;
    onChange: (rc: import('./preview-types.js').RenderCharacteristics) => void;
}) {
    const inputCls =
        'w-16 px-1.5 py-0.5 rounded bg-ss-dark-2 border border-ss-border text-ss-text-1 font-mono text-xs ' +
        'focus:outline-none focus:border-ss-primary';

    const handleWidth = (raw: string) => {
        const n = parseInt(raw, 10);
        if (!Number.isNaN(n) && n > 0) onChange({ ...value, width: n });
    };
    const handleHeight = (raw: string) => {
        const n = parseInt(raw, 10);
        if (!Number.isNaN(n) && n > 0) onChange({ ...value, height: n });
    };
    const handleFrameRate = (raw: string) => {
        const n = parseFloat(raw);
        if (!Number.isNaN(n) && n > 0) onChange({ ...value, frameRate: n });
    };

    return (
        <div className="flex items-center gap-2 text-[10px] text-ss-text-2">
            <span className="uppercase tracking-wide font-semibold">Render</span>
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
