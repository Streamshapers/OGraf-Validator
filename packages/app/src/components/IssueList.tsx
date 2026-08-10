import type { ValidationIssue, ValidationResult } from '@streamshapers/ograf-validator-core';

interface Props {
    result: ValidationResult;
}

export default function IssueList({ result }: Props) {
    // Codes that are displayed elsewhere in the UI (title bar badge)
    const HIDDEN_CODES = new Set(['PACKAGE_FILE_COUNT', 'PACKAGE_TOTAL_SIZE']);

    // Flat list sorted by severity: errors → warnings → infos
    const allIssues: { issue: ValidationIssue; severity: 'error' | 'warning' | 'info' }[] = [
        ...result.errors.map((i) => ({ issue: i, severity: 'error' as const })),
        ...result.warnings.map((i) => ({ issue: i, severity: 'warning' as const })),
        ...result.infos.map((i) => ({ issue: i, severity: 'info' as const })),
    ].filter(({ issue }) => !HIDDEN_CODES.has(issue.code));

    if (allIssues.length === 0) return null;

    return (
        <div className="flex flex-col gap-1">
            {allIssues.map(({ issue, severity }, idx) => (
                <IssueCard key={idx} issue={issue} severity={severity} />
            ))}
        </div>
    );
}

interface CardProps {
    issue: ValidationIssue;
    severity: 'error' | 'warning' | 'info';
}

function IssueCard({ issue, severity }: CardProps) {
    const borderColor = {
        error:   '#cc5662',
        warning: '#e2b06f',
        info:    '#94ccff',
    }[severity];

    const badgeColor = {
        error:   '#cc5662',
        warning: '#e2b06f',
        info:    '#4ba1e2',
    }[severity];

    const badgeLabel = {
        error:   'ERROR',
        warning: 'WARNING',
        info:    'INFO',
    }[severity];

    return (
        <article
            className="rounded overflow-hidden bg-ss-surface hover:bg-ss-surface-high transition-colors"
            style={{ border: '1px solid rgba(64, 72, 80, 0.35)', borderLeftColor: borderColor, borderLeftWidth: '3px' }}
        >
            <div className="px-3 sm:px-4 py-3 min-w-0">
                <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <span
                            className="px-1.5 py-px rounded text-[9px] font-semibold uppercase tracking-wider border font-mono"
                            style={{ color: badgeColor, background: `${badgeColor}18`, borderColor: `${badgeColor}40` }}
                        >
                            {badgeLabel}
                        </span>
                        <code className="text-[11px] font-mono font-semibold text-ss-on-surface [overflow-wrap:anywhere]">
                            {issue.code}
                        </code>
                    </div>
                    {issue.path && (
                        <code className="max-w-full text-[10px] font-mono text-ss-on-surface-variant/60 [overflow-wrap:anywhere] sm:max-w-[40%] sm:text-right"
                              title={issue.path}>
                            {issue.path}
                        </code>
                    )}
                </div>
                <p className="text-[13px] sm:text-xs text-ss-on-surface-variant leading-relaxed [overflow-wrap:anywhere]">{issue.message}</p>
            </div>
        </article>
    );
}

