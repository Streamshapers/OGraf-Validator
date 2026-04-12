import { useState, useEffect } from 'react';
import { Settings, Loader2, FolderOpen } from 'lucide-react';
import type { ValidationResult } from '@streamshapers/ograf-validator-core';
import type { PackageEntry } from '../scanner/scan-packages.js';
import type { RuntimeTestResult } from '../preview/runtime-test-types.js';

interface RuntimeInfo { result?: RuntimeTestResult; running?: boolean }

interface Props {
    rootName: string | null;
    packages: PackageEntry[];
    selectedPath: string | null;
    validationResults: Record<string, ValidationResult>;
    runtimeResults?: Record<string, RuntimeInfo>;
    isScanning: boolean;
    onOpenDirectory: () => void;
    onSelectPackage: (entry: PackageEntry) => void;
    isSettingsActive: boolean;
    onOpenSettings: () => void;
    onShowOverview: () => void;
}

type StatusFilter = 'all' | 'errors' | 'warnings' | 'valid';

export default function Sidebar({
    rootName,
    packages,
    selectedPath,
    validationResults,
    runtimeResults,
    isScanning,
    onOpenDirectory,
    onSelectPackage,
    isSettingsActive,
    onOpenSettings,
    onShowOverview,
}: Props) {
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

    // Reset filter when directory changes
    useEffect(() => {
        setStatusFilter('all');
    }, [rootName]);

    const filteredPackages = packages.filter((entry) => {
        if (statusFilter === 'all') return true;
        const result = validationResults[entry.path];
        if (!result) return false;
        if (statusFilter === 'errors') return result.errors.length > 0;
        if (statusFilter === 'warnings') return result.warnings.length > 0 && result.errors.length === 0;
        if (statusFilter === 'valid') return result.valid && result.warnings.length === 0;
        return true;
    });

    const isFiltered = statusFilter !== 'all';
    const countLabel = isFiltered
        ? `${filteredPackages.length}/${packages.length}`
        : String(packages.length);

    return (
        <aside className="w-60 flex-shrink-0 bg-ss-surface-lowest flex flex-col"
               style={{ borderRight: '1px solid var(--ss-border-subtle)' }}>

            {/* PROJECT section */}
            {rootName ? (
                <button
                    onClick={onShowOverview}
                    className="w-full text-left px-3 pt-3 pb-2.5 hover:bg-ss-surface-high/50 transition-colors group"
                    style={{ borderBottom: '1px solid var(--ss-border-subtle)' }}
                    title="Back to package overview"
                >
                    <p className="text-[9px] font-semibold text-ss-on-surface-variant uppercase tracking-[0.1em] mb-1">Project</p>
                    <p className="text-xs font-mono text-ss-on-surface truncate group-hover:text-ss-primary-container transition-colors" title={rootName}>{rootName}</p>
                </button>
            ) : null}

            {/* ACTIVE PACKAGES header */}
            <div className="px-3 pt-3 pb-1">
                <span className="text-[9px] font-semibold text-ss-on-surface-variant uppercase tracking-[0.1em]">
                    Active Packages ({countLabel})
                </span>
            </div>

            {/* Status filter chips */}
            {packages.length > 0 && (
                <div className="flex gap-1 px-2 pb-1.5">
                    {(['all', 'errors', 'warnings', 'valid'] as const).map((status) => (
                        <StatusChip
                            key={status}
                            label={status}
                            active={statusFilter === status}
                            onClick={() => setStatusFilter(status)}
                        />
                    ))}
                </div>
            )}

            {/* Package list */}
            <div className="flex-1 overflow-y-auto">
                {isScanning ? (
                    <div className="flex items-center gap-2 px-3 py-3 text-xs text-ss-on-surface-variant">
                        <Loader2 size={14} className="animate-spin" />
                        Scanning…
                    </div>
                ) : packages.length === 0 && rootName ? (
                    <p className="px-3 py-3 text-xs text-ss-on-surface-variant">No OGraf packages found.</p>
                ) : packages.length === 0 ? (
                    <button
                        onClick={onOpenDirectory}
                        className="w-full px-3 py-3 text-left flex items-center gap-2 text-xs text-ss-on-surface-variant hover:text-ss-on-surface transition-colors"
                    >
                        <FolderOpen size={13} />
                        Open a directory…
                    </button>
                ) : filteredPackages.length === 0 ? (
                    <p className="px-3 py-3 text-xs text-ss-on-surface-variant">No matches.</p>
                ) : (
                    <ul className="flex flex-col gap-0.5 px-1 py-1">
                        {filteredPackages.map((entry) => (
                            <PackageItem
                                key={entry.path}
                                entry={entry}
                                isSelected={selectedPath === entry.path}
                                result={validationResults[entry.path]}
                                runtimeInfo={runtimeResults?.[entry.path]}
                                onClick={() => onSelectPackage(entry)}
                            />
                        ))}
                    </ul>
                )}
            </div>

            {/* Footer: system settings */}
            <button
                onClick={onOpenSettings}
                className={`w-full px-3 py-2.5 flex items-center gap-1.5 cursor-pointer transition-colors
                    ${isSettingsActive ? 'bg-ss-surface-high' : 'hover:bg-ss-surface-high/40'}`}
                style={{ borderTop: '1px solid var(--ss-border-subtle)' }}
            >
                <Settings size={12} className="text-ss-on-surface-variant/50 flex-shrink-0" />
                <span className="text-[10px] font-semibold text-ss-on-surface-variant uppercase tracking-[0.08em]">
                    System Settings
                </span>
            </button>
        </aside>
    );
}

// ─── Status chip ──────────────────────────────────────────────────────────────

function StatusChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-wider font-semibold transition-colors
                ${active
                    ? 'bg-ss-surface-high text-ss-on-surface'
                    : 'text-ss-on-surface-variant/50 hover:bg-ss-surface-high/50 hover:text-ss-on-surface-variant'}
            `}
        >
            {label}
        </button>
    );
}

// ─── Package item ─────────────────────────────────────────────────────────────

interface ItemProps {
    entry: PackageEntry;
    isSelected: boolean;
    result: ValidationResult | undefined;
    runtimeInfo?: RuntimeInfo;
    onClick: () => void;
}

function PackageItem({ entry, isSelected, result, runtimeInfo, onClick }: ItemProps) {
    return (
        <li>
            <button
                onClick={onClick}
                className={`
                    w-full text-left px-2 py-1.5 rounded flex items-center gap-2 transition-colors
                    ${isSelected
                        ? 'bg-ss-surface-high border-l-2 border-ss-primary-container pl-[6px]'
                        : 'hover:bg-ss-surface-highest border-l-2 border-transparent pl-[6px]'}
                `}
            >
                <StatusDot result={result} runtimeInfo={runtimeInfo} />
                <div className="flex-1 min-w-0 flex items-center justify-between gap-1">
                    <p className="text-xs text-ss-on-surface truncate font-mono leading-snug" title={entry.path}>
                        {entry.displayName}
                    </p>
                    <ErrorCount result={result} />
                </div>
            </button>
        </li>
    );
}

function StatusDot({ result, runtimeInfo }: { result: ValidationResult | undefined; runtimeInfo?: RuntimeInfo }) {
    if (!result) {
        return <span className="h-2 w-2 flex-shrink-0 rounded-full bg-ss-on-surface-variant/30" />;
    }
    if (result.errors.length > 0) {
        return <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: '#cc5662' }} />;
    }
    // Runtime test failed → red even if statically valid
    if (runtimeInfo?.result && !runtimeInfo.result.passed) {
        return <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: '#cc5662' }} />;
    }
    if (result.warnings.length > 0) {
        return <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: '#e2b06f' }} />;
    }
    // Runtime test still running → green with pulse
    if (runtimeInfo?.running) {
        return <span className="h-2 w-2 flex-shrink-0 rounded-full animate-pulse" style={{ backgroundColor: '#28af62' }} />;
    }
    if (result.valid) {
        return <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: '#28af62' }} />;
    }
    return <span className="h-2 w-2 flex-shrink-0 rounded-full bg-ss-on-surface-variant/30" />;
}

function ErrorCount({ result }: { result: ValidationResult | undefined }) {
    if (!result) return null;
    if (result.errors.length > 0) {
        return (
            <span className="text-[10px] font-semibold font-mono flex-shrink-0" style={{ color: '#cc5662' }}>
                {result.errors.length}
            </span>
        );
    }
    if (result.warnings.length > 0) {
        return (
            <span className="text-[10px] font-semibold font-mono flex-shrink-0" style={{ color: '#e2b06f' }}>
                {result.warnings.length}
            </span>
        );
    }
    return null;
}
