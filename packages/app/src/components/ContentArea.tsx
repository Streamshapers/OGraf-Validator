import { lazy, Suspense, useState, useEffect } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Loader2, FolderOpen, Cpu, History, FileCode2 } from 'lucide-react';

declare const __CORE_VERSION__: string;
import type { ValidationResult } from '@streamshapers/ograf-validator-core';
import type { PackageEntry } from '../scanner/scan-packages.js';
import IssueList from './IssueList.js';

import PreviewFrame from '../preview/PreviewFrame.js';
import PackageOverview from './PackageOverview.js';
import RuntimeTestCard from './RuntimeTestCard.js';
import type { RuntimeTestResult, RuntimeTestStep } from '../preview/runtime-test-types.js';
import {
    derivePackageReadiness,
    type PackageReadiness,
    type RuntimeTestPhase,
} from '../readiness/package-readiness.js';
import {
    createValidationReport,
    renderValidationReportHtml,
} from '../readiness/validation-report.js';

export interface PackageCache {
    validationResult: ValidationResult;
    /** Unfiltered result used for readiness and reports when UI severities are hidden. */
    fullValidationResult?: ValidationResult;
    manifest: unknown;
    previousManifest?: unknown;
    assets: string[];
    runtimeTest?: RuntimeTestResult;
    runtimeTestPhase?: RuntimeTestPhase;
    runtimeTestSteps?: RuntimeTestStep[];
}

type Tab = 'validation' | 'inspect' | 'preview';

const TABS: { id: Tab; label: string }[] = [
    { id: 'validation', label: 'Validation' },
    { id: 'inspect', label: 'Inspect' },
    { id: 'preview', label: 'Preview' },
];

const InspectTab = lazy(() => import('./InspectTab.js'));

interface Props {
    selectedPackage: PackageEntry | null;
    cache: PackageCache | null;
    packageReadiness?: PackageReadiness | null;
    isValidating: boolean;
    validationError: string | null;
    swReady: boolean;
    onOpenDirectory: () => void;
    onReopenLastDirectory: () => void;
    onRerunRuntimeTest?: () => void;

    // Package overview props
    rootName: string | null;
    packages: PackageEntry[];
    packageCache: Record<string, PackageCache>;
    isScanning: boolean;
    onSelectPackage: (entry: PackageEntry) => void;
}

export default function ContentArea({ selectedPackage, cache, packageReadiness, isValidating, validationError, swReady, onOpenDirectory, onReopenLastDirectory, onRerunRuntimeTest, rootName, packages, packageCache, isScanning, onSelectPackage }: Props) {
    const [activeTab, setActiveTab] = useState<Tab>('validation');

    // Reset to validation tab whenever a different package is selected
    useEffect(() => {
        setActiveTab('validation');
    }, [selectedPackage?.key]);

    if (!selectedPackage && rootName) {
        return (
            <PackageOverview
                rootName={rootName}
                packages={packages}
                packageCache={packageCache}
                isScanning={isScanning}
                onSelectPackage={onSelectPackage}
            />
        );
    }

    if (!selectedPackage) return <WelcomeScreen onOpenDirectory={onOpenDirectory} onReopenLastDirectory={onReopenLastDirectory} />;

    const version = readManifestVersion(cache?.manifest);
    const stability = readManifestStability(cache?.manifest);
    const readiness = cache
        ? packageReadiness ?? derivePackageReadiness(
            cache.fullValidationResult ?? cache.validationResult,
            cache.runtimeTest,
            cache.runtimeTestPhase,
        )
        : null;

    return (
        <main className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden bg-ss-surface-dim">
            {/* Package header */}
            <div className="flex-shrink-0 px-3 sm:px-4 lg:px-6 pt-3 sm:pt-4 pb-0 bg-ss-surface-dim">
                <div className="flex items-start justify-between gap-3 sm:gap-4 mb-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
                            <h2 className="min-w-0 truncate text-sm font-semibold text-ss-on-surface font-mono" title={selectedPackage.displayName}>
                                {selectedPackage.displayName}{version ? `-v${version}` : ''}
                            </h2>
                            <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
                                {stability && <StabilityBadge label={stability} />}
                                {readiness && <ReadinessBadge readiness={readiness} />}
                            </div>
                        </div>
                        {cache && readiness && (
                            <div className="flex items-center gap-x-2 gap-y-1 mt-1.5 text-[10px] text-ss-on-surface-variant font-mono flex-wrap">
                                <HeaderStatus
                                    label={`Manifest ${cache.validationResult.valid ? 'Valid' : 'Invalid'}`}
                                    tone={cache.validationResult.valid ? 'success' : 'error'}
                                />
                                <span className="text-ss-on-surface-variant/30">·</span>
                                <HeaderStatus
                                    label={`Runtime ${readiness.runtimeLabel}`}
                                    tone={runtimeHeaderTone(readiness.runtimeStatus)}
                                    pulse={readiness.runtimeStatus === 'running'}
                                />
                                <span className="hidden md:inline text-ss-on-surface-variant/30">·</span>
                                <span className="hidden md:inline truncate max-w-72" title={selectedPackage.manifestFilename}>{selectedPackage.manifestFilename}</span>
                            </div>
                        )}
                    </div>
                    <div className="hidden md:block flex-shrink-0">
                        <PackageSizeBadge result={cache?.validationResult} />
                    </div>
                </div>

                {/* Tab bar */}
                <div className="overflow-x-auto" style={{ borderBottom: '1px solid var(--ss-border-subtle)' }}>
                    <div className="flex gap-0 min-w-max">
                        {TABS.map((tab) => (
                            <TabButton
                                key={tab.id}
                                label={tab.label}
                                active={activeTab === tab.id}
                                badge={tab.id === 'validation' && readiness ? issueBadge(readiness) : undefined}
                                badgeTone={readiness ? issueBadgeTone(readiness) : undefined}
                                disabled={!cache && !isValidating}
                                onClick={() => setActiveTab(tab.id)}
                            />
                        ))}
                    </div>
                </div>
            </div>

            {/* Tab content -- inspect/preview get full-height containers, validation scrolls normally */}
            {activeTab === 'inspect' ? (
                <div className="flex-1 overflow-hidden relative">
                    {isValidating && cache && <RevalidatingOverlay />}
                    {!cache && isValidating && <InlineSpinner />}
                    {cache && (
                        <Suspense fallback={<InlineSpinner />}>
                            <InspectTab
                                key={selectedPackage.key}
                                manifest={cache.manifest}
                                previousManifest={cache.previousManifest}
                                assets={cache.assets}
                                dirHandle={selectedPackage.dirHandle}
                                validationResult={cache.validationResult}
                                onShowValidation={() => setActiveTab('validation')}
                            />
                        </Suspense>
                    )}
                </div>
            ) : activeTab === 'preview' ? (
                <div className="flex-1 overflow-hidden relative">
                    {isValidating && cache && <RevalidatingOverlay />}
                    {!cache && isValidating && <InlineSpinner />}
                    {cache && (
                        <PreviewFrame
                            swReady={swReady}
                            dirHandle={selectedPackage.dirHandle}
                            manifest={cache.manifest}
                            packagePath={selectedPackage.key}
                        />
                    )}
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
                    <div className="w-full max-w-[1280px] mx-auto">
                        {!cache && isValidating && <InlineSpinner />}

                        {validationError && !isValidating && (
                            <div className="rounded border border-red-800 bg-red-950/40 px-3 sm:px-4 py-3 text-sm text-red-300">
                                <strong className="font-semibold">Error: </strong>
                                {validationError}
                            </div>
                        )}

                        {cache && activeTab === 'validation' && (
                            <div className={`flex flex-col gap-3 sm:gap-4 transition-opacity ${isValidating ? 'opacity-50' : 'opacity-100'}`}>
                                <ValidationOverview
                                    readiness={readiness!}
                                    result={cache.validationResult}
                                    fullResult={cache.fullValidationResult}
                                    isValidating={isValidating}
                                    packageName={selectedPackage.displayName}
                                    runtimeResult={cache.runtimeTest}
                                    runtimePhase={cache.runtimeTestPhase}
                                />
                                <IssueList result={cache.validationResult} />
                                <RuntimeTestCard
                                    result={cache.runtimeTest}
                                    phase={cache.runtimeTestPhase}
                                    liveSteps={cache.runtimeTestSteps}
                                    onRerun={onRerunRuntimeTest}
                                />
                            </div>
                        )}
                    </div>
                </div>
            )}
        </main>
    );
}

// ─── Revalidating indicators ─────────────────────────────────────────────────

/** Subtle pulsing bar at the top — shown when re-validating over existing content. */
function RevalidatingOverlay() {
    return (
        <div className="absolute top-0 left-0 right-0 h-0.5 z-10 overflow-hidden">
            <div
                className="h-full animate-pulse"
                style={{ backgroundColor: '#4ba1e2', opacity: 0.7 }}
            />
        </div>
    );
}

/** Full spinner — shown only on first load when there's no cache yet. */
function InlineSpinner() {
    return (
        <div className="flex items-center gap-3 text-sm text-ss-on-surface-variant py-4">
            <Spinner />
            Validating package…
        </div>
    );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TabButton({
    label,
    active,
    badge,
    badgeTone,
    disabled,
    onClick,
}: {
    label: string;
    active: boolean;
    badge?: string;
    badgeTone?: 'error' | 'warning';
    disabled: boolean;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`
                px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5
                ${active
                    ? 'border-ss-primary-container text-ss-on-surface'
                    : 'border-transparent text-ss-on-surface-variant hover:text-ss-on-surface'}
                ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
            `}
        >
            {label}
            {badge && (
                <span className={`px-1.5 py-px rounded-full text-[9px] font-semibold font-mono leading-none border ${
                    badgeTone === 'warning'
                        ? 'bg-ss-warning/10 text-ss-warning border-ss-warning/30'
                        : 'bg-ss-error/10 text-ss-error border-ss-error/30'
                }`}>
                    {badge}
                </span>
            )}
        </button>
    );
}

function issueBadge(readiness: PackageReadiness): string | undefined {
    return readiness.totalIssues > 0 ? String(readiness.totalIssues) : undefined;
}

function issueBadgeTone(readiness: PackageReadiness): 'error' | 'warning' | undefined {
    if (readiness.staticErrors + readiness.runtimeErrors > 0) return 'error';
    if (readiness.staticWarnings + readiness.runtimeWarnings > 0) return 'warning';
    return undefined;
}

function readManifestVersion(manifest: unknown): string | undefined {
    if (typeof manifest !== 'object' || manifest === null) return undefined;
    const v = (manifest as Record<string, unknown>)['version'];
    return typeof v === 'string' ? v : undefined;
}

function readManifestStability(manifest: unknown): string | undefined {
    if (typeof manifest !== 'object' || manifest === null) return undefined;
    const s = (manifest as Record<string, unknown>)['stability'];
    if (typeof s === 'string') return s.toUpperCase();
    return undefined;
}

function StabilityBadge({ label }: { label: string }) {
    const isStable = label === 'STABLE';
    const cls = isStable
        ? 'bg-ss-success/15 text-ss-success border-ss-success/30'
        : 'bg-ss-warning/15 text-ss-warning border-ss-warning/30';
    return (
        <span className={`inline-flex items-center px-2 py-px rounded-full text-[10px] font-semibold border tracking-wide ${cls}`}>
            {label}
        </span>
    );
}

function ReadinessBadge({ readiness }: { readiness: PackageReadiness }) {
    const pulse = readiness.status === 'runtime-running' ? 'animate-pulse' : '';
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border ${readinessClass(readiness.status)}`}>
            <span className={`h-1.5 w-1.5 rounded-full bg-current ${pulse}`} />
            {readiness.label}
        </span>
    );
}

function HeaderStatus({ label, tone, pulse = false }: {
    label: string;
    tone: 'success' | 'warning' | 'error' | 'info' | 'muted';
    pulse?: boolean;
}) {
    const color = {
        success: 'text-ss-success',
        warning: 'text-ss-warning',
        error: 'text-ss-error',
        info: 'text-ss-primary-container',
        muted: 'text-ss-on-surface-variant',
    }[tone];
    return (
        <span className={`inline-flex items-center gap-1.5 ${color}`}>
            <span className={`h-1.5 w-1.5 rounded-full bg-current ${pulse ? 'animate-pulse' : ''}`} />
            {label}
        </span>
    );
}

function runtimeHeaderTone(status: PackageReadiness['runtimeStatus']): 'success' | 'warning' | 'error' | 'info' | 'muted' {
    if (status === 'passed') return 'success';
    if (status === 'failed') return 'error';
    if (status === 'inconclusive') return 'warning';
    if (status === 'pending' || status === 'running') return 'info';
    return 'muted';
}

function ValidationOverview({
    readiness,
    result,
    fullResult,
    isValidating,
    packageName,
    runtimeResult,
    runtimePhase,
}: {
    readiness: PackageReadiness;
    result: ValidationResult;
    fullResult?: ValidationResult;
    isValidating: boolean;
    packageName: string;
    runtimeResult?: RuntimeTestResult;
    runtimePhase?: RuntimeTestPhase;
}) {
    const hiddenWarnings = Math.max(
        0,
        (fullResult?.warnings.length ?? result.warnings.length) - result.warnings.length,
    );
    const staticFindings = readiness.staticErrors + readiness.staticWarnings;
    const runtimeFindings = readiness.runtimeErrors + readiness.runtimeWarnings;
    const staticSummary = readiness.staticErrors > 0
        ? `Static validation found ${readiness.staticErrors} error${readiness.staticErrors === 1 ? '' : 's'}.`
        : readiness.staticWarnings > 0
            ? `Static validation needs review: ${readiness.staticWarnings} warning${readiness.staticWarnings === 1 ? '' : 's'}.`
            : 'Static validation passed.';
    const statusTone = readiness.status === 'production-ready'
        ? 'text-ss-success'
        : readiness.status === 'needs-review'
            ? 'text-ss-warning'
            : readiness.status === 'runtime-pending' || readiness.status === 'runtime-running'
                ? 'text-ss-primary-container'
                : 'text-ss-error';

    return (
        <section aria-label="Validation summary" className="overflow-hidden rounded bg-ss-surface"
                 style={{ border: '1px solid var(--ss-border-subtle)' }}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-3 sm:px-4 py-3">
                <div className="flex items-start gap-2.5 min-w-0">
                    <ValidationStatusIcon readiness={readiness} />
                    <div className="min-w-0">
                        <h3 className="text-xs font-semibold text-ss-on-surface">Validation summary</h3>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-ss-on-surface-variant">
                            {staticSummary}
                            {hiddenWarnings > 0 && ` ${hiddenWarnings} warning${hiddenWarnings === 1 ? '' : 's'} hidden by settings.`}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 sm:flex-shrink-0">
                    {isValidating && <Spinner />}
                    <ExportButtons
                        result={fullResult ?? result}
                        packageName={packageName}
                        runtimeResult={runtimeResult}
                        runtimePhase={runtimePhase}
                    />
                </div>
            </div>

            <div className="grid grid-cols-2 xl:grid-cols-4 gap-px bg-ss-outline-variant/20"
                 style={{ borderTop: '1px solid var(--ss-border-subtle)' }}>
                <OverviewMetric
                    label="Overall readiness"
                    value={readiness.label}
                    detail={readiness.status === 'production-ready' ? 'Ready for production' : 'Action required'}
                    valueClass={statusTone}
                />
                <OverviewMetric
                    label="Static validation"
                    value={`${readiness.staticScore}%`}
                    detail={`${readiness.staticErrors} error${readiness.staticErrors === 1 ? '' : 's'} · ${readiness.staticWarnings} warning${readiness.staticWarnings === 1 ? '' : 's'}`}
                    valueClass={readiness.staticErrors > 0 ? 'text-ss-error' : readiness.staticWarnings > 0 ? 'text-ss-warning' : 'text-ss-success'}
                />
                <OverviewMetric
                    label="Runtime"
                    value={readiness.runtimeLabel}
                    detail={runtimeFindings > 0 ? `${runtimeFindings} runtime finding${runtimeFindings === 1 ? '' : 's'}` : 'No runtime findings'}
                    valueClass={runtimeHeaderTone(readiness.runtimeStatus) === 'success'
                        ? 'text-ss-success'
                        : runtimeHeaderTone(readiness.runtimeStatus) === 'warning'
                            ? 'text-ss-warning'
                            : runtimeHeaderTone(readiness.runtimeStatus) === 'error'
                                ? 'text-ss-error'
                                : 'text-ss-primary-container'}
                />
                <OverviewMetric
                    label="Findings"
                    value={String(readiness.totalIssues)}
                    detail={`Static ${staticFindings} · Runtime ${runtimeFindings}`}
                    valueClass={readiness.staticErrors + readiness.runtimeErrors > 0
                        ? 'text-ss-error'
                        : readiness.totalIssues > 0 ? 'text-ss-warning' : 'text-ss-success'}
                />
            </div>
        </section>
    );
}

function ValidationStatusIcon({ readiness }: { readiness: PackageReadiness }) {
    if (readiness.status === 'production-ready') {
        return <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-ss-success" />;
    }
    if (readiness.status === 'needs-review') {
        return <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-ss-warning" />;
    }
    if (readiness.status === 'runtime-pending' || readiness.status === 'runtime-running') {
        return <Loader2 size={16} className={`mt-0.5 flex-shrink-0 text-ss-primary-container ${readiness.status === 'runtime-running' ? 'animate-spin' : ''}`} />;
    }
    return <XCircle size={16} className="mt-0.5 flex-shrink-0 text-ss-error" />;
}

function OverviewMetric({ label, value, detail, valueClass }: {
    label: string;
    value: string;
    detail: string;
    valueClass: string;
}) {
    return (
        <div className="min-w-0 bg-ss-surface px-3 sm:px-4 py-3">
            <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-ss-on-surface-variant">{label}</p>
            <p className={`mt-1 truncate text-xs font-semibold font-mono ${valueClass}`} title={value}>{value}</p>
            <p className="mt-0.5 truncate text-[10px] text-ss-on-surface-variant/70" title={detail}>{detail}</p>
        </div>
    );
}

function readinessClass(status: PackageReadiness['status']): string {
    if (status === 'production-ready') {
        return 'text-ss-success border-ss-success/30 bg-ss-success/10';
    }
    if (status === 'needs-review') {
        return 'text-ss-warning border-ss-warning/30 bg-ss-warning/10';
    }
    if (status === 'runtime-pending' || status === 'runtime-running') {
        return 'text-ss-primary-container border-ss-primary-container/30 bg-ss-primary-container/10';
    }
    return 'text-ss-error border-ss-error/30 bg-ss-error/10';
}

function WelcomeScreen({ onOpenDirectory, onReopenLastDirectory }: { onOpenDirectory: () => void; onReopenLastDirectory: () => void }) {
    const lastDir = (() => { try { return localStorage.getItem('ograf-last-directory'); } catch { return null; } })();

    return (
        <main className="flex-1 flex flex-col items-center justify-center bg-ss-surface-dim gap-10 px-6">
            {/* Logo card */}
            <div className="flex flex-col items-center gap-6">
                <img
                    src="https://raw.githubusercontent.com/ebu/ograf/main/docs/logo/ograf-logo-colour.svg"
                    alt="OGraf"
                    width={1818}
                    height={611}
                    className="w-48 h-auto"
                />

                <div className="text-center max-w-md">
                    <h2 className="text-2xl font-semibold text-ss-on-surface mb-3">
                        Open a directory to get started
                    </h2>
                    <p className="text-sm text-ss-on-surface-variant leading-relaxed mb-6">
                        Select a folder with one or more{' '}
                        <code className="font-mono text-ss-primary-container bg-ss-surface-high px-1 py-0.5 rounded text-xs">OGraf</code>
                        {' '}packages. The validator will find and check them.
                    </p>
                    <button
                        onClick={onOpenDirectory}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded text-sm font-semibold bg-ss-primary-dark hover:bg-ss-primary-container text-white transition-colors"
                    >
                        <FolderOpen size={16} />
                        Open Directory
                    </button>
                </div>
            </div>

            {/* Info cards */}
            <div className="flex gap-4 flex-wrap justify-center">
                <InfoCard
                    icon={<Cpu size={14} />}
                    label="Validator Core"
                    value={`v${__CORE_VERSION__}`}
                />
                <InfoCard
                    icon={<History size={14} />}
                    label="Last Directory"
                    value={lastDir ?? '—'}
                    muted={!lastDir}
                    onClick={lastDir ? onReopenLastDirectory : undefined}
                />
                <InfoCard
                    icon={<FileCode2 size={14} />}
                    label="OGraf Spec"
                    value="v1"
                />
            </div>
        </main>
    );
}

function InfoCard({ icon, label, value, muted, onClick }: { icon: React.ReactNode; label: string; value: string; muted?: boolean; onClick?: () => void }) {
    const clickable = !!onClick;
    return (
        <div
            onClick={onClick}
            className={`flex flex-col items-center gap-1.5 px-6 py-3 rounded bg-ss-surface transition-colors
                ${clickable ? 'cursor-pointer hover:bg-ss-surface-high' : ''}`}
            style={{ border: '1px solid rgba(64, 72, 80, 0.3)' }}
            title={clickable ? `Reopen "${value}"` : undefined}
        >
            <div className="flex items-center gap-1.5 text-ss-on-surface-variant">
                {icon}
                <span className="text-[10px] uppercase tracking-[0.08em] font-semibold">{label}</span>
            </div>
            <span className={`text-xs font-mono ${muted ? 'text-ss-on-surface-variant/40' : 'text-ss-on-surface'}`}>
                {value}
            </span>
        </div>
    );
}

function Spinner() {
    return <Loader2 size={16} className="animate-spin" />;
}

// ─── Validation report export ─────────────────────────────────────────────────

function ExportButtons({
    result,
    packageName,
    runtimeResult,
    runtimePhase,
}: {
    result: ValidationResult;
    packageName: string;
    runtimeResult?: RuntimeTestResult;
    runtimePhase?: RuntimeTestPhase;
}) {
    const slug = packageName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const report = () => createValidationReport(packageName, result, runtimeResult, runtimePhase);

    const btnCls = 'inline-flex items-center justify-center whitespace-nowrap px-2.5 py-1.5 sm:py-1 rounded text-[11px] sm:text-xs font-medium text-ss-on-surface-variant hover:text-ss-on-surface hover:bg-ss-surface-high transition-colors';
    const btnStyle = { border: '1px solid rgba(64, 72, 80, 0.5)' };

    return (
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <button
                onClick={() => downloadJson(report(), slug)}
                className={btnCls}
                style={btnStyle}
                title="Download validation result as JSON"
            >
                Export JSON
            </button>
            <button
                onClick={() => downloadHtml(report(), slug)}
                className={btnCls}
                style={btnStyle}
                title="Download validation report as HTML"
            >
                Export HTML
            </button>
        </div>
    );
}

function triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function downloadJson(report: ReturnType<typeof createValidationReport>, slug: string): void {
    const data = JSON.stringify(report, null, 2);
    triggerDownload(new Blob([data], { type: 'application/json' }), `${slug}-validation-report.json`);
}

function downloadHtml(report: ReturnType<typeof createValidationReport>, slug: string): void {
    const html = renderValidationReportHtml(report);
    triggerDownload(new Blob([html], { type: 'text/html' }), `${slug}-validation-report.html`);
}

function PackageSizeBadge({ result }: { result: ValidationResult | undefined }) {
    if (!result) return null;
    const sizeIssue = result.infos.find((i) => i.code === 'PACKAGE_TOTAL_SIZE');
    const countIssue = result.infos.find((i) => i.code === 'PACKAGE_FILE_COUNT');
    if (!sizeIssue) return null;
    const sizeMatch = sizeIssue.message.match(/:\s*(.+)\.$/);
    const countMatch = countIssue?.message.match(/(\d+)/);
    if (!sizeMatch) return null;
    return (
        <span
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium text-ss-on-surface-variant bg-ss-surface-high ml-auto"
        >
            {countMatch && <span>{countMatch[1]} files</span>}
            {countMatch && <span className="text-ss-on-surface-variant/30">·</span>}
            <span>{sizeMatch[1]}</span>
        </span>
    );
}
