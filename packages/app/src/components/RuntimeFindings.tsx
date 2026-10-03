import type { RuntimeFailureGroup } from '../preview/runtime-diagnostics.js';
import { FailureDiagnostic } from './RuntimeTestCard.js';

export default function RuntimeFindings({ findings }: { findings: RuntimeFailureGroup[] }) {
    if (findings.length === 0) return null;

    return (
        <section aria-label="Runtime findings" className="space-y-3">
            <div>
                <h3 className="text-sm font-semibold text-ss-on-surface">
                    Runtime findings · {findings.length} {findings.length === 1 ? 'issue' : 'issues'}
                </h3>
                <p className="text-xs text-ss-on-surface-variant mt-1">
                    Each issue is shown once, even when several checks encounter it.
                </p>
            </div>
            {findings.map((failure) => <FailureDiagnostic key={failure.id} failure={failure} />)}
        </section>
    );
}
