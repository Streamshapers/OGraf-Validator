import { useState } from 'react';
import type { ScheduleEntry } from './preview-types.js';

interface Props {
    disabled: boolean;
    onGoToTime: (timestamp: number) => void;
    onSetSchedule: (schedule: ScheduleEntry[]) => void;
}

const DEFAULT_SCHEDULE_JSON =
    '[\n  { "timestamp": 0,    "action": { "method": "playAction", "params": { "delta": 1 } } },\n  { "timestamp": 2000, "action": { "method": "stopAction" } }\n]';

export default function PreviewNonRealtimePanel({ disabled, onGoToTime, onSetSchedule }: Props) {
    return (
        <section className="rounded-md border border-ss-border overflow-hidden">
            <div className="px-3 py-2 bg-ss-dark-1 border-b border-ss-border">
                <span className="text-xs font-semibold uppercase tracking-wide text-ss-text-2">Non-Realtime</span>
            </div>
            <div className="p-3 space-y-4 bg-ss-dark-2/40">
                <GoToTimeRow disabled={disabled} onInvoke={onGoToTime} />
                <ScheduleEditor disabled={disabled} onInvoke={onSetSchedule} />
            </div>
        </section>
    );
}

function GoToTimeRow({
    disabled,
    onInvoke,
}: {
    disabled: boolean;
    onInvoke: (timestamp: number) => void;
}) {
    const [timestamp, setTimestamp] = useState(0);

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <span className="text-[10px] text-ss-text-2 uppercase tracking-wide font-semibold min-w-[80px]">goToTime</span>
                <input
                    type="range"
                    min={0}
                    max={60000}
                    step={10}
                    value={timestamp}
                    onChange={(e) => setTimestamp(parseInt(e.target.value, 10))}
                    className="flex-1 accent-ss-primary"
                />
                <input
                    type="number"
                    value={timestamp}
                    onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        setTimestamp(Number.isNaN(v) ? 0 : v);
                    }}
                    className="w-20 px-1.5 py-0.5 rounded bg-ss-dark-2 border border-ss-border text-ss-text-1 font-mono text-xs focus:outline-none focus:border-ss-primary"
                />
                <span className="text-[10px] text-ss-text-2/60">ms</span>
                <button
                    onClick={() => onInvoke(timestamp)}
                    disabled={disabled}
                    className="px-3 py-1 rounded text-xs font-semibold bg-ss-dark-1 hover:bg-ss-grey text-ss-text-1 disabled:opacity-40 transition-colors"
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
                <span className="text-[10px] text-ss-text-2 uppercase tracking-wide font-semibold">setActionsSchedule</span>
                <button
                    onClick={invoke}
                    disabled={disabled}
                    className="ml-auto px-3 py-1 rounded text-xs font-semibold bg-ss-dark-1 hover:bg-ss-grey text-ss-text-1 disabled:opacity-40 transition-colors"
                >
                    Apply
                </button>
            </div>
            <textarea
                rows={5}
                spellCheck={false}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full px-2 py-1 rounded text-xs bg-ss-dark-2 border border-ss-border text-ss-text-1 font-mono focus:outline-none focus:border-ss-primary resize-y"
            />
            {error && <p className="text-[10px] text-ss-error">{error}</p>}
        </div>
    );
}
