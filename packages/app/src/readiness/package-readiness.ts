import type { ValidationResult } from '@streamshapers/ograf-validator-core';
import { groupRuntimeFailures } from '../preview/runtime-diagnostics.js';
import type { RuntimeTestResult } from '../preview/runtime-test-types.js';

export type PackageReadinessStatus =
    | 'static-invalid'
    | 'runtime-pending'
    | 'runtime-running'
    | 'runtime-failed'
    | 'needs-review'
    | 'production-ready';

export type RuntimeReadinessStatus =
    | 'not-run'
    | 'pending'
    | 'running'
    | 'failed'
    | 'inconclusive'
    | 'passed';

export type RuntimeTestPhase = 'pending' | 'running';

export interface PackageReadiness {
    status: PackageReadinessStatus;
    label: string;
    runtimeStatus: RuntimeReadinessStatus;
    runtimeLabel: string;
    staticErrors: number;
    staticWarnings: number;
    runtimeErrors: number;
    runtimeWarnings: number;
    totalIssues: number;
    staticScore: number;
    productionReady: boolean;
}

export function derivePackageReadiness(
    validation: ValidationResult,
    runtimeResult?: RuntimeTestResult,
    runtimePhase?: RuntimeTestPhase,
): PackageReadiness {
    const staticErrors = validation.errors.length;
    const staticWarnings = validation.warnings.length;
    const staticInvalid = !validation.valid || staticErrors > 0;
    const evaluatedRuntimeResult = runtimePhase ? undefined : runtimeResult;
    const failedSteps = evaluatedRuntimeResult?.steps.filter((step) => step.status === 'fail').length ?? 0;
    const runtimeFailureIssues = groupRuntimeFailures(evaluatedRuntimeResult?.steps ?? []).length;
    const warningSteps = evaluatedRuntimeResult?.steps.filter((step) => step.status === 'warning').length ?? 0;
    const runtimeFailed = evaluatedRuntimeResult !== undefined && (!evaluatedRuntimeResult.passed || failedSteps > 0);
    const runtimeErrors = !staticInvalid && runtimeFailed
        ? Math.max(1, runtimeFailureIssues)
        : 0;
    const runtimeWarnings = staticInvalid
        ? 0
        : evaluatedRuntimeResult?.inconclusive
            ? Math.max(1, warningSteps)
            : warningSteps;
    const totalIssues = staticErrors + staticWarnings + runtimeErrors + runtimeWarnings;
    const staticScore = Math.max(0, 100 - Math.min(100, staticErrors * 15 + staticWarnings * 5));

    let status: PackageReadinessStatus;
    let runtimeStatus: RuntimeReadinessStatus;

    if (staticInvalid) {
        status = 'static-invalid';
        runtimeStatus = 'not-run';
    } else if (runtimePhase === 'running') {
        status = 'runtime-running';
        runtimeStatus = 'running';
    } else if (runtimePhase === 'pending') {
        status = 'runtime-pending';
        runtimeStatus = 'pending';
    } else if (!evaluatedRuntimeResult) {
        status = 'runtime-pending';
        runtimeStatus = 'pending';
    } else if (runtimeFailed) {
        status = 'runtime-failed';
        runtimeStatus = 'failed';
    } else if (evaluatedRuntimeResult.inconclusive || runtimeWarnings > 0 || staticWarnings > 0) {
        status = 'needs-review';
        runtimeStatus = evaluatedRuntimeResult.inconclusive || runtimeWarnings > 0 ? 'inconclusive' : 'passed';
    } else {
        status = 'production-ready';
        runtimeStatus = 'passed';
    }

    return {
        status,
        label: readinessLabel(status),
        runtimeStatus,
        runtimeLabel: runtimeLabel(runtimeStatus),
        staticErrors,
        staticWarnings,
        runtimeErrors,
        runtimeWarnings,
        totalIssues,
        staticScore,
        productionReady: status === 'production-ready',
    };
}

function readinessLabel(status: PackageReadinessStatus): string {
    switch (status) {
        case 'static-invalid': return 'Not Production-Ready';
        case 'runtime-pending': return 'Assessment Pending';
        case 'runtime-running': return 'Assessment Running';
        case 'runtime-failed': return 'Not Production-Ready';
        case 'needs-review': return 'Needs Review';
        case 'production-ready': return 'Production-Ready';
    }
}

function runtimeLabel(status: RuntimeReadinessStatus): string {
    switch (status) {
        case 'not-run': return 'Not Run';
        case 'pending': return 'Pending';
        case 'running': return 'Running';
        case 'failed': return 'Failed';
        case 'inconclusive': return 'Inconclusive';
        case 'passed': return 'Passed';
    }
}
