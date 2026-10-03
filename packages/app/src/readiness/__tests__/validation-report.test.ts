import { describe, expect, it } from 'vitest';
import type { ValidationResult } from '@streamshapers/ograf-validator-core';
import type { RuntimeTestResult } from '../../preview/runtime-test-types.js';
import { filterValidationResult } from '../../settings/filter-results.js';
import { createValidationReport, renderValidationReportHtml } from '../validation-report.js';
import { diagnoseRuntimeError } from '../../preview/runtime-diagnostics.js';
import { completeRuntimeSuite, startRuntimeSuite } from '../../preview/runtime-suite-state.js';

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
    it('keeps the standard report independent of an extended failure', () => {
        const extended = completeRuntimeSuite(undefined, {
            ...RUNTIME_FAILED,
            suite: 'extended', runId: 'extended-1', budgetMinutes: 2, outcome: 'completed',
        });
        const report = createValidationReport('Separate suites', STATIC_VALID, {
            passed: true, totalDurationMs: 1, steps: [],
        }, undefined, undefined, extended);

        expect(report.runtimeTest).toMatchObject({ status: 'passed', result: { passed: true } });
        expect(report.extendedRuntimeTest).toMatchObject({
            status: 'failed', result: { passed: false },
            latestAttempt: { runId: 'extended-1', budgetMinutes: 2 },
            lastCompleted: { runId: 'extended-1' },
        });
        expect(report.readiness.status).toBe('runtime-failed');
        const html = renderValidationReportHtml(report);
        expect(html).toContain('Standard Runtime Test — Passed');
        expect(html).toContain('Runtime tests<strong>Failed</strong>');
        expect(html).toContain('Extended Runtime Test — Failed');
    });

    it('exports previous failures and live progress while a retry is active', () => {
        const extended = startRuntimeSuite(completeRuntimeSuite(undefined, RUNTIME_FAILED), {
            runId: 'retry', phase: 'running', budgetMinutes: 5, steps: [],
            progress: { completedScenarios: 1, totalScenarios: 4, renderMode: 'NRT',
                scenarioLabel: 'Seeking <timeline>', currentCheck: 'goToTime(1000)' },
        });
        const report = createValidationReport('Retry', STATIC_VALID, undefined, undefined,
            new Date('2026-10-03T10:00:00Z'), extended);
        expect(report.extendedRuntimeTest).toMatchObject({
            status: 'failed', active: { runId: 'retry', phase: 'running', budgetMinutes: 5 },
            progress: { completedScenarios: 1, totalScenarios: 4 },
            retainedFailures: [{ status: 'fail' }],
        });
        expect(report.generatedAt).toBe('2026-10-03T10:00:00.000Z');
        const html = renderValidationReportHtml(report);
        expect(html).toContain('1/4 scenarios completed');
        expect(html).toContain('Seeking &lt;timeline&gt;');
        expect(html).toContain('Known failures from earlier attempts remain');
    });

    it('preserves scenario and expected/actual step context in JSON and HTML', () => {
        const extended = completeRuntimeSuite(undefined, {
            ...RUNTIME_FAILED,
            suite: 'extended', budgetMinutes: 2, outcome: 'completed',
            steps: [{ ...RUNTIME_FAILED.steps[0]!, renderMode: 'RT',
                scenarioId: 'relative-navigation', checkId: 'end',
                expectedCurrentStep: null, actualCurrentStep: 3 }],
            scenarios: [{ id: 'relative-navigation', label: 'Relative navigation', renderMode: 'RT',
                status: 'failed', plannedChecks: 5, executedChecks: 3, reason: 'End mismatch' },
            { id: 'nrt', label: 'NRT', renderMode: 'NRT', status: 'not-applicable',
                plannedChecks: 0, executedChecks: 0, reason: 'Not declared' }],
        });
        const report = createValidationReport('Context', STATIC_VALID, undefined, undefined,
            undefined, extended);
        expect(report.extendedRuntimeTest?.result?.steps[0]).toMatchObject({
            scenarioId: 'relative-navigation', checkId: 'end', expectedCurrentStep: null,
            actualCurrentStep: 3, renderMode: 'RT',
        });
        const html = renderValidationReportHtml(report);
        expect(html).toContain('relative-navigation');
        expect(html).toContain('Expected step: END; actual: 3');
        expect(html).toContain('3/5');
        expect(html).toContain('not-applicable');
        expect(html).toContain('Visual correctness is not tested.');
    });

    it('keeps unattempted extended tests absent from legacy reports', () => {
        const report = createValidationReport('Legacy', STATIC_VALID);
        expect(report).not.toHaveProperty('extendedRuntimeTest');
        expect(renderValidationReportHtml(report)).not.toContain('Extended Runtime Test');
    });

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
            readiness: { status: 'runtime-failed', checksPassed: false },
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
        expect(html).toContain('Runtime tests<strong>Failed</strong>');
        expect(html).toContain('Overall Result<strong>Checks Failed</strong>');
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
        expect(report.readiness).toMatchObject({ status: 'needs-review', checksPassed: false });
    });

    it('keeps hidden warnings in readiness and exports after both suites pass', () => {
        const warning = { code: 'ENGINE_REQUIREMENT_UNVERIFIED', severity: 'warning' as const,
            message: 'Renderer needs review' };
        const fullResult = { ...STATIC_VALID, warnings: [warning], issues: [warning] };
        const displayed = filterValidationResult(fullResult, new Set(['warning']));
        const passed = { passed: true, steps: [], totalDurationMs: 1 };
        const extended = completeRuntimeSuite(undefined, { ...passed, suite: 'extended' });
        const report = createValidationReport('Hidden warnings', fullResult, passed,
            undefined, undefined, extended);

        expect(displayed.warnings).toEqual([]);
        expect(report.runtimeTest.status).toBe('passed');
        expect(report.extendedRuntimeTest?.status).toBe('passed');
        expect(report.readiness).toMatchObject({
            status: 'needs-review', checksPassed: false, staticWarnings: 1,
        });
        expect(report.staticValidation.warnings).toHaveLength(1);
        expect(renderValidationReportHtml(report)).toContain('Renderer needs review');
    });

    it('escapes extended scenario labels, reasons, IDs and errors in HTML', () => {
        const extended = completeRuntimeSuite(undefined, {
            ...RUNTIME_FAILED,
            steps: [{ ...RUNTIME_FAILED.steps[0]!, scenarioId: '<script>scenario</script>',
                checkId: '<check & id>' }],
            scenarios: [{ id: 'unsafe', label: '<img src=x>', renderMode: 'RT',
                status: 'blocked', reason: '<script>reason</script>',
                plannedChecks: 2, executedChecks: 0 }],
        });
        const html = renderValidationReportHtml(createValidationReport('Escaping', STATIC_VALID,
            undefined, undefined, undefined, extended));

        expect(html).toContain('&lt;script&gt;scenario&lt;/script&gt;');
        expect(html).toContain('&lt;check &amp; id&gt;');
        expect(html).toContain('&lt;img src=x&gt;');
        expect(html).toContain('&lt;script&gt;reason&lt;/script&gt;');
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('<img src=x>');
    });
});

it('exports tested-result terminology and scope without a synthetic score or production claim', () => {
    const report = createValidationReport('Scope', STATIC_VALID, {
        passed: true, totalDurationMs: 1,
        steps: [{ name: 'load()', status: 'pass', durationMs: 1 }],
    });
    const html = renderValidationReportHtml(report);
    expect(report.readiness.label).toBe('Checks Passed');
    expect(report.readiness.staticLabel).toBe('Manifest Valid');
    expect(report.readiness.scope).toContain('Extended tests have not been run.');
    expect(html).toContain(report.readiness.scope);
    expect(html).toContain('Overall Result<strong>Checks Passed</strong>');
    expect(JSON.stringify(report)).not.toMatch(/staticScore|productionReady|production-ready/);
    expect(html).not.toContain('Production-Ready');
});

it('includes call-time evidence in both report formats and escapes arbitrary payload text', () => {
    const report = createValidationReport('Evidence', STATIC_VALID, {
        passed: true, totalDurationMs: 1, steps: [{ name: 'load()', status: 'pass', durationMs: 1,
            invocation: { method: 'load', dispatched: true, timeoutMs: 10_000, startedAt: '2026-10-03',
                parameters: { type: 'json', value: { data: { title: '<script>alert(1)</script>' } } },
                response: { type: 'undefined' }, wasPromise: true,
            },
        }],
    });
    const html = renderValidationReportHtml(report);
    expect(report.reportFormatVersion).toBe(1);
    expect(html).toContain('Call parameters and response');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain(report.environment.specCommit);
    expect(html).toContain('Not captured');
});
