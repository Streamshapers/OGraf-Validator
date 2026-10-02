import { describe, expect, it } from 'vitest';
import type { ValidationResult } from '@streamshapers/ograf-validator-core';
import type { RuntimeTestResult } from '../../preview/runtime-test-types.js';
import { filterValidationResult } from '../../settings/filter-results.js';
import { createValidationReport, renderValidationReportHtml } from '../validation-report.js';
import { diagnoseRuntimeError } from '../../preview/runtime-diagnostics.js';

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
    it('exports the same structured schedule diagnosis and hint shown in the UI', () => {
        const step = {
            name: 'NRT: setActionsSchedule()',
            status: 'fail' as const,
            durationMs: 1,
            error: 'EmptyPayload contains non-vendor field "statusCode".',
            diagnostic: {
                code: 'INVALID_EMPTY_PAYLOAD' as const,
                method: 'setActionsSchedule' as const,
                field: 'statusCode',
            },
        };
        const runtime = { passed: false, totalDurationMs: 1, steps: [step] };
        const expected = diagnoseRuntimeError(step.error, step.diagnostic);
        const report = createValidationReport('Schedule', STATIC_VALID, runtime);
        const exported = JSON.parse(JSON.stringify(report));
        expect(exported.runtimeTest.result.steps[0].diagnostic).toMatchObject(expected);
        expect(step.diagnostic).not.toHaveProperty('hint');

        const html = renderValidationReportHtml(report);
        expect(html).toContain(expected.code);
        expect(html).toContain('undefined');
        expect(html).toContain('v_');
        expect(html).toContain('Specification reference');
        expect(html).not.toContain('a 2xx statusCode');
    });

    it('keeps unknown exception text neutral in reports', () => {
        const report = createValidationReport('Legacy', STATIC_VALID, {
            passed: false,
            totalDurationMs: 1,
            steps: [{ name: 'RT: load()', status: 'fail', durationMs: 1,
                error: 'statusCode import timeout <script>' }],
        });
        const html = renderValidationReportHtml(report);
        expect(html).toContain('RUNTIME_CHECK_FAILED');
        expect(html).not.toContain('ACTION_RETURNED_ERROR_STATUS');
        expect(html).toContain('statusCode import timeout &lt;script&gt;');
    });

    it('renders official static references and omits unsafe reference links', () => {
        const issue = { code: 'MISSING_FIELD', severity: 'error' as const, message: 'Missing field',
            specRef: 'https://ograf.ebu.io/v1/specification/docs/Specification.html#manifest-model' };
        const report = createValidationReport('References', {
            ...STATIC_VALID, valid: false, errors: [issue], issues: [issue],
        });
        expect(renderValidationReportHtml(report)).toContain(`href="${issue.specRef}"`);
        issue.specRef = 'javascript:alert(1)';
        expect(renderValidationReportHtml(report)).not.toContain('javascript:');
    });

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
