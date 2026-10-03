import { describe, expect, it } from 'vitest';
import { getRuntimeFindings } from '../runtime-findings.js';
import type { RuntimeTestResult, RuntimeTestStep } from '../runtime-test-types.js';
import { completeRuntimeSuite, startRuntimeSuite } from '../runtime-suite-state.js';
import { createValidationReport, renderValidationReportHtml } from '../../readiness/validation-report.js';

const failure: RuntimeTestStep = {
    name: 'NRT: setActionsSchedule()', status: 'fail', durationMs: 1,
    error: 'EmptyPayload contains non-vendor field "statusCode".',
    diagnostic: { code: 'INVALID_EMPTY_PAYLOAD', method: 'setActionsSchedule',
        field: 'statusCode', reason: 'non-vendor-field' },
};
const result = (steps: RuntimeTestStep[]): RuntimeTestResult => ({
    passed: !steps.some((step) => step.status === 'fail'), steps, totalDurationMs: 1,
});

describe('shared runtime findings', () => {
    it('counts one issue, separates coverage, and exports one explanation with raw observations', () => {
        const report = createValidationReport('Perspective', {
            valid: true, issues: [], errors: [], warnings: [], infos: [],
        }, { ...result([failure]), inconclusive: true }, undefined, new Date(0), {
            latestAttempt: result([
                { ...failure, scenarioId: 'nrt.baseline' },
                { ...failure, scenarioId: 'nrt.seeking' },
                { name: 'Coverage', status: 'warning', durationMs: 0,
                    diagnostic: { code: 'PREVIEW_LIMITATION', reason: 'blocked-dependent-checks' } },
            ]),
        });
        expect(report.readiness).toMatchObject({ runtimeErrors: 1, runtimeWarnings: 0,
            totalIssues: 1, runtimeCoverageIncomplete: true, status: 'runtime-failed' });
        expect(report.runtimeFindings).toHaveLength(1);
        expect(report.runtimeTest.result?.steps).toHaveLength(1);
        expect(report.extendedRuntimeTest?.result?.steps).toHaveLength(3);
        const html = renderValidationReportHtml(report);
        expect(html.match(/INVALID_EMPTY_PAYLOAD/g)).toHaveLength(1);
        expect(html.match(/How to fix:/g)).toHaveLength(1);
        expect(html.match(/href="#runtime-finding-1"/g)).toHaveLength(3);
        expect(html).toContain('3 occurrences');
        expect(html).toContain('coverage is incomplete');
    });

    it('shows the perspective template failure once with all three observations', () => {
        const standard = result([failure]);
        const extended = { latestAttempt: result([
            { ...failure, scenarioId: 'nrt.baseline', checkId: 'contract-4' },
            { ...failure, name: 'NRT: setActionsSchedule() with distinct timestamps',
                scenarioId: 'nrt.seeking', checkId: 'nrt.seeking.schedule' },
        ]) };
        const findings = getRuntimeFindings(standard, extended);
        expect(findings).toHaveLength(1);
        expect(findings[0]?.label).toBe('setActionsSchedule()');
        expect(findings[0]?.occurrences.map(({ step }) => step.suite))
            .toEqual(['standard', 'extended', 'extended']);
        expect(standard.steps[0]?.suite).toBeUndefined();
    });

    it('keeps different fields, errors and step expectations separate', () => {
        expect(getRuntimeFindings(result([
            failure,
            { ...failure, diagnostic: { ...failure.diagnostic!, field: 'result' } },
            { ...failure, error: 'Another error' },
            { ...failure, expectedCurrentStep: 1, actualCurrentStep: 0 },
            { ...failure, expectedCurrentStep: 2, actualCurrentStep: 0 },
            { ...failure, expectedCurrentStep: null, actualCurrentStep: null },
            { ...failure, actualCurrentStep: null },
        ]))).toHaveLength(7);
    });

    it('does not assume identical exceptions or custom actions share a cause', () => {
        for (const diagnostic of [
            { code: 'RUNTIME_CHECK_FAILED', method: 'playAction' },
            { code: 'ACTION_RETURNED_ERROR_STATUS', method: 'customAction' },
        ] as const) {
            expect(getRuntimeFindings(result([{ ...failure, diagnostic }]), {
                latestAttempt: result([{ ...failure, diagnostic, scenarioId: 'nrt.seeking' }]),
            })).toHaveLength(2);
        }
    });

    it('retains a shared finding during and after cancelled retries', () => {
        const failed = completeRuntimeSuite(undefined, result([failure]));
        const active = startRuntimeSuite(failed, {
            runId: 'retry', phase: 'running', budgetMinutes: 2, steps: [],
        });
        expect(getRuntimeFindings(result([failure]), active)[0]?.occurrences).toHaveLength(2);
        const cancelled = completeRuntimeSuite(active, {
            ...result([]), outcome: 'cancelled', inconclusive: true,
        });
        expect(getRuntimeFindings(result([failure]), cancelled)).toHaveLength(1);
        const success = completeRuntimeSuite(cancelled, result([]));
        expect(getRuntimeFindings(result([failure]), success)[0]?.occurrences).toHaveLength(1);
    });
});
