import type { RuntimeFailureGroup } from '../preview/runtime-diagnostics.js';
import type { RuntimeTestSuite } from '../preview/runtime-test-types.js';

export default function RuntimeFindingLinks({ findings, suite }: {
    findings: RuntimeFailureGroup[];
    suite: RuntimeTestSuite;
}) {
    const relevant = findings.filter((finding) => finding.occurrences.some(({ step }) => (
        (step.suite ?? 'standard') === suite
    )));
    if (relevant.length === 0) return null;

    return <div className="text-xs text-ss-on-surface-variant space-y-1">
        <p>{relevant.length} {relevant.length === 1 ? 'issue' : 'issues'} found. See shared findings above:</p>
        {relevant.map((finding) => (
            <a key={finding.id} href={`#${finding.id}`}
                className="block text-ss-primary-container hover:underline [overflow-wrap:anywhere]">
                {finding.label}
            </a>
        ))}
    </div>;
}
