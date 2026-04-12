import { useState, useEffect } from 'react';
import type { ScheduleEntry } from './preview-types.js';

const DURATION_KEY = 'ograf-preview-duration';

interface Props {
    disabled: boolean;
    manifest: unknown;
    onGoToTime: (timestamp: number) => void;
    onSetSchedule: (schedule: ScheduleEntry[]) => void;
}

const DEFAULT_SCHEDULE_JSON =
    '[\n  { "timestamp": 0,    "action": { "method": "playAction", "params": { "delta": 1 } } },\n  { "timestamp": 2000, "action": { "method": "stopAction" } }\n]';

export default function PreviewNonRealtimePanel({ disabled, manifest, onGoToTime, onSetSchedule }: Props) {
    const computed = computeMaxDuration(manifest);

    const [maxMs, setMaxMs] = useState<number>(() => {
        try {
            const stored = localStorage.getItem(DURATION_KEY);
            return stored ? parseInt(stored, 10) : computed;
        } catch { return computed; }
    });

    // When manifest changes and we get a better computed value, use it
    useEffect(() => {
        if (computed !== 60000) {
            setMaxMs(computed);
        }
    }, [computed]);

    const handleMaxChange = (v: number) => {
        setMaxMs(v);
        try { localStorage.setItem(DURATION_KEY, String(v)); } catch { /* quota */ }
    };

    return (
        <div className="space-y-4">
            <GoToTimeRow disabled={disabled} maxMs={maxMs} onMaxChange={handleMaxChange} onInvoke={onGoToTime} />
            <ScheduleEditor disabled={disabled} onInvoke={onSetSchedule} />
        </div>
    );
}

function computeMaxDuration(manifest: unknown): number {
    if (typeof manifest !== 'object' || manifest === null) return 60000;
    const m = manifest as Record<string, unknown>;

    // Direct duration field (ms)
    if (typeof m['duration'] === 'number') return m['duration'] as number;

    // frameRate: spec defines it as OgrafNumberConstraint inside renderRequirement
    // { renderRequirement: { frameRate: { max?: number, min?: number } } }
    const frameRate = resolveFrameRate(m);

    const markers = m['markers'];
    if (Array.isArray(markers) && markers.length > 0) {
        const last = markers[markers.length - 1] as Record<string, unknown>;
        const tm = typeof last['tm'] === 'number' ? last['tm'] as number : 0;
        const dr = typeof last['dr'] === 'number' ? last['dr'] as number : 0;
        if (tm + dr > 0) return Math.ceil(((tm + dr) / frameRate) * 1000);
    }

    return 60000;
}

function resolveFrameRate(m: Record<string, unknown>): number {
    // Top-level direct number (non-spec but common shorthand)
    if (typeof m['frameRate'] === 'number') return m['frameRate'] as number;

    // Spec: renderRequirement.frameRate is an OgrafNumberConstraint { max?, min? }
    const rr = m['renderRequirement'];
    if (typeof rr === 'object' && rr !== null) {
        const fr = (rr as Record<string, unknown>)['frameRate'];
        if (typeof fr === 'number') return fr;
        if (typeof fr === 'object' && fr !== null) {
            const fc = fr as Record<string, unknown>;
            const fps = fc['max'] ?? fc['min'];
            if (typeof fps === 'number') return fps;
        }
    }

    return 25; // fallback
}

const INPUT_CLS = 'px-1.5 py-0.5 rounded bg-ss-surface border border-ss-outline-variant/40 text-ss-on-surface font-mono text-xs focus:outline-none focus:border-ss-primary';

function GoToTimeRow({
    disabled,
    maxMs,
    onMaxChange,
    onInvoke,
}: {
    disabled: boolean;
    maxMs: number;
    onMaxChange: (v: number) => void;
    onInvoke: (timestamp: number) => void;
}) {
    const [timestamp, setTimestamp] = useState(0);
    const clamped = Math.min(timestamp, maxMs);

    return (
        <div className="flex flex-col gap-2">
            {/* Slider row */}
            <div className="flex items-center gap-2">
                <span className="text-[10px] text-ss-on-surface-variant uppercase tracking-wide font-semibold w-16 shrink-0">goToTime</span>
                <input
                    type="range"
                    min={0}
                    max={maxMs}
                    step={Math.max(1, Math.round(maxMs / 500))}
                    value={clamped}
                    onChange={(e) => setTimestamp(parseInt(e.target.value, 10))}
                    className="flex-1 accent-ss-primary"
                />
            </div>

            {/* Value + max + go */}
            <div className="flex items-center gap-2">
                <span className="text-[10px] text-ss-on-surface-variant w-16 shrink-0" />
                <input
                    type="number"
                    min={0}
                    max={maxMs}
                    value={clamped}
                    onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        setTimestamp(Number.isNaN(v) ? 0 : Math.min(v, maxMs));
                    }}
                    className={`w-20 ${INPUT_CLS}`}
                />
                <span className="text-[10px] text-ss-on-surface-variant/60">ms</span>
                <span className="text-[10px] text-ss-on-surface-variant/40 mx-1">/</span>
                <input
                    type="number"
                    min={100}
                    value={maxMs}
                    onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!Number.isNaN(v) && v >= 100) onMaxChange(v);
                    }}
                    className={`w-20 ${INPUT_CLS}`}
                    title="Max duration (editable)"
                />
                <span className="text-[10px] text-ss-on-surface-variant/60">ms</span>
                <button
                    onClick={() => onInvoke(clamped)}
                    disabled={disabled}
                    className="ml-auto px-3 py-1 rounded text-xs font-semibold bg-ss-surface-high hover:bg-ss-surface-highest text-ss-on-surface disabled:opacity-40 transition-colors"
                >
                    Go
                </button>
            </div>
        </div>
    );
}

function ScheduleEditor({
    disabled,
    onInvoke,
}: {
    disabled: boolean;
    onInvoke: (schedule: ScheduleEntry[]) => void;
}) {
    const [text, setText] = useState(DEFAULT_SCHEDULE_JSON);
    const [error, setError] = useState<string | null>(null);

    const invoke = () => {
        try {
            const parsed = JSON.parse(text);
            if (!Array.isArray(parsed)) {
                setError('Schedule must be a JSON array.');

                return;
            }
            setError(null);
            onInvoke(parsed as ScheduleEntry[]);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    return (
        <div className="space-y-1">
            <div className="flex items-center gap-2">
                <span className="text-[10px] text-ss-on-surface-variant uppercase tracking-wide font-semibold">setActionsSchedule</span>
                <button
                    onClick={invoke}
                    disabled={disabled}
                    className="ml-auto px-3 py-1 rounded text-xs font-semibold bg-ss-surface-high hover:bg-ss-surface-highest text-ss-on-surface disabled:opacity-40 transition-colors"
                >
                    Apply
                </button>
            </div>
            <textarea
                rows={5}
                spellCheck={false}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full px-2 py-1 rounded text-xs bg-ss-surface border border-ss-outline-variant/40 text-ss-on-surface font-mono focus:outline-none focus:border-ss-primary resize-y"
            />
            {error && <p className="text-[10px] text-ss-error">{error}</p>}
        </div>
    );
}
