import { CheckCircle2 } from 'lucide-react';
import type { ValidationIssue, ValidationResult } from '@streamshapers/ograf-validator-core';

interface Props {
    result: ValidationResult;
}

export default function IssueList({ result }: Props) {
    if (result.issues.length === 0) {
        return (
            <div className="flex items-center gap-2 px-4 py-3 rounded text-ss-success text-sm"
                 style={{ border: '1px solid rgba(23, 166, 90, 0.2)', background: 'rgba(23, 166, 90, 0.06)' }}>
                <CheckCircle2 size={16} />
                No issues found – the package is fully valid.
            </div>
        );
    }

    // Codes that are displayed elsewhere in the UI (title bar badge)
    const HIDDEN_CODES = new Set(['PACKAGE_FILE_COUNT', 'PACKAGE_TOTAL_SIZE']);

    // Flat list sorted by severity: errors → warnings → infos
    const allIssues: { issue: ValidationIssue; severity: 'error' | 'warning' | 'info' }[] = [
        ...result.errors.map((i) => ({ issue: i, severity: 'error' as const })),
        ...result.warnings.map((i) => ({ issue: i, severity: 'warning' as const })),
        ...result.infos.map((i) => ({ issue: i, severity: 'info' as const })),
    ].filter(({ issue }) => !HIDDEN_CODES.has(issue.code));

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
        <div
            className="flex gap-0 rounded overflow-hidden bg-ss-surface hover:bg-ss-surface-high transition-colors"
            style={{ border: '1px solid rgba(64, 72, 80, 0.35)', borderLeftColor: borderColor, borderLeftWidth: '3px' }}
        >
            <div className="flex-1 px-3 py-2.5 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {/* Severity badge */}
                    <span
                        className="px-1.5 py-px rounded text-[9px] font-semibold uppercase tracking-wider border font-mono"
                        style={{ color: badgeColor, background: `${badgeColor}18`, borderColor: `${badgeColor}40` }}
                    >
                        {badgeLabel}
                    </span>
                    {/* Issue code */}
                    <code className="text-[11px] font-mono font-semibold text-ss-on-surface">
                        {issue.code}
                    </code>
                </div>
                {/* Message */}
                <p className="text-xs text-ss-on-surface-variant leading-snug">{issue.message}</p>
            </div>
            {/* File path -- right side */}
            {issue.path && (
                <div className="flex-shrink-0 flex items-start px-3 py-2.5">
                    <span className="text-[10px] font-mono text-ss-on-surface-variant/60 truncate max-w-[160px]" title={issue.path}>
                        {issue.path}
                    </span>
                </div>
            )}
        </div>
    );
}

