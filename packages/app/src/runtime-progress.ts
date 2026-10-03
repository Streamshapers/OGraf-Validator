import type { PackageCache } from './components/ContentArea.js';
import { derivePackageReadiness } from './readiness/package-readiness.js';

export interface RuntimeProgress {
    done: number;
    total: number;
    failed: number;
    inconclusive: number;
}

/** Count each package once across its standard and optional extended suites. */
export function deriveRuntimeProgress(entries: readonly PackageCache[]): RuntimeProgress | null {
    const scheduled = entries.filter((entry) => entry.runtimeTest || entry.runtimeTestPhase);
    if (scheduled.length === 0) return null;

    const done = scheduled.filter((entry) => entry.runtimeTest
        && !entry.runtimeTestPhase && !entry.extendedRuntimeTest?.active).length;
    const readiness = scheduled.map((entry) => derivePackageReadiness(
        entry.validationResult, entry.runtimeTest, entry.runtimeTestPhase, entry.extendedRuntimeTest,
    ));

    return {
        done,
        total: scheduled.length,
        failed: readiness.filter((entry) => entry.status === 'runtime-failed').length,
        inconclusive: readiness.filter((entry) => entry.runtimeStatus === 'inconclusive').length,
    };
}
