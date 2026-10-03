import type { ValidationResult } from '@streamshapers/ograf-validator-core';
import { getRuntimeFindings } from '../preview/runtime-findings.js';
import type { RuntimeSuiteState, RuntimeTestResult } from '../preview/runtime-test-types.js';
import { getRuntimeSuiteResult, isConclusiveRuntimeResult } from '../preview/runtime-suite-state.js';

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
    runtimeCoverageIncomplete: boolean;
    totalIssues: number;
    staticScore: number;
    productionReady: boolean;
}

export function derivePackageReadiness(
    validation: ValidationResult,
    runtimeResult?: RuntimeTestResult,
    runtimePhase?: RuntimeTestPhase,
    extendedState?: RuntimeSuiteState,
): PackageReadiness {
    const staticErrors = validation.errors.length;
    const staticWarnings = validation.warnings.length;
    const staticInvalid = !validation.valid || staticErrors > 0;
    const extendedResult = getRuntimeSuiteResult(extendedState);
    const results = [runtimeResult, extendedResult]
        .filter((result): result is RuntimeTestResult => result !== undefined);
    const steps = results.flatMap((result) => result.steps);
    const failedSteps = steps.filter((step) => step.status === 'fail').length;
    const runtimeFailureIssues = getRuntimeFindings(runtimeResult, extendedState).length;
    const coverageSteps = steps.filter((step) => step.status === 'warning'
        && ['blocked-dependent-checks', 'blocked-prerequisite', 'bounded-step-coverage']
            .includes(step.diagnostic?.reason ?? '')).length;
    const warningSteps = steps.filter((step) => step.status === 'warning').length - coverageSteps;
    const runtimeFailed = results.some((result) => !result.passed) || failedSteps > 0;
    const runtimeInconclusive = results.some((result) => !isConclusiveRuntimeResult(result));
    const runtimeErrors = !staticInvalid && runtimeFailed
        ? Math.max(1, runtimeFailureIssues)
        : 0;
    const runtimeWarnings = staticInvalid
        ? 0
        : runtimeInconclusive && !runtimeFailed && coverageSteps === 0
            ? Math.max(1, warningSteps)
            : warningSteps;
    const totalIssues = staticErrors + staticWarnings + runtimeErrors + runtimeWarnings;
    const staticScore = Math.max(0, 100 - Math.min(100, staticErrors * 15 + staticWarnings * 5));

    let status: PackageReadinessStatus;
    let runtimeStatus: RuntimeReadinessStatus;

    if (staticInvalid) {
        status = 'static-invalid';
        runtimeStatus = 'not-run';
    } else if (runtimeFailed) {
        status = 'runtime-failed';
        runtimeStatus = 'failed';
    } else if (runtimePhase === 'running') {
        status = 'runtime-running';
        runtimeStatus = 'running';
    } else if (runtimePhase === 'pending') {
        status = 'runtime-pending';
        runtimeStatus = 'pending';
    } else if (!runtimeResult) {
        status = 'runtime-pending';
        runtimeStatus = 'pending';
    } else if (extendedState?.active) {
        status = extendedState.active.phase === 'pending' ? 'runtime-pending' : 'runtime-running';
        runtimeStatus = extendedState.active.phase === 'pending' ? 'pending' : 'running';
    } else if (runtimeInconclusive || runtimeWarnings > 0 || staticWarnings > 0) {
        status = 'needs-review';
        runtimeStatus = runtimeInconclusive || runtimeWarnings > 0 ? 'inconclusive' : 'passed';
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
        runtimeCoverageIncomplete: !staticInvalid && runtimeInconclusive,
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
