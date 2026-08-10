import { useMemo, useState } from 'react';
import {
    AlertTriangle,
    ArrowLeft,
    ChevronDown,
    ChevronRight,
    Cpu,
    FileCode2,
    FileImage,
    FileJson,
    Info,
    Play,
    XCircle,
} from 'lucide-react';
import type { ValidationIssue, ValidationResult } from '@streamshapers/ograf-validator-core';
import ManifestTab from './ManifestTab.js';
import ManifestDiffPanel from './ManifestDiffPanel.js';
import GddTab from './GddTab.js';
import AssetsTab from './AssetsTab.js';
import {
    formatBooleanConstraint,
    formatDuration,
    formatNumberConstraint,
    readActionDurations,
    readCustomActions,
    readRenderRequirements,
    readThumbnails,
} from '../inspector/manifest-inspector.js';
import {
    groupInspectorIssues,
    type InspectorIssueGroups,
} from '../inspector/issue-context.js';

interface Props {
    manifest: unknown;
    previousManifest?: unknown;
    assets: string[];
    dirHandle: FileSystemDirectoryHandle;
    validationResult: ValidationResult;
    onShowValidation: () => void;
}

type InspectorView = 'overview' | 'data' | 'actions' | 'assets' | 'manifest';

interface InspectorSectionOption {
    id: InspectorView;
    label: string;
}

export default function InspectTab({
    manifest,
    previousManifest,
    assets,
    dirHandle,
    validationResult,
    onShowValidation,
}: Props) {
    const [activeView, setActiveView] = useState<InspectorView>('overview');
    const customActions = useMemo(() => readCustomActions(manifest), [manifest]);
    const durations = useMemo(() => readActionDurations(manifest), [manifest]);
    const thumbnails = useMemo(() => readThumbnails(manifest), [manifest]);
    const gddFieldCount = useMemo(() => countGddFields(manifest), [manifest]);
    const actionCount = customActions.length + durations.length;
    const issueGroups = useMemo(() => groupInspectorIssues(validationResult), [validationResult]);

    const sections: InspectorSectionOption[] = [
        { id: 'overview', label: 'Inspector overview' },
        { id: 'data', label: `Data schema (${gddFieldCount})` },
        { id: 'actions', label: `Actions (${actionCount})` },
        { id: 'assets', label: `Assets (${assets.length})` },
        { id: 'manifest', label: 'Manifest' },
    ];

    return (
        <div data-testid="inspect-layout" className="flex h-full min-w-0 flex-col bg-ss-surface-dim">
            <div data-testid="inspect-scroll-container" className="flex-1 overflow-y-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
                <div className="mx-auto w-full max-w-[1280px]">
                    {activeView === 'overview' && (
                        <InspectorOverview
                            manifest={manifest}
                            assets={assets}
                            gddFieldCount={gddFieldCount}
                            customActionCount={customActions.length}
                            durationCount={durations.length}
                            thumbnailCount={thumbnails.length}
                            issueGroups={issueGroups}
                            onNavigate={setActiveView}
                            onShowValidation={onShowValidation}
                        />
                    )}
                    {activeView === 'data' && (
                        <DetailView
                            activeView="data"
                            title="Data schema"
                            description="View GDD fields, default values, labels, and display options."
                            sections={sections}
                            issues={issueGroups.data}
                            onNavigate={setActiveView}
                            onShowValidation={onShowValidation}
                        >
                            <GddTab manifest={manifest} />
                        </DetailView>
                    )}
                    {activeView === 'actions' && (
                        <DetailView
                            activeView="actions"
                            title="Actions"
                            description="View custom actions and their durations."
                            sections={sections}
                            issues={issueGroups.actions}
                            onNavigate={setActiveView}
                            onShowValidation={onShowValidation}
                        >
                            <ActionsPanel manifest={manifest} showEmpty />
                        </DetailView>
                    )}
                    {activeView === 'assets' && (
                        <DetailView
                            activeView="assets"
                            title="Assets"
                            description="View thumbnails and all files in this package."
                            sections={sections}
                            issues={issueGroups.assets}
                            onNavigate={setActiveView}
                            onShowValidation={onShowValidation}
                        >
                            <AssetsTab assets={assets} manifest={manifest} dirHandle={dirHandle} />
                        </DetailView>
                    )}
                    {activeView === 'manifest' && (
                        <DetailView
                            activeView="manifest"
                            title="Manifest"
                            description="View the full manifest and changes since the last check."
                            sections={sections}
                            issues={issueGroups.manifest}
                            onNavigate={setActiveView}
                            onShowValidation={onShowValidation}
                        >
                            <ManifestTab manifest={manifest} />
                            {previousManifest !== undefined && previousManifest !== null && (
                                <div className="mt-4">
                                    <ManifestDiffPanel previous={previousManifest} current={manifest} />
                                </div>
                            )}
                        </DetailView>
                    )}
                </div>
            </div>
        </div>
    );
}

function InspectorOverview({
    manifest,
    assets,
    gddFieldCount,
    customActionCount,
    durationCount,
    thumbnailCount,
    issueGroups,
    onNavigate,
    onShowValidation,
}: {
    manifest: unknown;
    assets: string[];
    gddFieldCount: number;
    customActionCount: number;
    durationCount: number;
    thumbnailCount: number;
    issueGroups: InspectorIssueGroups;
    onNavigate: (view: InspectorView) => void;
    onShowValidation: () => void;
}) {
    const supportsRealTime = readManifestBoolean(manifest, 'supportsRealTime');
    const supportsNonRealTime = readManifestBoolean(manifest, 'supportsNonRealTime');
    const stepCount = readManifestNumber(manifest, 'stepCount');
    const main = readManifestString(manifest, 'main');

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h2 className="text-base font-semibold text-ss-on-surface">Inspector overview</h2>
                <p className="mt-1 text-xs leading-relaxed text-ss-on-surface-variant">
                    View the main settings and files in this package. Select a section for more details.
                </p>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <OverviewCard
                    icon={<Cpu size={16} />}
                    title="Capabilities"
                    issues={issueGroups.capabilities}
                    onShowValidation={onShowValidation}
                >
                    <div className="flex flex-wrap gap-1.5">
                        <CapabilityBadge label="Realtime" enabled={supportsRealTime} />
                        <CapabilityBadge label="Non-realtime" enabled={supportsNonRealTime} />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                        <OverviewValue label="Step count" value={stepCount === undefined ? 'Not declared' : String(stepCount)} />
                        <OverviewValue label="Main entry" value={main ?? 'Not declared'} mono />
                    </div>
                </OverviewCard>

                <OverviewCard
                    icon={<FileJson size={16} />}
                    title="Data schema"
                    actionLabel="Inspect schema"
                    onAction={() => onNavigate('data')}
                    issues={issueGroups.data}
                    onShowValidation={onShowValidation}
                >
                    <OverviewNumber value={gddFieldCount} label={gddFieldCount === 1 ? 'declared field' : 'declared fields'} />
                    <p className="mt-2 text-[11px] leading-relaxed text-ss-on-surface-variant">
                        Includes fields in objects and arrays, default values, labels, and display options.
                    </p>
                </OverviewCard>

                <div className="lg:col-span-2">
                    <RenderRequirementsPanel
                        manifest={manifest}
                        showEmpty
                        issues={issueGroups.render}
                        onShowValidation={onShowValidation}
                    />
                </div>

                <OverviewCard
                    icon={<Play size={16} />}
                    title="Actions"
                    actionLabel="Inspect actions"
                    onAction={() => onNavigate('actions')}
                    issues={issueGroups.actions}
                    onShowValidation={onShowValidation}
                >
                    <div className="grid grid-cols-2 gap-3">
                        <OverviewValue label="Custom actions" value={String(customActionCount)} />
                        <OverviewValue label="Action durations" value={String(durationCount)} />
                    </div>
                </OverviewCard>

                <OverviewCard
                    icon={<FileImage size={16} />}
                    title="Assets"
                    actionLabel="Inspect assets"
                    onAction={() => onNavigate('assets')}
                    issues={issueGroups.assets}
                    onShowValidation={onShowValidation}
                >
                    <div className="grid grid-cols-2 gap-3">
                        <OverviewValue label="Package files" value={String(assets.length)} />
                        <OverviewValue label="Thumbnails" value={String(thumbnailCount)} />
                    </div>
                </OverviewCard>

                <OverviewCard
                    icon={<FileCode2 size={16} />}
                    title="Manifest"
                    actionLabel="Inspect manifest"
                    onAction={() => onNavigate('manifest')}
                    className="lg:col-span-2"
                    issues={issueGroups.manifest}
                    onShowValidation={onShowValidation}
                >
                    <p className="text-[11px] leading-relaxed text-ss-on-surface-variant">
                        View the full manifest. If a file changed, you can also see the difference.
                    </p>
                </OverviewCard>
            </div>
        </div>
    );
}

function OverviewCard({
    icon,
    title,
    actionLabel,
    onAction,
    className = '',
    issues = [],
    onShowValidation,
    children,
}: {
    icon: React.ReactNode;
    title: string;
    actionLabel?: string;
    onAction?: () => void;
    className?: string;
    issues?: ValidationIssue[];
    onShowValidation?: () => void;
    children: React.ReactNode;
}) {
    return (
        <section className={`rounded bg-ss-surface p-3 sm:p-4 ${className}`}
                 style={{ border: `1px solid ${issueBorderColor(issues)}` }}>
            <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 text-ss-on-surface">
                    <span className="text-ss-primary-container">{icon}</span>
                    <h3 className="text-xs font-semibold">{title}</h3>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <ContextIssueBadges issues={issues} onShowValidation={onShowValidation} />
                    {actionLabel && onAction && (
                        <button
                            type="button"
                            onClick={onAction}
                            className="inline-flex items-center gap-1 text-[10px] font-medium text-ss-primary-container hover:text-ss-on-surface transition-colors"
                        >
                            {actionLabel}
                            <ChevronRight size={11} />
                        </button>
                    )}
                </div>
            </div>
            {children}
        </section>
    );
}

function ContextIssueBadges({
    issues,
    onShowValidation,
}: {
    issues: ValidationIssue[];
    onShowValidation?: () => void;
}) {
    const counts = countIssues(issues);
    if (issues.length === 0) return null;

    const content = (
        <>
            {counts.errors > 0 && <IssueBadge count={counts.errors} label="error" tone="error" />}
            {counts.warnings > 0 && <IssueBadge count={counts.warnings} label="warning" tone="warning" />}
            {counts.infos > 0 && <IssueBadge count={counts.infos} label="note" tone="info" />}
        </>
    );

    if (!onShowValidation) return <span className="flex flex-wrap items-center gap-1">{content}</span>;
    return (
        <button
            type="button"
            onClick={onShowValidation}
            className="flex flex-wrap items-center justify-end gap-1 rounded focus:outline-none focus:ring-1 focus:ring-ss-primary-container"
            title="View in Validation"
            aria-label={`${formatIssueCounts(counts)}. View in Validation`}
        >
            {content}
        </button>
    );
}

function IssueBadge({ count, label, tone }: {
    count: number;
    label: 'error' | 'warning' | 'note';
    tone: 'error' | 'warning' | 'info';
}) {
    const colors = tone === 'error'
        ? 'border-ss-error/30 bg-ss-error/10 text-ss-error'
        : tone === 'warning'
            ? 'border-ss-warning/30 bg-ss-warning/10 text-ss-warning'
            : 'border-ss-primary-container/30 bg-ss-primary-container/10 text-ss-primary-container';
    return (
        <span className={`rounded-full border px-1.5 py-px font-mono text-[9px] font-semibold ${colors}`}>
            {count} {label}{count === 1 ? '' : 's'}
        </span>
    );
}

function ContextIssueSummary({ issues, onShowValidation }: {
    issues: ValidationIssue[];
    onShowValidation: () => void;
}) {
    if (issues.length === 0) return null;
    const counts = countIssues(issues);
    const tone = counts.errors > 0 ? 'error' : counts.warnings > 0 ? 'warning' : 'info';
    const Icon = tone === 'error' ? XCircle : tone === 'warning' ? AlertTriangle : Info;
    const colors = tone === 'error'
        ? 'border-ss-error/35 bg-ss-error/5 text-ss-error'
        : tone === 'warning'
            ? 'border-ss-warning/35 bg-ss-warning/5 text-ss-warning'
            : 'border-ss-primary-container/35 bg-ss-primary-container/5 text-ss-primary-container';

    return (
        <section aria-label="Issues in this Inspector section" className={`mb-4 rounded border px-3 py-2.5 ${colors}`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-2">
                    <Icon size={14} className="mt-0.5 flex-shrink-0" />
                    <div className="min-w-0">
                        <h3 className="text-xs font-semibold text-ss-on-surface">
                            {issues.length} {issues.length === 1 ? 'issue' : 'issues'} in this section
                        </h3>
                        <p className="mt-0.5 text-[10px] text-ss-on-surface-variant">
                            {formatIssueCounts(counts)}
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onShowValidation}
                    className="w-fit text-[10px] font-semibold text-current hover:text-ss-on-surface"
                >
                    View in Validation
                </button>
            </div>
        </section>
    );
}

interface IssueCounts {
    errors: number;
    warnings: number;
    infos: number;
}

function countIssues(issues: ValidationIssue[]): IssueCounts {
    return {
        errors: issues.filter((issue) => issue.severity === 'error').length,
        warnings: issues.filter((issue) => issue.severity === 'warning').length,
        infos: issues.filter((issue) => issue.severity === 'info').length,
    };
}

function formatIssueCounts(counts: IssueCounts): string {
    const parts = [
        counts.errors > 0 ? `${counts.errors} error${counts.errors === 1 ? '' : 's'}` : undefined,
        counts.warnings > 0 ? `${counts.warnings} warning${counts.warnings === 1 ? '' : 's'}` : undefined,
        counts.infos > 0 ? `${counts.infos} note${counts.infos === 1 ? '' : 's'}` : undefined,
    ].filter((part): part is string => part !== undefined);
    return parts.join(', ');
}

function issueBorderColor(issues: ValidationIssue[]): string {
    if (issues.some((issue) => issue.severity === 'error')) return 'rgba(204, 86, 98, 0.45)';
    if (issues.some((issue) => issue.severity === 'warning')) return 'rgba(226, 176, 111, 0.45)';
    if (issues.some((issue) => issue.severity === 'info')) return 'rgba(75, 161, 226, 0.4)';
    return 'var(--ss-border-subtle)';
}

function CapabilityBadge({ label, enabled }: { label: string; enabled: boolean | undefined }) {
    const tone = enabled === true
        ? 'border-ss-success/30 bg-ss-success/10 text-ss-success'
        : enabled === false
            ? 'border-ss-outline-variant/40 bg-ss-surface-high text-ss-on-surface-variant'
            : 'border-ss-warning/30 bg-ss-warning/10 text-ss-warning';
    return (
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone}`}>
            {label}: {enabled === undefined ? 'not declared' : enabled ? 'supported' : 'not supported'}
        </span>
    );
}

function OverviewValue({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-ss-on-surface-variant/70">{label}</p>
            <p className={`mt-1 truncate text-xs text-ss-on-surface ${mono ? 'font-mono' : 'font-semibold'}`} title={value}>
                {value}
            </p>
        </div>
    );
}

function OverviewNumber({ value, label }: { value: number; label: string }) {
    return (
        <div className="flex items-baseline gap-2">
            <strong className="text-xl font-semibold font-mono text-ss-primary-container">{value}</strong>
            <span className="text-xs text-ss-on-surface-variant">{label}</span>
        </div>
    );
}

function DetailView({
    activeView,
    title,
    description,
    sections,
    issues,
    onNavigate,
    onShowValidation,
    children,
}: {
    activeView: Exclude<InspectorView, 'overview'>;
    title: string;
    description: string;
    sections: InspectorSectionOption[];
    issues: ValidationIssue[];
    onNavigate: (view: InspectorView) => void;
    onShowValidation: () => void;
    children: React.ReactNode;
}) {
    return (
        <section>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                    <button
                        type="button"
                        onClick={() => onNavigate('overview')}
                        className="inline-flex items-center gap-1 text-[10px] font-medium text-ss-primary-container transition-colors hover:text-ss-on-surface"
                    >
                        <ArrowLeft size={11} />
                        Inspector overview
                    </button>
                    <h2 className="mt-2 text-base font-semibold text-ss-on-surface">{title}</h2>
                    <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ss-on-surface-variant">{description}</p>
                </div>

                <label className="relative block w-full flex-shrink-0 sm:w-auto">
                    <span className="sr-only">Change inspector section</span>
                    <select
                        aria-label="Change inspector section"
                        value={activeView}
                        onChange={(event) => onNavigate(event.target.value as InspectorView)}
                        className="h-8 w-full appearance-none rounded border border-ss-outline-variant/50 bg-ss-surface px-3 pr-8 text-[11px] font-medium text-ss-on-surface outline-none transition-colors hover:border-ss-outline focus:border-ss-primary-container sm:min-w-48"
                    >
                        {sections.map((section) => (
                            <option key={section.id} value={section.id}>{section.label}</option>
                        ))}
                    </select>
                    <ChevronDown
                        size={12}
                        aria-hidden="true"
                        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ss-on-surface-variant"
                    />
                </label>
            </div>
            <ContextIssueSummary issues={issues} onShowValidation={onShowValidation} />
            {children}
        </section>
    );
}

function InspectorSection({ title, icon, issues = [], onShowValidation, children }: {
    title: string;
    icon?: React.ReactNode;
    issues?: ValidationIssue[];
    onShowValidation?: () => void;
    children: React.ReactNode;
}) {
    return (
        <section
            className="rounded bg-ss-surface p-3 sm:p-4"
            style={{ border: `1px solid ${issueBorderColor(issues)}` }}
        >
            <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ss-on-surface-variant">
                    {icon && <span className="text-ss-primary-container">{icon}</span>}
                    {title}
                </h3>
                <ContextIssueBadges issues={issues} onShowValidation={onShowValidation} />
            </div>
            {children}
        </section>
    );
}

function RenderRequirementsPanel({
    manifest,
    showEmpty = false,
    issues = [],
    onShowValidation,
}: {
    manifest: unknown;
    showEmpty?: boolean;
    issues?: ValidationIssue[];
    onShowValidation?: () => void;
}) {
    const requirements = readRenderRequirements(manifest);
    if (requirements.length === 0 && !showEmpty) return null;

    return (
        <InspectorSection
            title="Render requirements"
            icon={<Cpu size={12} />}
            issues={issues}
            onShowValidation={onShowValidation}
        >
            {requirements.length === 0 ? (
                <EmptyDetail message="This Graphic has no render requirements." />
            ) : (
                <>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        {requirements.map((requirement) => {
                            const width = formatNumberConstraint(requirement.resolution?.width);
                            const height = formatNumberConstraint(requirement.resolution?.height);
                            const frameRate = formatNumberConstraint(requirement.frameRate);
                            const internet = formatBooleanConstraint(requirement.accessToPublicInternet);

                            return (
                                <div key={requirement.index} className="rounded border border-ss-outline-variant/40 bg-ss-surface p-3">
                                    <div className="mb-2 flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                                        <span className="text-xs font-semibold text-ss-on-surface">
                                            Alternative {requirement.index + 1}
                                        </span>
                                        <span className="text-[9px] text-ss-on-surface-variant">any one may be satisfied</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                                        {(width || height) && (
                                            <RequirementValue
                                                label="Resolution"
                                                value={`${width ?? 'any'} × ${height ?? 'any'}`}
                                            />
                                        )}
                                        {frameRate && <RequirementValue label="Frame rate" value={`${frameRate} fps`} />}
                                        {internet && <RequirementValue label="Public internet" value={internet} />}
                                    </div>
                                    {requirement.engines.length > 0 && (
                                        <div className="mt-2 border-t border-ss-outline-variant/30 pt-2">
                                            <p className="mb-1 text-[9px] uppercase tracking-wide text-ss-on-surface-variant">Engines</p>
                                            <div className="flex flex-wrap gap-1">
                                                {requirement.engines.map((engine, index) => (
                                                    <span
                                                        key={`${engine.type}-${index}`}
                                                        className="rounded border border-ss-outline-variant/40 bg-ss-surface-high px-1.5 py-0.5 font-mono text-[10px] text-ss-on-surface"
                                                        title="The validator shows this version but does not check it."
                                                    >
                                                        {engine.type}{engine.minimumVersion ? ` ≥ ${engine.minimumVersion}` : ''}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <p className="mt-1.5 text-[9px] text-ss-on-surface-variant/60">
                        The validator shows engine versions but does not check them.
                    </p>
                </>
            )}
        </InspectorSection>
    );
}

function RequirementValue({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-wide text-ss-on-surface-variant/60">{label}</p>
            <p className="font-mono text-[11px] text-ss-on-surface [overflow-wrap:anywhere]" title={value}>{value}</p>
        </div>
    );
}

function ActionsPanel({ manifest, showEmpty = false }: { manifest: unknown; showEmpty?: boolean }) {
    const customActions = readCustomActions(manifest);
    const durations = readActionDurations(manifest);
    if (customActions.length === 0 && durations.length === 0) {
        return showEmpty ? <EmptyDetail message="No custom actions or action durations." /> : null;
    }
    const hasBothGroups = customActions.length > 0 && durations.length > 0;

    return (
        <div className={`grid grid-cols-1 gap-3 ${hasBothGroups ? 'lg:grid-cols-2' : ''}`}>
            {customActions.length > 0 && (
                <div className="rounded border border-ss-outline-variant/40 bg-ss-surface">
                    <div className="border-b border-ss-outline-variant/30 px-3 py-2 text-[9px] font-semibold uppercase tracking-wide text-ss-on-surface-variant">
                        Custom actions
                    </div>
                    <div className="divide-y divide-ss-outline-variant/20">
                        {customActions.map((action) => (
                            <div key={action.id} className="px-3 py-2.5">
                                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                                    <span className="text-xs font-semibold text-ss-on-surface">{action.name}</span>
                                    <span className="font-mono text-[10px] text-ss-on-surface-variant [overflow-wrap:anywhere]">{action.id}</span>
                                    {action.hasSchema && (
                                        <span className="w-fit rounded bg-ss-surface-high px-1.5 py-px text-[9px] text-ss-on-surface-variant sm:ml-auto">
                                            payload schema
                                        </span>
                                    )}
                                </div>
                                {action.description && (
                                    <p className="mt-1.5 text-[11px] leading-relaxed text-ss-on-surface-variant">{action.description}</p>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {durations.length > 0 && (
                <div className="rounded border border-ss-outline-variant/40 bg-ss-surface">
                    <div className="border-b border-ss-outline-variant/30 px-3 py-2 text-[9px] font-semibold uppercase tracking-wide text-ss-on-surface-variant">
                        Declared durations
                    </div>
                    <div className="divide-y divide-ss-outline-variant/20">
                        {durations.map((duration, index) => (
                            <div key={`${duration.type}-${duration.customActionId ?? ''}-${index}`} className="px-3 py-2.5">
                                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                                    <span className="font-mono text-[11px] text-ss-on-surface [overflow-wrap:anywhere]">
                                        {duration.type}
                                        {duration.customActionId ? ` · ${duration.customActionId}` : ''}
                                    </span>
                                    <span className="text-[11px] font-semibold text-ss-primary-container">
                                        {formatDuration(duration.duration)}
                                    </span>
                                </div>
                                {duration.steps.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                        {duration.steps.map((step, stepIndex) => (
                                            <span
                                                key={`${step.step ?? 'fallback'}-${stepIndex}`}
                                                className="rounded bg-ss-surface-high px-1.5 py-px font-mono text-[9px] text-ss-on-surface-variant"
                                            >
                                                {step.step === undefined ? 'fallback' : `step ${step.step}`}: {formatDuration(step.duration)}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function EmptyDetail({ message }: { message: string }) {
    return (
        <div className="rounded border border-ss-outline-variant/30 bg-ss-surface px-4 py-6 text-center text-xs text-ss-on-surface-variant">
            {message}
        </div>
    );
}

function countGddFields(manifest: unknown): number {
    if (!isRecord(manifest)) return 0;
    const schema = manifest['schema'];
    if (!isRecord(schema)) return 0;
    return countPropertyTree(schema['properties']);
}

function countPropertyTree(value: unknown): number {
    if (!isRecord(value)) return 0;
    return Object.values(value).reduce<number>((count, field) => {
        if (!isRecord(field)) return count;
        const nestedProperties = countPropertyTree(field['properties']);
        const items = field['items'];
        const nestedItems = isRecord(items) ? countPropertyTree(items['properties']) : 0;
        return count + 1 + nestedProperties + nestedItems;
    }, 0);
}

function readManifestBoolean(manifest: unknown, key: string): boolean | undefined {
    if (!isRecord(manifest)) return undefined;
    const value = manifest[key];
    return typeof value === 'boolean' ? value : undefined;
}

function readManifestNumber(manifest: unknown, key: string): number | undefined {
    if (!isRecord(manifest)) return undefined;
    const value = manifest[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readManifestString(manifest: unknown, key: string): string | undefined {
    if (!isRecord(manifest)) return undefined;
    const value = manifest[key];
    return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
