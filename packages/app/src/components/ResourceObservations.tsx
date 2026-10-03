import { getResourceObservations, resourceCategory } from '../preview/resource-diagnostics.js';
import { diagnoseRuntimeError } from '../preview/runtime-diagnostics.js';
import type { RuntimeSuiteState, RuntimeTestResult } from '../preview/runtime-test-types.js';
import SpecReferenceLink from './SpecReferenceLink.js';

export default function ResourceObservations({ standard, extended }: {
    standard?: RuntimeTestResult; extended?: RuntimeSuiteState;
}) {
    const groups = getResourceObservations(standard, extended);
    if (!groups.length) return null;
    return <section aria-label="Resource observations" className="rounded-sm border border-ss-warning/30 p-3 sm:p-4 space-y-3">
        <h3 className="text-sm font-semibold">Resources requiring review · {groups.length}</h3>
        <p className="text-xs text-ss-on-surface-variant">Observed load failures or preview restrictions. These do not by themselves establish an OGraf violation. Successful calls do not verify visual output.</p>
        {groups.map((group) => {
            const first = group.observations.find(({ step }) => step.diagnostic?.reason === group.reason)!.step;
            const diagnostic = diagnoseRuntimeError(first.error, first.diagnostic);
            return <article key={JSON.stringify([group.resource, group.reason])} className="text-xs space-y-2 [overflow-wrap:anywhere]">
                <p className="font-semibold">{resourceCategory(group.reason)} · <code>{group.resource}</code></p>
                <p>{group.observations.length} observations · {[...new Set(group.observations.map((item) => item.suite))].join(' and ')}</p>
                <p>{first.error}</p><p>{diagnostic.hint}</p>
                <SpecReferenceLink reference={diagnostic.specRef} />
                <details><summary className="cursor-pointer">Show resource observations</summary>
                    {group.observations.map(({ suite, step }, index) => <p key={index} className="mt-2">{suite} · {step.renderMode ?? 'Mode not recorded'} · {step.scenarioId ?? step.name}: {step.error}</p>)}
                    <p className="mt-2">Initiating source file and line are not reliably available from this browser observation.</p>
                </details>
                <button className="underline" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(group, null, 2))}>Copy resource details</button>
            </article>;
        })}
    </section>;
}
