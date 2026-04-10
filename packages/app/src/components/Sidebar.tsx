import type { ValidationResult } from '@streamshapers/ograf-validator-core';
import type { PackageEntry } from '../scanner/scan-packages.js';

interface Props {
    rootName: string | null;
    packages: PackageEntry[];
    selectedPath: string | null;
    validationResults: Record<string, ValidationResult>;
    isScanning: boolean;
    onOpenDirectory: () => void;
    onSelectPackage: (entry: PackageEntry) => void;
}

export default function Sidebar({
    rootName,
    packages,
    selectedPath,
    validationResults,
    isScanning,
    onOpenDirectory,
    onSelectPackage,
}: Props) {
    return (
        <aside className="w-64 flex-shrink-0 bg-ss-dark-2 border-r border-ss-border flex flex-col">
            {/* Open directory button */}
            <div className="p-3 border-b border-ss-border">
                <button
                    onClick={onOpenDirectory}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-ss-primary hover:bg-ss-primary-dark active:bg-ss-primary-dark text-ss-text-1 text-sm font-semibold transition-colors"
                >
                    <FolderOpenIcon />
                    Open Directory
                </button>
            </div>

            {/* Root label */}
            {rootName && (
                <div className="px-3 py-2 border-b border-ss-border">
                    <p className="text-xs text-ss-text-2 uppercase tracking-wide font-semibold mb-0.5">Directory</p>
                    <p className="text-sm text-ss-text-1 truncate font-mono" title={rootName}>{rootName}</p>
                </div>
            )}

            {/* Package list */}
            <div className="flex-1 overflow-y-auto">
                {isScanning ? (
                    <div className="flex items-center gap-2 px-3 py-4 text-sm text-ss-text-2">
                        <Spinner />
                        Scanning…
                    </div>
                ) : packages.length === 0 && rootName ? (
                    <p className="px-3 py-4 text-sm text-ss-text-2">No OGraf packages found.</p>
                ) : packages.length === 0 ? (
                    <EmptyHint />
                ) : (
                    <>
                        <div className="px-3 py-2">
                            <p className="text-xs text-ss-text-2 uppercase tracking-wide font-semibold">
                                Packages ({packages.length})
                            </p>
                        </div>
                        <ul>
                            {packages.map((entry) => (
                                <PackageItem
                                    key={entry.path}
                                    entry={entry}
                                    isSelected={selectedPath === entry.path}
                                    result={validationResults[entry.path]}
                                    onClick={() => onSelectPackage(entry)}
                                />
                            ))}
                        </ul>
                    </>
                )}
            </div>
        </aside>
    );
}

interface ItemProps {
    entry: PackageEntry;
    isSelected: boolean;
    result: ValidationResult | undefined;
    onClick: () => void;
}

function PackageItem({ entry, isSelected, result, onClick }: ItemProps) {
    const selectedClass = isSelected ? 'bg-ss-dark-1' : 'hover:bg-ss-dark-1/60';

    return (
        <li>
            <button
                onClick={onClick}
                className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors ${selectedClass}`}
            >
                <StatusDot result={result} />
                <div className="flex-1 min-w-0">
                    <p className="text-sm text-ss-text-1 truncate font-mono" title={entry.path}>
                        {entry.displayName}
                    </p>
                    {result && <IssueSummary result={result} />}
                </div>
            </button>
        </li>
    );
}

function StatusDot({ result }: { result: ValidationResult | undefined }) {
    if (!result) return <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-ss-grey" />;
    if (result.valid) return <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-ss-success" />;

    return <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-ss-error" />;
}

function IssueSummary({ result }: { result: ValidationResult }) {
    if (result.errors.length === 0 && result.warnings.length === 0 && result.infos.length === 0) {
        return <p className="text-xs text-ss-success">Valid</p>;
    }

    const parts: React.ReactNode[] = [];
    if (result.errors.length > 0) {
        const n = result.errors.length;
        parts.push(
            <span key="e" className="text-ss-error">{n} {n === 1 ? 'error' : 'errors'}</span>,
        );
    }
    if (result.warnings.length > 0) {
        const n = result.warnings.length;
        parts.push(
            <span key="w" className="text-ss-secondary">{n} {n === 1 ? 'warning' : 'warnings'}</span>,
        );
    }
    if (result.infos.length > 0) {
        const n = result.infos.length;
        parts.push(
            <span key="i" className="text-ss-primary">{n} {n === 1 ? 'info' : 'infos'}</span>,
        );
    }

    return (
        <p className="text-xs flex flex-wrap gap-x-1.5">
            {parts.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1.5">
                    {i > 0 && <span className="text-ss-text-2/40">·</span>}
                    {p}
                </span>
            ))}
        </p>
    );
}

function EmptyHint() {
    return (
        <div className="px-3 py-6 text-center">
            <p className="text-xs text-ss-text-2 leading-relaxed">
                Click <strong className="text-ss-text-1">Open Directory</strong> to select a folder containing an OGraf package.
            </p>
        </div>
    );
}

function FolderOpenIcon() {
    return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
        </svg>
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
