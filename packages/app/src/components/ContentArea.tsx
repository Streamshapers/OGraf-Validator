import { useState, useEffect } from 'react';
import type { ValidationResult } from '@streamshapers/ograf-validator-core';
import type { PackageEntry } from '../scanner/scan-packages.js';
import IssueList from './IssueList.js';
import ManifestDiffPanel from './ManifestDiffPanel.js';
import ManifestTab from './ManifestTab.js';
import GddTab from './GddTab.js';
import AssetsTab from './AssetsTab.js';
import PreviewFrame from '../preview/PreviewFrame.js';

export interface PackageCache {
    validationResult: ValidationResult;
    manifest: unknown;
    previousManifest?: unknown;
    assets: string[];
}

type Tab = 'validation' | 'manifest' | 'gdd' | 'assets' | 'preview';

const TABS: { id: Tab; label: string }[] = [
    { id: 'validation', label: 'Validation' },
    { id: 'manifest', label: 'Manifest' },
    { id: 'gdd', label: 'GDD' },
    { id: 'assets', label: 'Assets' },
    { id: 'preview', label: 'Preview' },
];

interface Props {
    selectedPackage: PackageEntry | null;
    cache: PackageCache | null;
    isValidating: boolean;
    validationError: string | null;
    swReady: boolean;
}

export default function ContentArea({ selectedPackage, cache, isValidating, validationError, swReady }: Props) {
    const [activeTab, setActiveTab] = useState<Tab>('validation');

    // Reset to validation tab whenever a different package is selected
    useEffect(() => {
        setActiveTab('validation');
    }, [selectedPackage?.path]);

    if (!selectedPackage) return <WelcomeScreen />;

    return (
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Package header */}
            <div className="flex-shrink-0 px-6 pt-5 pb-0">
                <div className="flex items-center gap-3 mb-4">
                    <h2 className="text-lg font-semibold text-ss-text-1 font-mono">
                        {selectedPackage.displayName}
                    </h2>
                    {cache && <ValidityBadge valid={cache.validationResult.valid} />}
                    <span className="text-xs text-ss-text-2 font-mono">{selectedPackage.manifestFilename}</span>
                </div>

                {/* Tab bar */}
                <div className="flex gap-1 border-b border-ss-border">
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

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
                {isValidating && (
                    <div className="flex items-center gap-3 text-sm text-ss-text-2 py-4">
                        <Spinner />
                        Validating package…
                    </div>
                )}

                {validationError && !isValidating && (
                    <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
                        <strong className="font-semibold">Error: </strong>
                        {validationError}
                    </div>
                )}

                {cache && !isValidating && (
                    <>
                        {activeTab === 'validation' && (
                            <div className="flex flex-col gap-4">
                                <div className="flex items-center justify-between gap-4 flex-wrap">
                                    <SummaryBar result={cache.validationResult} />
                                    <ExportButtons
                                        result={cache.validationResult}
                                        packageName={selectedPackage.displayName}
                                    />
                                </div>
                                <ManifestDiffPanel
                                    previous={cache.previousManifest}
                                    current={cache.manifest}
                                />
                                <IssueList result={cache.validationResult} />
                            </div>
                        )}
                        {activeTab === 'manifest' && <ManifestTab manifest={cache.manifest} />}
                        {activeTab === 'gdd' && <GddTab manifest={cache.manifest} />}
                        {activeTab === 'assets' && <AssetsTab assets={cache.assets} manifest={cache.manifest} />}
                        {activeTab === 'preview' && (
                            <PreviewFrame
                                swReady={swReady}
                                dirHandle={selectedPackage.dirHandle}
                                manifest={cache.manifest}
                                packagePath={selectedPackage.path}
                            />
                        )}
                    </>
                )}
            </div>
        </main>
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
                    ? 'border-ss-primary text-ss-text-1'
                    : 'border-transparent text-ss-text-2 hover:text-ss-text-1 hover:border-ss-border'}
                ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
            `}
        >
            {label}
            {badge && (
                <span className="px-1 py-0.5 rounded text-xs font-mono leading-none bg-red-950 text-red-400 border border-red-900">
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

function ValidityBadge({ valid }: { valid: boolean }) {
    return valid ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-ss-success/20 text-ss-success border border-ss-success/40">
            <span className="h-1.5 w-1.5 rounded-full bg-ss-success" />
            Valid
        </span>
    ) : (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-ss-error/20 text-ss-error border border-ss-error/40">
            <span className="h-1.5 w-1.5 rounded-full bg-ss-error" />
            Invalid
        </span>
    );
}

function SummaryBar({ result }: { result: ValidationResult }) {
    const parts: React.ReactNode[] = [];
    if (result.errors.length > 0) parts.push(<span key="e" className="text-ss-error">{result.errors.length} error{result.errors.length !== 1 ? 's' : ''}</span>);
    if (result.warnings.length > 0) parts.push(<span key="w" className="text-ss-secondary">{result.warnings.length} warning{result.warnings.length !== 1 ? 's' : ''}</span>);
    if (result.infos.length > 0) parts.push(<span key="i" className="text-ss-primary">{result.infos.length} info{result.infos.length !== 1 ? 's' : ''}</span>);
    if (parts.length === 0) return <p className="text-sm text-ss-success">No issues found.</p>;

    return <p className="text-sm text-ss-text-2 flex flex-wrap gap-x-3">{parts.map((p, i) => <span key={i}>{p}</span>)}</p>;
}

function WelcomeScreen() {
    return (
        <main className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-sm">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-ss-dark-1 border border-ss-border">
                    <PackageIcon />
                </div>
                <h2 className="text-xl font-semibold text-ss-text-1 mb-2">OGraf Validator</h2>
                <p className="text-sm text-ss-text-2 leading-relaxed mb-4">
                    Open a directory containing one or more OGraf Graphics Packages to validate them against the EBU OGraf specification.
                </p>
                <p className="text-xs text-ss-text-2/60">
                    Requires a Chromium-based browser (Chrome, Edge) for the File System Access API.
                </p>
            </div>
        </main>
    );
}

function Spinner() {
    return (
        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
    );
}

function PackageIcon() {
    return (
        <svg className="h-8 w-8 text-ss-text-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
        </svg>
    );
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

    return (
        <div className="flex gap-2">
            <button
                onClick={() => downloadJson(result, slug)}
                className="px-2.5 py-1 rounded text-xs font-medium bg-ss-dark-1 hover:bg-ss-grey text-ss-text-2 hover:text-ss-text-1 border border-ss-border transition-colors"
                title="Download validation result as JSON"
            >
                Export JSON
            </button>
            <button
                onClick={() => downloadHtml(result, packageName)}
                className="px-2.5 py-1 rounded text-xs font-medium bg-ss-dark-1 hover:bg-ss-grey text-ss-text-2 hover:text-ss-text-1 border border-ss-border transition-colors"
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
