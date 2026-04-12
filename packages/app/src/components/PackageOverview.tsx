import { Loader2, Folder } from 'lucide-react';
import type { PackageEntry } from '../scanner/scan-packages.js';
import type { PackageCache } from './ContentArea.js';

interface Props {
    rootName: string;
    packages: PackageEntry[];
    packageCache: Record<string, PackageCache>;
    isScanning: boolean;
    onSelectPackage: (entry: PackageEntry) => void;
}

export default function PackageOverview({ rootName, packages, packageCache, isScanning, onSelectPackage }: Props) {
    return (
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden bg-ss-surface-dim">
            {/* Header */}
            <div className="flex-shrink-0 px-6 pt-5 pb-4">
                <p className="text-[10px] font-mono text-ss-on-surface-variant uppercase tracking-widest mb-1 flex items-center gap-1.5">
                    <Folder size={11} className="flex-shrink-0" />
                    <span>{rootName}/</span>
                </p>
                <h2 className="text-xl font-semibold text-ss-on-surface">Package Overview</h2>
            </div>

            {/* Grid */}
            <div className="flex-1 overflow-y-auto px-6 pb-8">
                {isScanning ? (
                    <div className="flex items-center gap-2 text-sm text-ss-on-surface-variant py-4">
                        <Loader2 size={16} className="animate-spin" />
                        Scanning for packages…
                    </div>
                ) : packages.length === 0 ? (
                    <p className="text-sm text-ss-on-surface-variant py-4">No OGraf packages found in this directory.</p>
                ) : (
                    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                        {packages.map((entry) => {
                            const cached = packageCache[entry.path];
                            return (
                                <PackageCard
                                    key={entry.path}
                                    entry={entry}
                                    cache={cached}
                                    onClick={() => onSelectPackage(entry)}
                                />
                            );
                        })}
                    </div>
                )}
            </div>
        </main>
    );
}

// ─── Card ────────────────────────────────────────────────────────────────────

function topBorderColor(cache: PackageCache | undefined): string {
    if (!cache) return 'rgba(64, 72, 80, 0.6)';
    if (cache.validationResult.errors.length > 0) return '#cc5662';
    if (cache.validationResult.warnings.length > 0) return '#e2b06f';
    return '#28af62';
}

function readSpecLabel(manifest: unknown): string {
    if (typeof manifest !== 'object' || manifest === null) return 'OGRAF';
    const schema = (manifest as Record<string, unknown>)['$schema'];
    if (typeof schema !== 'string') return 'OGRAF';
    // Extract version from URL: https://ograf.ebu.io/v1/specification/...
    const match = schema.match(/ograf\.ebu\.io\/(v\d+(?:\.\d+)*)\//i);
    if (match?.[1]) return `OGRAF ${match[1].toUpperCase()}`;
    return 'OGRAF';
}

function PackageCard({ entry, cache, onClick }: { entry: PackageEntry; cache: PackageCache | undefined; onClick: () => void }) {
    const borderTop = topBorderColor(cache);
    const isLoading = !cache;
    const specLabel = cache ? readSpecLabel(cache.manifest) : 'OGRAF';

    return (
        <button
            onClick={onClick}
            className="text-left rounded bg-ss-surface hover:bg-ss-surface-high transition-colors flex flex-col overflow-hidden group"
            style={{ border: '1px solid var(--ss-border-subtle)', borderTop: `3px solid ${borderTop}` }}
        >
            <div className="flex flex-col gap-1.5 px-4 pt-3 pb-2 flex-1">
                {isLoading ? (
                    <SkeletonCard />
                ) : (
                    <>
                        {/* Name + path */}
                        <p className="text-sm font-semibold text-ss-on-surface leading-snug truncate transition-colors">
                            {entry.displayName}
                        </p>
                        <p className="text-[10px] font-mono text-ss-on-surface-variant truncate">
                            /{entry.path.replace(/\\/g, '/')}/
                        </p>

                        {/* Badges */}
                        <div className="flex flex-wrap gap-1.5 mt-1">
                            <StatusBadges cache={cache} />
                        </div>
                    </>
                )}
            </div>

            {/* Footer */}
            <div className="px-4 py-1.5 flex justify-end">
                <span className="text-[9px] font-mono font-semibold tracking-widest text-ss-on-surface-variant/40 uppercase">
                    {specLabel}
                </span>
            </div>
        </button>
    );
}

const HIDDEN_INFO_CODES = new Set(['PACKAGE_FILE_COUNT', 'PACKAGE_TOTAL_SIZE']);

function StatusBadges({ cache }: { cache: PackageCache }) {
    const { validationResult: r } = cache;
    const hasErrors = r.errors.length > 0;
    const hasWarnings = r.warnings.length > 0;
    const visibleInfos = r.infos.filter((i) => !HIDDEN_INFO_CODES.has(i.code));
    const hasInfos = visibleInfos.length > 0;
    const isValid = r.valid && !hasWarnings && !hasInfos;

    return (
        <>
            {isValid && (
                <Badge color="green">✓ Valid</Badge>
            )}
            {!isValid && r.valid && (
                <Badge color="green">Valid</Badge>
            )}
            {hasErrors && (
                <Badge color="red">
                    {r.errors.length} {r.errors.length === 1 ? 'error' : 'errors'}
                </Badge>
            )}
            {hasWarnings && (
                <Badge color="yellow">
                    {r.warnings.length} {r.warnings.length === 1 ? 'warning' : 'warnings'}
                </Badge>
            )}
            {hasInfos && (
                <Badge color="grey">
                    {visibleInfos.length} {visibleInfos.length === 1 ? 'info' : 'infos'}
                </Badge>
            )}
        </>
    );
}

type BadgeColor = 'green' | 'red' | 'yellow' | 'grey';

const BADGE_STYLES: Record<BadgeColor, React.CSSProperties> = {
    green:  { backgroundColor: 'rgba(40,175,98,0.15)',  color: '#28af62', border: '1px solid rgba(40,175,98,0.3)' },
    red:    { backgroundColor: 'rgba(204,86,98,0.15)',  color: '#cc5662', border: '1px solid rgba(204,86,98,0.3)' },
    yellow: { backgroundColor: 'rgba(226,176,111,0.15)', color: '#e2b06f', border: '1px solid rgba(226,176,111,0.3)' },
    grey:   { backgroundColor: 'rgba(64,72,80,0.3)',    color: '#8b949e', border: '1px solid rgba(64,72,80,0.4)' },
};

function Badge({ color, children }: { color: BadgeColor; children: React.ReactNode }) {
    return (
        <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold leading-none"
            style={BADGE_STYLES[color]}
        >
            {children}
        </span>
    );
}

function SkeletonCard() {
    return (
        <div className="flex flex-col gap-2 animate-pulse">
            <div className="h-3 w-3/4 rounded bg-ss-surface-highest" />
            <div className="h-2.5 w-1/2 rounded bg-ss-surface-highest/60" />
            <div className="flex gap-1.5 mt-1">
                <div className="h-4 w-12 rounded-full bg-ss-surface-highest/60" />
                <div className="h-4 w-16 rounded-full bg-ss-surface-highest/40" />
            </div>
        </div>
    );
}
