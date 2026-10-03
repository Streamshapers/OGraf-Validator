import { coverageIssueText, coverageModeText, deriveRuntimeCoverage } from '../readiness/runtime-coverage.js';
import type { RuntimeSuiteState, RuntimeTestResult } from '../preview/runtime-test-types.js';

export default function RuntimeCoverage({ manifest, standard, extended, phase }: {
    manifest: unknown; standard?: RuntimeTestResult; extended?: RuntimeSuiteState; phase?: string;
}) {
    const suites = deriveRuntimeCoverage(manifest, standard, extended, phase);
    return <section aria-label="Test coverage" className="rounded-sm border border-ss-outline-variant/30 bg-ss-surface p-3 sm:p-4">
        <h3 className="text-xs font-semibold text-ss-on-surface">Test coverage</h3>
        <p className="mt-1 text-[11px] text-ss-on-surface-variant">Recorded results, including retained findings. Steps are counted only after successful Play calls. Profiles show attempted Load configurations, not a profile matrix or visual verification.</p>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {suites.map((suite) => <div key={suite.suite} className="min-w-0 text-xs text-ss-on-surface-variant">
                <p className="font-semibold text-ss-on-surface">{suite.suite} · {suite.status}</p>
                <p className="mt-1">{coverageIssueText(suite)}</p>
                {suite.modes.map((mode) => <p key={mode.mode} className="mt-1 [overflow-wrap:anywhere]"><strong>{mode.mode}:</strong> {coverageModeText(suite, mode)}</p>)}
                <p className="mt-1">Custom actions: {suite.customActions.filter((action) => action.status !== 'Not run' && action.status !== 'Not recorded').length} of {suite.customActions.length} recorded as invoked</p>
                {suite.evidenceMissing && <p className="mt-1">Detailed call evidence is not available for this result.</p>}
                <details className="mt-2">
                    <summary className="cursor-pointer">Show check counts, steps and actions</summary>
                    <p className="mt-1">{suite.checks.pass} passed · {suite.checks.fail} failed · {suite.checks.warning} inconclusive · {suite.checks.skip} skipped checks</p>
                    {suite.modes.filter((mode) => mode.declared !== false).map((mode) => <p key={mode.mode} className="mt-1 [overflow-wrap:anywhere]">{mode.mode} step indices: {mode.steps.join(', ') || 'None recorded'}</p>)}
                    {suite.customActions.map((action, index) => <p key={`${index}-${action.id}`} className="mt-1 [overflow-wrap:anywhere]">{action.id}: {action.status}</p>)}
                </details>
            </div>)}
        </div>
    </section>;
}
