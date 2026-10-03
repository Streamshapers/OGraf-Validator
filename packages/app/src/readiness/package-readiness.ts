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
    | 'checks-passed';

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
    staticLabel: string;
    detail: string;
    scope: string;
    checksPassed: boolean;
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
        status = 'checks-passed';
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
        staticLabel: staticInvalid ? 'Manifest Invalid' : 'Manifest Valid',
        detail: readinessDetail(status),
        scope: 'Results describe the checks performed. Visual output and production suitability are not assessed.'
            + (!extendedResult && !extendedState?.active ? ' Extended tests have not been run.' : ''),
        checksPassed: status === 'checks-passed',
    };
}

function readinessLabel(status: PackageReadinessStatus): string {
    switch (status) {
        case 'static-invalid': return 'Checks Failed';
        case 'runtime-pending': return 'Tests Pending';
        case 'runtime-running': return 'Tests Running';
        case 'runtime-failed': return 'Checks Failed';
        case 'needs-review': return 'Needs Review';
        case 'checks-passed': return 'Checks Passed';
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

function readinessDetail(status: PackageReadinessStatus): string {
    switch (status) {
        case 'static-invalid': return 'Static validation found errors.';
        case 'runtime-failed': return 'Runtime tests found errors.';
        case 'runtime-pending': return 'Waiting for runtime tests.';
        case 'runtime-running': return 'Runtime tests are in progress.';
        case 'needs-review': return 'Review warnings or incomplete checks.';
        case 'checks-passed': return 'All executed checks passed.';
    }
}
