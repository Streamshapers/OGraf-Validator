import type { RuntimeTestStep } from '../preview/runtime-test-types.js';
import { explainRuntimeStep } from '../preview/runtime-explanation.js';

export default function RuntimeEvidence({ step, inputs = false }: { step: RuntimeTestStep; inputs?: boolean }) {
    const explanation = explainRuntimeStep(step);
    return <dl className="mt-3 space-y-2 rounded-sm bg-ss-surface-lowest p-3 text-xs text-ss-on-surface-variant">
        {explanation.expected && <div>
            <dt className="font-semibold text-ss-on-surface">Expected</dt>
            <dd className="mt-1 [overflow-wrap:anywhere]">{explanation.expected}</dd>
        </div>}
        <div>
            <dt className="font-semibold text-ss-on-surface">{explanation.expected ? 'Received' : 'Response'}</dt>
            <dd><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere]">{explanation.received}</pre></dd>
        </div>
        {inputs && <div>
            <dt className="font-semibold text-ss-on-surface">Call inputs{explanation.method ? ` · ${explanation.method}()` : ''}</dt>
            <dd><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere]">{explanation.parameters}</pre></dd>
        </div>}
    </dl>;
}
