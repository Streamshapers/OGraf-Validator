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
        <>
            {/* Title bar — replaces outer RightSection header */}
            <div className="shrink-0 flex items-center justify-between px-4 h-10 bg-ss-surface"
                 style={{ borderBottom: '1px solid var(--ss-border-subtle)' }}>
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ss-on-surface-variant">
                    Event Log {log.length > 0 && `(${filtered.length})`}
                </span>
                <div className="flex items-center gap-3">
                    <label className="inline-flex items-center gap-1.5 text-xs text-ss-on-surface-variant cursor-pointer">
                        <input
                            type="checkbox"
                            checked={showConsole}
                            onChange={(e) => setShowConsole(e.target.checked)}
                            className="accent-ss-primary"
                        />
                        template logs
                    </label>
                    <button
                        onClick={onClear}
                        disabled={log.length === 0}
                        className="px-3 py-1 rounded-sm text-xs font-semibold bg-ss-surface-high hover:bg-ss-surface-highest text-ss-on-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        Clear
                    </button>
                </div>
            </div>

            {/* Log entries */}
            <div className="py-2 px-1">
                {filtered.length === 0 ? (
                    <p className="py-2 text-xs text-ss-on-surface-variant text-center">
                        No API calls yet. Interact with the graphic above.
                    </p>
                ) : (
                    <ul className="flex flex-col divide-y divide-ss-outline-variant/20">
                        {filtered.map((entry) => <LogRow key={entry.id} entry={entry} />)}
                    </ul>
                )}
            </div>
        </>
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
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-ss-surface-high/40 transition-colors"
            >
                <MethodBadge method={entry.method} isError={isError} />
                {!isConsole && (
                    <span className="text-ss-on-surface-variant font-mono">{entry.durationMs}ms</span>
                )}
                <span className="ml-auto text-ss-on-surface-variant/60">{relativeTime}</span>
                <span className="text-ss-on-surface-variant/60">{expanded ? '▾' : '▸'}</span>
            </button>
            {expanded && (
                <div className="px-3 pb-2 pt-1 bg-ss-surface/60 text-xs font-mono space-y-2">
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

    return <span className={`px-1.5 py-0.5 rounded-sm font-mono ${bg}`}>{method}</span>;
}

function badgeClass(method: ApiMethod, isError: boolean): string {
    if (isError) return 'bg-ss-error/15 text-ss-error';

    switch (categoryOf(method)) {
        case 'lifecycle':    return 'bg-ss-primary/15 text-ss-primary-light';
        case 'nonrealtime':  return 'bg-ss-secondary/15 text-ss-secondary';
        case 'console':      return 'bg-ss-surface-highest/40 text-ss-on-surface-variant';
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
            <span className="text-ss-on-surface-variant uppercase tracking-wide text-[10px]">{label}</span>
            <pre className={`whitespace-pre-wrap break-words ${isError ? 'text-ss-error' : 'text-ss-on-surface'}`}>
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
