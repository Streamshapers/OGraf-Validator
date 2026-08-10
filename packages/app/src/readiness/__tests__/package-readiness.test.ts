import { describe, expect, it } from 'vitest';
import type { ValidationIssue, ValidationResult } from '@streamshapers/ograf-validator-core';
import type { RuntimeTestResult, RuntimeTestStep } from '../../preview/runtime-test-types.js';
import { derivePackageReadiness } from '../package-readiness.js';

function validation(errors = 0, warnings = 0): ValidationResult {
    const errorIssues = Array.from({ length: errors }, (_, index) => ({
        code: 'INVALID_MANIFEST',
        severity: 'error' as const,
        message: `error ${index}`,
    })) satisfies ValidationIssue[];
    const warningIssues = Array.from({ length: warnings }, (_, index) => ({
        code: 'ENGINE_REQUIREMENT_UNVERIFIED',
        severity: 'warning' as const,
        message: `warning ${index}`,
    })) satisfies ValidationIssue[];
    return {
        valid: errors === 0,
        errors: errorIssues,
        warnings: warningIssues,
        infos: [],
        issues: [...errorIssues, ...warningIssues],
    };
}

function runtime(passed: boolean, steps: RuntimeTestStep[], inconclusive = false): RuntimeTestResult {
    return { passed, steps, totalDurationMs: 10, ...(inconclusive ? { inconclusive: true } : {}) };
}

it('marks static failures invalid without requiring a runtime result', () => {
    const result = derivePackageReadiness(validation(2));
    expect(result).toMatchObject({
        status: 'static-invalid',
        label: 'Not Production-Ready',
        runtimeStatus: 'not-run',
        totalIssues: 2,
        productionReady: false,
    });
});

it('ignores stale runtime results when static validation blocks execution', () => {
    const result = derivePackageReadiness(validation(1), runtime(false, [
        { name: 'stale runtime step', status: 'fail', durationMs: 1, error: 'stale' },
    ]));
    expect(result).toMatchObject({
        status: 'static-invalid',
        runtimeStatus: 'not-run',
        staticErrors: 1,
        runtimeErrors: 0,
        totalIssues: 1,
    });
});

describe('statically valid packages', () => {
    it('remain pending until the runtime test starts', () => {
        expect(derivePackageReadiness(validation())).toMatchObject({
            status: 'runtime-pending',
            runtimeStatus: 'pending',
            totalIssues: 0,
        });
    });

    it('report a running runtime test', () => {
        expect(derivePackageReadiness(validation(), undefined, 'running')).toMatchObject({
            status: 'runtime-running',
            runtimeStatus: 'running',
        });
    });

    it('distinguishes queued runtime tests from active tests', () => {
        expect(derivePackageReadiness(validation(), undefined, 'pending')).toMatchObject({
            status: 'runtime-pending',
            runtimeStatus: 'pending',
            runtimeLabel: 'Pending',
        });
    });

    it('ignores a stale result while a replacement test is pending', () => {
        const result = derivePackageReadiness(validation(), runtime(false, []), 'pending');
        expect(result).toMatchObject({
            status: 'runtime-pending',
            runtimeStatus: 'pending',
            runtimeErrors: 0,
            totalIssues: 0,
        });
    });

    it('counts the same failure in RT and NRT as one overall issue', () => {
        const result = derivePackageReadiness(validation(), runtime(false, [
            { name: 'RT: load()', status: 'fail', durationMs: 1, error: 'failed' },
            { name: 'NRT: load()', status: 'fail', durationMs: 1, error: 'failed' },
        ]));
        expect(result).toMatchObject({
            status: 'runtime-failed',
            runtimeStatus: 'failed',
            runtimeErrors: 1,
            totalIssues: 1,
            productionReady: false,
        });
    });

    it('keeps distinct runtime failures as separate overall issues', () => {
        const result = derivePackageReadiness(validation(), runtime(false, [
            { name: 'RT: load()', status: 'fail', durationMs: 1, error: 'load failed' },
            { name: 'NRT: load()', status: 'fail', durationMs: 1, error: 'different load failure' },
            { name: 'NRT: dispose()', status: 'fail', durationMs: 1, error: 'load failed' },
        ]));
        expect(result).toMatchObject({
            runtimeErrors: 3,
            totalIssues: 3,
        });
    });

    it('never reports readiness when a result contains a failed step', () => {
        const result = derivePackageReadiness(validation(), runtime(true, [
            { name: 'inconsistent step', status: 'fail', durationMs: 1, error: 'failed' },
        ]));
        expect(result).toMatchObject({
            status: 'runtime-failed',
            runtimeStatus: 'failed',
            runtimeErrors: 1,
            productionReady: false,
        });
    });

    it('counts a failed result without failed steps as one runtime issue', () => {
        const result = derivePackageReadiness(validation(), runtime(false, []));
        expect(result).toMatchObject({
            status: 'runtime-failed',
            runtimeErrors: 1,
            totalIssues: 1,
        });
    });

    it('requires review for inconclusive runtime results', () => {
        const result = derivePackageReadiness(validation(), runtime(true, [
            { name: 'Runtime test', status: 'warning', durationMs: 10 },
        ], true));
        expect(result).toMatchObject({
            status: 'needs-review',
            runtimeStatus: 'inconclusive',
            runtimeWarnings: 1,
            totalIssues: 1,
        });
    });

    it('requires review when a warning step is present without an inconclusive flag', () => {
        const result = derivePackageReadiness(validation(), runtime(true, [
            { name: 'render capability', status: 'warning', durationMs: 1 },
        ]));
        expect(result).toMatchObject({
            status: 'needs-review',
            runtimeStatus: 'inconclusive',
            runtimeWarnings: 1,
        });
    });

    it('requires review when static warnings remain after a passing runtime test', () => {
        const result = derivePackageReadiness(validation(0, 1), runtime(true, []));
        expect(result).toMatchObject({
            status: 'needs-review',
            runtimeStatus: 'passed',
            staticWarnings: 1,
            totalIssues: 1,
        });
    });

    it('is production-ready only after a conclusive passing runtime test', () => {
        const result = derivePackageReadiness(validation(), runtime(true, [
            { name: 'RT: load()', status: 'pass', durationMs: 1 },
        ]));
        expect(result).toMatchObject({
            status: 'production-ready',
            label: 'Production-Ready',
            runtimeStatus: 'passed',
            totalIssues: 0,
            staticScore: 100,
            productionReady: true,
        });
    });
});
