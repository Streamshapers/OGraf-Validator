import { useEffect, useState } from 'react';
import {
    AlertTriangle,
    CheckCircle2,
    Clock3,
    FileCode2,
    Folder,
    Loader2,
    XCircle,
} from 'lucide-react';
import type { PackageEntry } from '../scanner/scan-packages.js';
import type { PackageCache } from './ContentArea.js';
import {
    formatRenderResolutionSummary,
    readManifestName,
    readRenderRequirements,
    readThumbnails,
    type InspectorThumbnail,
} from '../inspector/manifest-inspector.js';
import { getLocalFile } from '../inspector/local-files.js';
import { derivePackageReadiness, type PackageReadiness } from '../readiness/package-readiness.js';

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
            <div className="shrink-0 px-6 pt-5 pb-4">
                <p className="text-[10px] font-mono text-ss-on-surface-variant uppercase tracking-widest mb-1 flex items-center gap-1.5">
                    <Folder size={11} className="shrink-0" />
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
                            const cached = packageCache[entry.key];
                            return (
                                <PackageCard
                                    key={entry.key}
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

function topBorderColor(readiness: PackageReadiness | undefined): string {
    if (!readiness) return 'rgba(64, 72, 80, 0.6)';
    if (readiness.status === 'static-invalid' || readiness.status === 'runtime-failed') return '#cc5662';
    if (readiness.status === 'needs-review') return '#e2b06f';
    if (readiness.status === 'runtime-pending' || readiness.status === 'runtime-running') return '#4ba1e2';
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
    const readiness = cache
        ? derivePackageReadiness(cache.validationResult, cache.runtimeTest, cache.runtimeTestPhase)
        : undefined;
    const borderTop = topBorderColor(readiness);
    const isLoading = !cache;
    const specLabel = cache ? readSpecLabel(cache.manifest) : 'OGRAF';
    const manifestName = cache ? readManifestName(cache.manifest) : undefined;
    const thumbnails = cache ? readThumbnails(cache.manifest) : [];
    const renderRequirements = cache ? readRenderRequirements(cache.manifest) : [];
    const renderResolution = formatRenderResolutionSummary(renderRequirements);
    const localThumbnail = thumbnails.find((thumbnail) => !thumbnail.external);
    const hasExternalThumbnail = thumbnails.some((thumbnail) => thumbnail.external);
    const footerMeta = cardMetaLabel(renderResolution, localThumbnail, hasExternalThumbnail, isLoading);
    const cardName = manifestName ?? entry.displayName;

    return (
        <button
            onClick={onClick}
            className="text-left rounded-sm bg-ss-surface hover:bg-ss-surface-high transition-colors flex flex-col overflow-hidden group"
            style={{ border: '1px solid var(--ss-border-subtle)', borderTop: `3px solid ${borderTop}` }}
        >
            <div className="min-h-10 flex items-center justify-between gap-3 px-3.5 py-2.5 border-b border-ss-outline-variant/25">
                <p className="min-w-0 flex-1 truncate text-xs font-semibold text-ss-on-surface" title={cardName}>
                    {cardName}
                </p>
                {readiness && <ReadinessIcon readiness={readiness} />}
            </div>
            <PackageMedia
                thumbnail={localThumbnail}
                hasExternalThumbnail={hasExternalThumbnail}
                name={cardName}
                dirHandle={entry.dirHandle}
                loadingPackage={isLoading}
            />
            <div className="flex flex-col gap-1.5 px-4 pt-3 pb-2 flex-1">
                {isLoading ? (
                    <SkeletonCard />
                ) : (
                    <>
                        <p className="text-[10px] font-mono text-ss-on-surface-variant truncate" title={entry.manifestPath}>
                            {entry.manifestPath}
                        </p>

                        {/* Badges */}
                        <div className="flex flex-wrap gap-1.5 mt-1">
                            <StatusBadges cache={cache} readiness={readiness!} />
                        </div>
                    </>
                )}
            </div>

            {/* Footer */}
            <div className="px-4 py-1.5 flex items-center justify-between gap-2">
                {footerMeta && (
                    <span className="truncate text-[9px] text-ss-on-surface-variant/60">
                        {footerMeta}
                    </span>
                )}
                <span className="ml-auto text-[9px] font-mono font-semibold tracking-widest text-ss-on-surface-variant/40 uppercase">
                    {specLabel}
                </span>
            </div>
        </button>
    );
}

function PackageMedia({
    thumbnail,
    hasExternalThumbnail,
    name,
    dirHandle,
    loadingPackage,
}: {
    thumbnail?: InspectorThumbnail;
    hasExternalThumbnail: boolean;
    name: string;
    dirHandle: FileSystemDirectoryHandle;
    loadingPackage: boolean;
}) {
    const [preview, setPreview] = useState<{ file: string; url: string } | null>(null);
    const [failedFile, setFailedFile] = useState<string | null>(null);
    const file = thumbnail?.file;

    useEffect(() => {
        let cancelled = false;
        let url: string | null = null;
        setPreview(null);
        setFailedFile(null);

        if (!file) return () => undefined;

        void getLocalFile(dirHandle, file)
            .then((thumbnail) => {
                if (cancelled) return;
                url = URL.createObjectURL(thumbnail);
                setPreview({ file, url });
            })
            .catch(() => {
                if (!cancelled) setFailedFile(file);
            });

        return () => {
            cancelled = true;
            if (url) URL.revokeObjectURL(url);
        };
    }, [dirHandle, file]);

    const objectUrl = preview?.file === file ? preview?.url ?? null : null;
    const placeholderLabel = loadingPackage
        ? 'Scanning package'
        : failedFile === file
            ? 'Thumbnail unavailable'
            : file
                ? 'Loading thumbnail'
                : hasExternalThumbnail
                    ? 'External thumbnail not loaded'
                    : 'Graphic package';

    return (
        <div
            data-testid="package-media"
            className="relative aspect-video overflow-hidden bg-ss-surface-lowest border-b border-ss-outline-variant/30"
        >
            {objectUrl ? (
                <img
                    src={objectUrl}
                    alt={`${name} thumbnail`}
                    className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.015]"
                />
            ) : (
                <OgrafPlaceholder
                    label={placeholderLabel}
                    loading={loadingPackage || (Boolean(file) && failedFile !== file)}
                />
            )}

        </div>
    );
}

function cardMetaLabel(
    renderResolution: string | undefined,
    thumbnail: InspectorThumbnail | undefined,
    hasExternalThumbnail: boolean,
    loadingPackage: boolean,
): string | undefined {
    if (loadingPackage) return 'Scanning package';
    if (renderResolution) return `Render ${renderResolution}`;
    if (thumbnail?.resolution) {
        const resolution = `${thumbnail.resolution.width} × ${thumbnail.resolution.height}`;
        return hasExternalThumbnail ? `Thumbnail ${resolution} · + external` : `Thumbnail ${resolution}`;
    }
    if (thumbnail) return hasExternalThumbnail ? 'Local thumbnail · + external' : 'Local thumbnail';
    if (hasExternalThumbnail) return 'External thumbnail metadata';
    return undefined;
}

function OgrafPlaceholder({ label, loading }: { label: string; loading: boolean }) {
    return (
        <div
            role="img"
            aria-label={`OGraf placeholder: ${label}`}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-ss-surface-high to-ss-surface-lowest text-ss-on-surface-variant"
        >
            <div className="absolute inset-3 rounded-sm border border-dashed border-ss-outline-variant/30" />
            {loading
                ? <Loader2 size={22} className="animate-spin text-ss-primary-container/70" />
                : <FileCode2 size={24} className="text-ss-primary-container/60" />}
            <span className="text-sm font-semibold tracking-[0.24em] text-ss-on-surface/70">OGRAF</span>
            <span className="text-[9px] text-ss-on-surface-variant/60">{label}</span>
        </div>
    );
}

const HIDDEN_INFO_CODES = new Set(['PACKAGE_FILE_COUNT', 'PACKAGE_TOTAL_SIZE']);

function StatusBadges({ cache, readiness }: { cache: PackageCache; readiness: PackageReadiness }) {
    const { validationResult: r } = cache;
    const hasErrors = r.errors.length > 0;
    const hasWarnings = r.warnings.length > 0;
    const combinesWarnings = readiness.status === 'needs-review';
    const combinedWarningCount = readiness.staticWarnings + readiness.runtimeWarnings;
    const visibleInfos = r.infos.filter((i) => !HIDDEN_INFO_CODES.has(i.code));
    const hasInfos = visibleInfos.length > 0;

    return (
        <>
            <Badge color={r.valid ? 'green' : 'red'}>
                Manifest {r.valid ? 'Valid' : 'Invalid'}
            </Badge>
            {!combinesWarnings && readiness.runtimeStatus !== 'not-run' && (
                <Badge color={runtimeBadgeColor(readiness)}>
                    Runtime {readiness.runtimeLabel}
                </Badge>
            )}
            {combinesWarnings && combinedWarningCount > 0 && (
                <Badge color="yellow">
                    {combinedWarningCount} {combinedWarningCount === 1 ? 'warning' : 'warnings'}
                </Badge>
            )}
            {hasErrors && (
                <Badge color="red">
                    {r.errors.length} {r.errors.length === 1 ? 'error' : 'errors'}
                </Badge>
            )}
            {!combinesWarnings && hasWarnings && (
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

function ReadinessIcon({ readiness }: { readiness: PackageReadiness }) {
    const sharedClass = 'shrink-0 rounded-full p-1';
    const tooltip = readinessTooltip(readiness);
    const label = `Overall status: ${tooltip}`;

    if (readiness.status === 'production-ready') {
        return (
            <span title={tooltip} aria-label={label} role="img" className={`${sharedClass} bg-ss-success/10 text-ss-success`}>
                <CheckCircle2 size={14} />
            </span>
        );
    }
    if (readiness.status === 'needs-review') {
        return (
            <span title={tooltip} aria-label={label} role="img" className={`${sharedClass} bg-ss-warning/10 text-ss-warning`}>
                <AlertTriangle size={14} />
            </span>
        );
    }
    if (readiness.status === 'runtime-running') {
        return (
            <span title={tooltip} aria-label={label} role="img" className={`${sharedClass} bg-ss-primary-container/10 text-ss-primary-container`}>
                <Loader2 size={14} className="animate-spin" />
            </span>
        );
    }
    if (readiness.status === 'runtime-pending') {
        return (
            <span title={tooltip} aria-label={label} role="img" className={`${sharedClass} bg-ss-primary-container/10 text-ss-primary-container`}>
                <Clock3 size={14} />
            </span>
        );
    }
    return (
        <span title={tooltip} aria-label={label} role="img" className={`${sharedClass} bg-ss-error/10 text-ss-error`}>
            <XCircle size={14} />
        </span>
    );
}

function readinessTooltip(readiness: PackageReadiness): string {
    if (readiness.status !== 'needs-review') return readiness.label;

    const total = readiness.staticWarnings + readiness.runtimeWarnings;
    const summary = `${total} ${total === 1 ? 'warning' : 'warnings'}`;
    const breakdown = [
        readiness.staticWarnings > 0
            ? `${readiness.staticWarnings} static ${readiness.staticWarnings === 1 ? 'warning' : 'warnings'}`
            : undefined,
        readiness.runtimeWarnings > 0
            ? `${readiness.runtimeWarnings} inconclusive runtime ${readiness.runtimeWarnings === 1 ? 'check' : 'checks'}`
            : undefined,
    ].filter(Boolean).join(' · ');

    return breakdown ? `${readiness.label} · ${summary} · ${breakdown}` : `${readiness.label} · ${summary}`;
}

function runtimeBadgeColor(readiness: PackageReadiness): BadgeColor {
    if (readiness.runtimeStatus === 'passed') return 'green';
    if (readiness.runtimeStatus === 'failed') return 'red';
    if (readiness.runtimeStatus === 'inconclusive') return 'yellow';
    return 'blue';
}

type BadgeColor = 'green' | 'red' | 'yellow' | 'blue' | 'grey';

const BADGE_STYLES: Record<BadgeColor, React.CSSProperties> = {
    green:  { backgroundColor: 'rgba(40,175,98,0.15)',  color: '#28af62', border: '1px solid rgba(40,175,98,0.3)' },
    red:    { backgroundColor: 'rgba(204,86,98,0.15)',  color: '#cc5662', border: '1px solid rgba(204,86,98,0.3)' },
    yellow: { backgroundColor: 'rgba(226,176,111,0.15)', color: '#e2b06f', border: '1px solid rgba(226,176,111,0.3)' },
    blue:   { backgroundColor: 'rgba(75,161,226,0.15)', color: '#4ba1e2', border: '1px solid rgba(75,161,226,0.3)' },
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
            <div className="h-3 w-3/4 rounded-sm bg-ss-surface-highest" />
            <div className="h-2.5 w-1/2 rounded-sm bg-ss-surface-highest/60" />
            <div className="flex gap-1.5 mt-1">
                <div className="h-4 w-12 rounded-full bg-ss-surface-highest/60" />
                <div className="h-4 w-16 rounded-full bg-ss-surface-highest/40" />
            </div>
        </div>
    );
}
