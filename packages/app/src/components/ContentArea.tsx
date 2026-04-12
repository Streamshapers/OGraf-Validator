import { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, Loader2, FolderOpen, Cpu, History, FileCode2 } from 'lucide-react';

declare const __APP_VERSION__: string;
declare const __CORE_VERSION__: string;
import type { ValidationResult } from '@streamshapers/ograf-validator-core';
import type { PackageEntry } from '../scanner/scan-packages.js';
import IssueList from './IssueList.js';

import ManifestTab from './ManifestTab.js';
import GddTab from './GddTab.js';
import AssetsTab from './AssetsTab.js';
import InspectTab from './InspectTab.js';
import PreviewFrame from '../preview/PreviewFrame.js';
import PackageOverview from './PackageOverview.js';
import RuntimeTestCard from './RuntimeTestCard.js';
import type { RuntimeTestResult, RuntimeTestStep } from '../preview/runtime-test-types.js';

export interface PackageCache {
    validationResult: ValidationResult;
    manifest: unknown;
    previousManifest?: unknown;
    assets: string[];
    runtimeTest?: RuntimeTestResult;
    runtimeTestRunning?: boolean;
    runtimeTestSteps?: RuntimeTestStep[];
}

type Tab = 'validation' | 'inspect' | 'preview';

const TABS: { id: Tab; label: string }[] = [
    { id: 'validation', label: 'Validation' },
    { id: 'inspect', label: 'Inspect' },
    { id: 'preview', label: 'Preview' },
];

interface Props {
    selectedPackage: PackageEntry | null;
    cache: PackageCache | null;
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

export default function ContentArea({ selectedPackage, cache, isValidating, validationError, swReady, onOpenDirectory, onReopenLastDirectory, onRerunRuntimeTest, rootName, packages, packageCache, isScanning, onSelectPackage }: Props) {
    const [activeTab, setActiveTab] = useState<Tab>('validation');

    // Reset to validation tab whenever a different package is selected
    useEffect(() => {
        setActiveTab('validation');
    }, [selectedPackage?.path]);

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

    return (
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden bg-ss-surface-dim">
            {/* Package header */}
            <div className="flex-shrink-0 px-6 pt-4 pb-0 bg-ss-surface-dim">
                <div className="flex items-center gap-2.5 mb-3">
                    <h2 className="text-sm font-semibold text-ss-on-surface font-mono">
                        {selectedPackage.displayName}{version ? `-v${version}` : ''}
                    </h2>
                    {stability && <StabilityBadge label={stability} />}
                    {cache && <ValidityBadge valid={cache.validationResult.valid} />}
                    <span className="text-[10px] text-ss-on-surface-variant font-mono ml-1">
                        {selectedPackage.manifestFilename}
                    </span>
                    <PackageSizeBadge result={cache?.validationResult} />
                </div>

                {/* Tab bar */}
                <div className="flex gap-0" style={{ borderBottom: '1px solid var(--ss-border-subtle)' }}>
                    {TABS.map((tab) => (
                        <TabButton
                            key={tab.id}
                            label={tab.label}
                            active={activeTab === tab.id}
                            badge={tab.id === 'validation' && cache ? issueBadge(cache.validationResult) : undefined}
                            disabled={!cache && !isValidating}
                            onClick={() => setActiveTab(tab.id)}
                        />
                    ))}
                </div>
            </div>

            {/* Tab content -- inspect/preview get full-height containers, validation scrolls normally */}
            {activeTab === 'inspect' ? (
                <div className="flex-1 overflow-hidden relative">
                    {isValidating && cache && <RevalidatingOverlay />}
                    {!cache && isValidating && <InlineSpinner />}
                    {cache && (
                        <InspectTab manifest={cache.manifest} previousManifest={cache.previousManifest} assets={cache.assets} dirHandle={selectedPackage.dirHandle} />
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
                            packagePath={selectedPackage.path}
                        />
                    )}
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto px-6 py-4">
                    {!cache && isValidating && <InlineSpinner />}

                    {validationError && !isValidating && (
                        <div className="rounded border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
                            <strong className="font-semibold">Error: </strong>
                            {validationError}
                        </div>
                    )}

                    {cache && activeTab === 'validation' && (
                        <div className={`flex flex-col gap-4 transition-opacity ${isValidating ? 'opacity-50' : 'opacity-100'}`}>
                            {/* Summary row */}
                            <div className="flex items-center justify-between gap-4 flex-wrap">
                                <SummaryBar result={cache.validationResult} />
                                <div className="flex items-center gap-2">
                                    {isValidating && <Spinner />}
                                    <ExportButtons
                                        result={cache.validationResult}
                                        packageName={selectedPackage.displayName}
                                    />
                                </div>
                            </div>
                            <IssueList result={cache.validationResult} />
                            {/* Runtime test results */}
                            <RuntimeTestCard
                                result={cache.runtimeTest}
                                running={cache.runtimeTestRunning}
                                liveSteps={cache.runtimeTestSteps}
                                onRerun={onRerunRuntimeTest}
                            />
                            {/* Bottom stats */}
                            <ValidationStats result={cache.validationResult} />
                        </div>
                    )}
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
    disabled,
    onClick,
}: {
    label: string;
    active: boolean;
    badge?: string;
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
                <span className="px-1.5 py-px rounded-full text-[9px] font-semibold font-mono leading-none bg-red-950 text-red-400 border border-red-900">
                    {badge}
                </span>
            )}
        </button>
    );
}

function issueBadge(result: ValidationResult): string | undefined {
    if (result.errors.length > 0) return String(result.errors.length);
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

function ValidityBadge({ valid }: { valid: boolean }) {
    return valid ? (
        <span className="inline-flex items-center gap-1 px-2 py-px rounded-full text-[10px] font-semibold bg-ss-success/15 text-ss-success border border-ss-success/30">
            <span className="h-1.5 w-1.5 rounded-full bg-ss-success" />
            Valid
        </span>
    ) : (
        <span className="inline-flex items-center gap-1 px-2 py-px rounded-full text-[10px] font-semibold bg-ss-error/15 text-ss-error border border-ss-error/30">
            <span className="h-1.5 w-1.5 rounded-full bg-ss-error" />
            Invalid
        </span>
    );
}

function SummaryBar({ result }: { result: ValidationResult }) {
    const issueCount = result.errors.length + result.warnings.length;
    if (issueCount === 0) {
        return (
            <div className="flex items-center gap-2 text-ss-success text-sm">
                <CheckCircle2 size={16} />
                No issues found.
            </div>
        );
    }

    return (
        <div className="flex items-center gap-4 flex-wrap">
            {result.errors.length > 0 && (
                <span className="flex items-center gap-1.5 text-sm text-ss-error">
                    <XCircle size={16} />
                    <strong>{result.errors.length}</strong> error{result.errors.length !== 1 ? 's' : ''}
                </span>
            )}
            {result.warnings.length > 0 && (
                <span className="flex items-center gap-1.5 text-sm text-ss-warning">
                    <AlertTriangle size={16} />
                    <strong>{result.warnings.length}</strong> warning{result.warnings.length !== 1 ? 's' : ''}
                </span>
            )}
        </div>
    );
}

function ValidationStats({ result }: { result: ValidationResult }) {
    const errors = result.errors.length;
    const warnings = result.warnings.length;
    const issueCount = errors + warnings; // Infos are not "issues"
    // Score: 100% if no issues, deduct per error (errors count double)
    const maxPenalty = 100;
    const penalty = Math.min(maxPenalty, errors * 15 + warnings * 5);
    const score = Math.max(0, 100 - penalty);
    const scoreColor = score >= 90 ? 'text-ss-success' : score >= 70 ? 'text-ss-warning' : 'text-ss-error';
    const barColor = score >= 90 ? 'bg-ss-success' : score >= 70 ? 'bg-ss-warning' : 'bg-ss-error';
    const env = errors === 0 ? 'Production-Ready' : errors <= 2 ? 'Review Required' : 'Not Production-Ready';
    const envColor = errors === 0 ? 'text-ss-success border-ss-success/30 bg-ss-success/10'
        : errors <= 2 ? 'text-ss-warning border-ss-warning/30 bg-ss-warning/10'
        : 'text-ss-error border-ss-error/30 bg-ss-error/10';

    return (
        <div className="grid grid-cols-3 gap-3 mt-2">
            <StatCard label="Issues Found">
                <span className="text-2xl font-semibold text-ss-on-surface font-mono">{issueCount}</span>
                {issueCount > 0 && (
                    <span className="text-[10px] text-ss-on-surface-variant">
                        {errors} error{errors !== 1 ? 's' : ''} · {warnings} warning{warnings !== 1 ? 's' : ''}
                    </span>
                )}
            </StatCard>
            <StatCard label="Validation Score">
                <span className={`text-2xl font-semibold font-mono ${scoreColor}`}>{score}%</span>
                <div className="w-full h-1 rounded-full bg-ss-surface-highest mt-1">
                    <div className={`h-1 rounded-full transition-all ${barColor}`} style={{ width: `${score}%` }} />
                </div>
            </StatCard>
            <StatCard label="Environment">
                <span className={`my-auto w-fit text-sm font-semibold px-3 py-1 rounded-full border ${envColor}`}>
                    {env}
                </span>
            </StatCard>
        </div>
    );
}

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5 px-4 py-3 rounded bg-ss-surface"
             style={{ border: '1px solid var(--ss-border-subtle)' }}>
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ss-on-surface-variant">
                {label}
            </span>
            {children}
        </div>
    );
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
                        Select any folder containing one or more{' '}
                        <code className="font-mono text-ss-primary-container bg-ss-surface-high px-1 py-0.5 rounded text-xs">OGraf</code>
                        {' '}packages to begin the validation process. Our architect will scan for schema integrity and cross-references.
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
}: {
    result: ValidationResult;
    packageName: string;
}) {
    const slug = packageName.replace(/[^a-z0-9]/gi, '-').toLowerCase();

    const btnCls = 'px-2.5 py-1 rounded text-xs font-medium text-ss-on-surface-variant hover:text-ss-on-surface transition-colors';
    const btnStyle = { border: '1px solid rgba(64, 72, 80, 0.5)' };

    return (
        <div className="flex gap-2">
            <button
                onClick={() => downloadJson(result, slug)}
                className={btnCls}
                style={btnStyle}
                title="Download validation result as JSON"
            >
                Export JSON
            </button>
            <button
                onClick={() => downloadHtml(result, packageName)}
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

function downloadJson(result: ValidationResult, slug: string): void {
    const data = JSON.stringify(result, null, 2);
    triggerDownload(new Blob([data], { type: 'application/json' }), `${slug}-validation.json`);
}

function downloadHtml(result: ValidationResult, packageName: string): void {
    const date = new Date().toLocaleString();
    const statusColor = result.valid ? '#22c55e' : '#ef4444';
    const statusLabel = result.valid ? 'Valid' : 'Invalid';

    const renderIssues = (issues: ValidationResult['errors'], color: string, label: string) => {
        if (issues.length === 0) return '';

        const rows = issues.map((i) => `
            <tr>
                <td><code>${escHtml(i.code)}</code></td>
                <td>${i.path ? `<code>${escHtml(i.path)}</code>` : '—'}</td>
                <td>${escHtml(i.message)}</td>
            </tr>`).join('');

        return `
            <h2 style="color:${color};margin-top:2rem">${label} (${issues.length})</h2>
            <table>
                <thead><tr><th>Code</th><th>Path</th><th>Message</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
    };

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>OGraf Validation – ${escHtml(packageName)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #1f2937; }
  h1 { font-size: 1.25rem; margin-bottom: 0.25rem; }
  .meta { color: #6b7280; font-size: 0.85rem; margin-bottom: 1.5rem; }
  .badge { display: inline-block; padding: 0.15rem 0.6rem; border-radius: 9999px; font-weight: 600; font-size: 0.8rem; color: #fff; background: ${statusColor}; }
  table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  th { text-align: left; padding: 0.5rem 0.75rem; background: #f3f4f6; border-bottom: 2px solid #e5e7eb; }
  td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  code { font-family: monospace; font-size: 0.8rem; background: #f3f4f6; padding: 0.1rem 0.3rem; border-radius: 3px; }
  .ok { color: #16a34a; font-weight: 600; }
</style>
</head>
<body>
<h1>${escHtml(packageName)} <span class="badge">${statusLabel}</span></h1>
<p class="meta">Generated ${escHtml(date)} · OGraf Validator</p>
${result.issues.length === 0
    ? '<p class="ok">No issues found – the package is fully valid.</p>'
    : renderIssues(result.errors, '#ef4444', 'Errors') +
      renderIssues(result.warnings, '#f59e0b', 'Warnings') +
      renderIssues(result.infos, '#3b82f6', 'Infos')}
</body>
</html>`;

    triggerDownload(new Blob([html], { type: 'text/html' }), `${packageName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-validation.html`);
}

function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
