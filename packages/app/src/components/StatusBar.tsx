import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

interface Props {
    version: string;
    packageCount: number;
    scanDepth: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    specVersion?: string;
    lastScan: Date | null;
    autoRevalidate: boolean;
    runtimeProgress?: { done: number; total: number } | null;
}

export default function StatusBar({
    version,
    packageCount,
    scanDepth,
    errorCount,
    warningCount,
    infoCount,
    specVersion,
    lastScan,
    autoRevalidate,
    runtimeProgress,
}: Props) {
    const hasIssues = errorCount > 0 || warningCount > 0;
    const relativeTime = useRelativeTime(lastScan);

    return (
        <div
            className="flex-shrink-0 h-6 bg-ss-surface-lowest flex items-center justify-between px-3 select-none"
            style={{ borderTop: '1px solid var(--ss-border-subtle)' }}
        >
            {/* Left */}
            <div className="flex items-center gap-3 font-mono text-[10px] text-ss-on-surface-variant">
                <span>{packageCount} {packageCount === 1 ? 'package' : 'packages'}</span>
                <Divider />
                <span>Depth: {scanDepth}</span>
                <Divider />
                <span className="text-ss-on-surface-variant/70">{version}</span>
            </div>

            {/* Right */}
            <div className="flex items-center gap-3 font-mono text-[10px] text-ss-on-surface-variant">
                {runtimeProgress && (
                    <>
                        <RuntimeProgressBar done={runtimeProgress.done} total={runtimeProgress.total} />
                        <Divider />
                    </>
                )}
                {autoRevalidate && lastScan && (
                    <>
                        <span className="flex items-center gap-1">
                            <RefreshCw size={9} className="opacity-60" />
                            <span className="opacity-70">Last scan: {relativeTime}</span>
                        </span>
                        <Divider />
                    </>
                )}
                {hasIssues && (
                    <>
                        <IssueSummary
                            errorCount={errorCount}
                            warningCount={warningCount}
                            infoCount={infoCount}
                        />
                        {specVersion && <Divider />}
                    </>
                )}
                {specVersion && (
                    <span className="text-ss-on-surface-variant/70 tracking-wide">{specVersion}</span>
                )}
            </div>
        </div>
    );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Divider() {
    return <span className="text-ss-on-surface-variant/30">|</span>;
}

function formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getRelative(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return formatTime(date);
}

/** Re-renders the relative time every second while the scan is recent. */
function useRelativeTime(date: Date | null): string {
    const [, tick] = useState(0);

    useEffect(() => {
        if (!date) return;
        const id = setInterval(() => tick((n) => n + 1), 1000);
        return () => clearInterval(id);
    }, [date]);

    if (!date) return '';
    return getRelative(date);
}

function IssueSummary({ errorCount, warningCount }: {
    errorCount: number;
    warningCount: number;
    infoCount: number;
}) {
    const parts: React.ReactNode[] = [];

    if (errorCount > 0) parts.push(<span key="e" style={{ color: '#cc5662' }}>{errorCount}E</span>);
    if (warningCount > 0) parts.push(<span key="w" style={{ color: '#e2b06f' }}>{warningCount}W</span>);

    return (
        <span className="flex items-center gap-1.5">
            {parts.map((p, i) => (
                <span key={i} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-ss-on-surface-variant/30">·</span>}
                    {p}
                </span>
            ))}
        </span>
    );
}

function RuntimeProgressBar({ done, total }: { done: number; total: number }) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const finished = done === total;

    return (
        <span className="flex items-center gap-1.5">
            <span className="opacity-70">Runtime</span>
            {/* Bar */}
            <span className="relative w-16 h-1.5 rounded-full overflow-hidden bg-ss-surface-highest">
                <span
                    className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
                    style={{
                        width: `${pct}%`,
                        backgroundColor: finished ? '#28af62' : '#4ba1e2',
                    }}
                />
            </span>
            <span className={finished ? 'opacity-70' : 'text-[#4ba1e2]'}>
                {done}/{total}
            </span>
        </span>
    );
}
