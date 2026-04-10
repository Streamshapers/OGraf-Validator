import { useState } from 'react';
import type { ApiMethod, LogEntry } from './preview-types.js';

interface Props {
    log: LogEntry[];
    onClear: () => void;
}

export default function PreviewEventLog({ log, onClear }: Props) {
    const [showConsole, setShowConsole] = useState(true);

    const filtered = showConsole ? log : log.filter((e) => !isConsoleMethod(e.method));

    return (
        <section className="rounded-md border border-ss-border overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-ss-dark-1 border-b border-ss-border">
                <span className="text-xs font-semibold uppercase tracking-wide text-ss-text-2">
                    Event Log ({filtered.length})
                </span>
                <div className="flex items-center gap-3">
                    <label className="inline-flex items-center gap-1.5 text-xs text-ss-text-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={showConsole}
                            onChange={(e) => setShowConsole(e.target.checked)}
                            className="accent-ss-primary"
                        />
                        console
                    </label>
                    <button
                        onClick={onClear}
                        disabled={log.length === 0}
                        className="text-xs text-ss-text-2 hover:text-ss-text-1 disabled:opacity-40 transition-colors"
                    >
                        Clear
                    </button>
                </div>
            </div>
            {filtered.length === 0 ? (
                <p className="px-3 py-4 text-xs text-ss-text-2 text-center">
                    No API calls yet. Interact with the graphic above.
                </p>
            ) : (
                <ul className="max-h-72 overflow-y-auto divide-y divide-ss-border/40">
                    {filtered.map((entry) => <LogRow key={entry.id} entry={entry} />)}
                </ul>
            )}
        </section>
    );
}

function LogRow({ entry }: { entry: LogEntry }) {
    const [expanded, setExpanded] = useState(false);
    const isError = entry.error !== undefined || entry.method === 'console.error';
    const isConsole = isConsoleMethod(entry.method);
    const relativeTime = formatRelative(entry.timestamp);

    return (
        <li className="text-xs">
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-ss-dark-1/40 transition-colors"
            >
                <MethodBadge method={entry.method} isError={isError} />
                {!isConsole && (
                    <span className="text-ss-text-2 font-mono">{entry.durationMs}ms</span>
                )}
                <span className="ml-auto text-ss-text-2/60">{relativeTime}</span>
                <span className="text-ss-text-2/60">{expanded ? '▾' : '▸'}</span>
            </button>
            {expanded && (
                <div className="px-3 pb-2 pt-1 bg-ss-dark-2/60 text-xs font-mono space-y-2">
                    <DetailBlock label={isConsole ? 'output' : 'params'} value={entry.params} isError={isError && isConsole} />
                    {entry.error !== undefined && <DetailBlock label="error" value={entry.error} isError />}
                    {entry.result !== undefined && <DetailBlock label="result" value={entry.result} />}
                </div>
            )}
        </li>
    );
}

function MethodBadge({ method, isError }: { method: ApiMethod; isError: boolean }) {
    const bg = badgeClass(method, isError);

    return <span className={`px-1.5 py-0.5 rounded font-mono ${bg}`}>{method}</span>;
}

function badgeClass(method: ApiMethod, isError: boolean): string {
    if (isError) return 'bg-ss-error/15 text-ss-error';

    switch (categoryOf(method)) {
        case 'lifecycle':    return 'bg-ss-primary/15 text-ss-primary-light';
        case 'nonrealtime':  return 'bg-ss-secondary/15 text-ss-secondary';
        case 'console':      return 'bg-ss-grey/40 text-ss-text-2';
        default:             return 'bg-ss-success/15 text-ss-success';
    }
}

function DetailBlock({
    label,
    value,
    isError = false,
}: {
    label: string;
    value: unknown;
    isError?: boolean;
}) {
    const text =
        typeof value === 'string'
            ? value
            : (() => {
                try { return JSON.stringify(value, null, 2); } catch { return String(value); }
            })();

    return (
        <div>
            <span className="text-ss-text-2 uppercase tracking-wide text-[10px]">{label}</span>
            <pre className={`whitespace-pre-wrap break-words ${isError ? 'text-ss-error' : 'text-ss-text-1'}`}>
                {text}
            </pre>
        </div>
    );
}

function isConsoleMethod(method: ApiMethod): boolean {
    return method === 'console.log' || method === 'console.warn'
        || method === 'console.error' || method === 'console.info';
}

function categoryOf(method: ApiMethod): 'lifecycle' | 'action' | 'nonrealtime' | 'console' {
    if (method === 'load' || method === 'dispose') return 'lifecycle';
    if (method === 'goToTime' || method === 'setActionsSchedule') return 'nonrealtime';
    if (isConsoleMethod(method)) return 'console';

    return 'action';
}

function formatRelative(timestamp: number): string {
    const diff = Date.now() - timestamp;
    if (diff < 1000) return 'just now';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;

    return new Date(timestamp).toLocaleTimeString();
}