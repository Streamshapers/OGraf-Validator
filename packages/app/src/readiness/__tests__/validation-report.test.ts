import { describe, expect, it } from 'vitest';
import type { ValidationResult } from '@streamshapers/ograf-validator-core';
import type { RuntimeTestResult } from '../../preview/runtime-test-types.js';
import { filterValidationResult } from '../../settings/filter-results.js';
import { createValidationReport, renderValidationReportHtml } from '../validation-report.js';

const STATIC_VALID: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    infos: [],
    issues: [],
};

const RUNTIME_FAILED: RuntimeTestResult = {
    passed: false,
    totalDurationMs: 12,
    steps: [{
        name: 'RT: load() <unsafe>',
        status: 'fail',
        durationMs: 12,
        error: 'Missing <load> & "dispose"',
    }],
};

describe('validation reports', () => {
    it('keeps static validation and runtime readiness separate in JSON data', () => {
        const report = createValidationReport(
            'Legacy Template',
            STATIC_VALID,
            RUNTIME_FAILED,
            undefined,
            new Date('2026-08-10T10:00:00.000Z'),
        );

        expect(report).toMatchObject({
            readiness: { status: 'runtime-failed', productionReady: false },
            staticValidation: { valid: true },
            runtimeTest: { status: 'failed', result: { passed: false } },
        });
    });

    it('does not claim that a statically valid package is fully valid after a runtime failure', () => {
        const html = renderValidationReportHtml(createValidationReport(
            'Legacy Template',
            STATIC_VALID,
            RUNTIME_FAILED,
        ));

        expect(html).toContain('No static validation issues found.');
        expect(html).toContain('Runtime Test<strong>Failed</strong>');
        expect(html).toContain('Overall Readiness<strong>Not Production-Ready</strong>');
        expect(html).not.toContain('fully valid');
    });

    it('escapes package names and runtime messages', () => {
        const html = renderValidationReportHtml(createValidationReport(
            '<Legacy & Template>',
            STATIC_VALID,
            RUNTIME_FAILED,
        ));

        expect(html).toContain('&lt;Legacy &amp; Template&gt;');
        expect(html).toContain('Missing &lt;load&gt; &amp; &quot;dispose&quot;');
        expect(html).not.toContain('Missing <load>');
    });

    it('keeps hidden warnings in the exported readiness assessment', () => {
        const warning = {
            code: 'FILE_ACCESS_ERROR',
            severity: 'warning' as const,
            message: 'Review this warning',
        };
        const fullResult: ValidationResult = {
            valid: true,
            errors: [],
            warnings: [warning],
            infos: [],
            issues: [warning],
        };
        const displayedResult = filterValidationResult(fullResult, new Set(['warning']));
        const report = createValidationReport('Warning Package', fullResult, {
            passed: true,
            steps: [],
            totalDurationMs: 1,
        });

        expect(displayedResult.warnings).toEqual([]);
        expect(report.staticValidation.warnings).toHaveLength(1);
        expect(report.readiness).toMatchObject({ status: 'needs-review', productionReady: false });
    });
});
