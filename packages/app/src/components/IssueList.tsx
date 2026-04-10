import type { ValidationIssue, ValidationResult } from '@streamshapers/ograf-validator-core';

interface Props {
    result: ValidationResult;
}

export default function IssueList({ result }: Props) {
    if (result.issues.length === 0) {
        return (
            <div className="flex items-center gap-2 px-4 py-3 text-ss-success text-sm">
                <CheckIcon />
                No issues found – the package is fully valid.
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-1">
            {result.errors.length > 0 && (
                <IssueGroup label="Errors" issues={result.errors} severity="error" />
            )}
            {result.warnings.length > 0 && (
                <IssueGroup label="Warnings" issues={result.warnings} severity="warning" />
            )}
            {result.infos.length > 0 && (
                <IssueGroup label="Infos" issues={result.infos} severity="info" />
            )}
        </div>
    );
}

interface GroupProps {
    label: string;
    issues: ValidationIssue[];
    severity: 'error' | 'warning' | 'info';
}

function IssueGroup({ label, issues, severity }: GroupProps) {
    const headerClass = {
        error:   'text-ss-error    border-ss-error/30    bg-ss-error/10',
        warning: 'text-ss-secondary border-ss-secondary/30 bg-ss-secondary/10',
        info:    'text-ss-primary  border-ss-primary/30  bg-ss-primary/10',
    }[severity];

    return (
        <section className="rounded-md overflow-hidden border border-ss-border">
            <div className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide border-b border-ss-border ${headerClass}`}>
                {label} ({issues.length})
            </div>
            <ul className="divide-y divide-ss-border/40">
                {issues.map((issue, idx) => (
                    <IssueRow key={idx} issue={issue} severity={severity} />
                ))}
            </ul>
        </section>
    );
}

interface RowProps {
    issue: ValidationIssue;
    severity: 'error' | 'warning' | 'info';
}

function IssueRow({ issue, severity }: RowProps) {
    const dotClass = {
        error:   'bg-ss-error',
        warning: 'bg-ss-secondary',
        info:    'bg-ss-primary',
    }[severity];

    const codeClass = {
        error:   'text-ss-error    bg-ss-error/10',
        warning: 'text-ss-secondary bg-ss-secondary/10',
        info:    'text-ss-primary  bg-ss-primary/10',
    }[severity];

    return (
        <li className="px-3 py-2.5 flex gap-3 items-start text-sm hover:bg-ss-dark-1/50 transition-colors">
            <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${dotClass}`} />
            <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-0.5">
                    <code className={`text-xs px-1.5 py-0.5 rounded font-mono ${codeClass}`}>
                        {issue.code}
                    </code>
                    {issue.path && (
                        <span className="text-xs text-ss-text-2 font-mono truncate">{issue.path}</span>
                    )}
                </div>
                <p className="text-ss-text-1 leading-snug">{issue.message}</p>
            </div>
        </li>
    );
}

function CheckIcon() {
    return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
    );
}
