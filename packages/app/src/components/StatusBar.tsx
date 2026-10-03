import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { RuntimeActiveAttempt } from '../preview/runtime-test-types.js';

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
    runtimeProgress?: { done: number; total: number; failed: number; inconclusive: number } | null;
    extendedActivity?: {
        packageName: string;
        attempt: RuntimeActiveAttempt;
        onCancel: () => void;
    };
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
    extendedActivity,
}: Props) {
    const hasIssues = errorCount > 0 || warningCount > 0;
    const relativeTime = useRelativeTime(lastScan);

    return (
        <div
            className="shrink-0 min-h-6 bg-ss-surface-lowest flex flex-wrap items-center justify-between gap-2 px-2 sm:px-3 py-1 select-none overflow-hidden"
            style={{ borderTop: '1px solid var(--ss-border-subtle)' }}
        >
            {/* Left */}
            <div className="flex min-w-0 items-center gap-2 sm:gap-3 font-mono text-[10px] text-ss-on-surface-variant">
                <span className="whitespace-nowrap">{packageCount} {packageCount === 1 ? 'package' : 'packages'}</span>
                <span className="hidden sm:contents">
                    <Divider />
                    <span>Depth: {scanDepth}</span>
                    <Divider />
                    <span className="text-ss-on-surface-variant/70">{version}</span>
                </span>
            </div>

            {/* Right */}
            <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-3 font-mono text-[10px] text-ss-on-surface-variant">
                {extendedActivity && (
                    <div className="flex min-w-0 items-center gap-2" role="status" aria-label="Extended runtime activity">
                        <span className="truncate max-w-64" title={extendedActivity.packageName}>
                            Extended: {extendedActivity.packageName} · {extendedActivity.attempt.phase}
                            {extendedActivity.attempt.progress && (
                                <> · {extendedActivity.attempt.progress.completedScenarios}/{extendedActivity.attempt.progress.totalScenarios}</>
                            )}
                        </span>
                        <button
                            type="button"
                            className="text-ss-primary-container hover:underline disabled:opacity-50"
                            disabled={extendedActivity.attempt.phase === 'cancelling'}
                            onClick={extendedActivity.onCancel}
                            aria-label={`Cancel extended test for ${extendedActivity.packageName}`}
                        >Cancel</button>
                    </div>
                )}
                {runtimeProgress && (
                    <RuntimeProgressBar {...runtimeProgress} />
                )}
                {autoRevalidate && lastScan && (
                    <span className="hidden lg:contents">
                        <span className="flex items-center gap-1">
                            <RefreshCw size={9} className="opacity-60" />
                            <span className="opacity-70">Last scan: {relativeTime}</span>
                        </span>
                    </span>
                )}
                {hasIssues && (
                    <IssueSummary
                        errorCount={errorCount}
                        warningCount={warningCount}
                        infoCount={infoCount}
                    />
                )}
                {specVersion && (
                    <span className="hidden sm:inline text-ss-on-surface-variant/70 tracking-wide">{specVersion}</span>
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

function RuntimeProgressBar({ done, total, failed, inconclusive }: {
    done: number;
    total: number;
    failed: number;
    inconclusive: number;
}) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const finished = done === total;
    const color = failed > 0
        ? '#cc5662'
        : !finished
            ? '#4ba1e2'
            : inconclusive > 0
                ? '#e2b06f'
                : '#28af62';
    const outcomes = [
        failed > 0 ? `${failed} failed` : null,
        inconclusive > 0 ? `${inconclusive} review` : null,
    ].filter((value): value is string => value !== null);
    const title = !finished
        ? `Runtime tests in progress${outcomes.length ? ` · ${outcomes.join(' · ')}` : ''}`
        : failed > 0 ? `${failed} package${failed === 1 ? '' : 's'} with runtime failures`
            : inconclusive > 0
                ? `${inconclusive} package${inconclusive === 1 ? '' : 's'} with inconclusive runtime tests`
                : 'All runtime tests passed';

    return (
        <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap" title={title}>
            <span className="hidden sm:inline opacity-70">Runtime</span>
            {/* Bar */}
            <span className="relative hidden sm:inline-block w-16 h-1.5 rounded-full overflow-hidden bg-ss-surface-highest">
                <span
                    className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
                    style={{
                        width: `${pct}%`,
                        backgroundColor: color,
                    }}
                />
            </span>
            <span style={{ color }}>
                {done}/{total}
            </span>
            {outcomes.map((outcome) => (
                <span key={outcome} style={{ color }}>· {outcome}</span>
            ))}
        </span>
    );
}
