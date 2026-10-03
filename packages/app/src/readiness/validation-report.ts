import { deriveRuntimeCoverage, coverageModeText, type SuiteCoverage } from './runtime-coverage.js';
import { explainRuntimeStep } from '../preview/runtime-explanation.js';
import { reportEnvironment, type PackageFingerprint } from './report-context.js';
import type { ValidationIssue, ValidationResult } from '@streamshapers/ograf-validator-core';
import type {
    RuntimeActiveAttempt,
    RuntimeSuiteState,
    RuntimeTestResult,
    RuntimeTestStep,
} from '../preview/runtime-test-types.js';
import { getRuntimeSuiteResult, isConclusiveRuntimeResult } from '../preview/runtime-suite-state.js';
import { diagnoseRuntimeError, runtimeFailureIdentity, type RuntimeFailureGroup } from '../preview/runtime-diagnostics.js';
import { getRuntimeFindings } from '../preview/runtime-findings.js';
import { safeSpecReference } from './spec-reference.js';
import {
    derivePackageReadiness,
    type PackageReadiness,
    type RuntimeTestPhase,
} from './package-readiness.js';

export interface ValidationReport {
    coverage: SuiteCoverage[];
    reportFormatVersion: 1;
    environment: ReturnType<typeof reportEnvironment>;
    packageAtExport?: { manifestFilename: string; fingerprint: PackageFingerprint };
    evidenceNotes: string[];
    generatedAt: string;
    packageName: string;
    readiness: PackageReadiness;
    staticValidation: ValidationResult;
    runtimeFindings?: RuntimeFailureGroup[];
    runtimeTest: {
        status: PackageReadiness['runtimeStatus'];
        label: string;
        phase: RuntimeTestPhase | null;
        result: RuntimeTestResult | null;
    };
    extendedRuntimeTest?: {
        status: string;
        label: string;
        latestAttempt: RuntimeTestResult | null;
        lastCompleted: RuntimeTestResult | null;
        retainedFailures: RuntimeTestStep[];
        active: RuntimeActiveAttempt | null;
        progress: RuntimeActiveAttempt['progress'] | null;
        result: RuntimeTestResult | null;
    };
}

export function createValidationReport(
    packageName: string,
    staticValidation: ValidationResult,
    runtimeResult?: RuntimeTestResult,
    runtimePhase?: RuntimeTestPhase,
    generatedAt = new Date(),
    extendedState?: RuntimeSuiteState,
    packageAtExport?: ValidationReport['packageAtExport'],
    manifest?: unknown,
): ValidationReport {
    const readiness = derivePackageReadiness(
        staticValidation, runtimeResult, runtimePhase, extendedState,
    );
    const standardReadiness = derivePackageReadiness(staticValidation, runtimeResult, runtimePhase);
    return {
        coverage: deriveRuntimeCoverage(manifest, runtimeResult, extendedState, runtimePhase),
        reportFormatVersion: 1,
        environment: reportEnvironment(),
        ...(packageAtExport ? { packageAtExport } : {}),
        evidenceNotes: [
            'Invocation parameters and responses are captured at call time. Missing invocation evidence was not recorded.',
            'Undefined values use a type marker or undefinedPaths; they are distinct from null. Unavailable values are explicitly marked.',
            'Fingerprint algorithm: SHA-256 of UTF-8 JSON for [relativePath, byteLength, fileSha256] tuples sorted by relative path using JavaScript default string order.',
            'Package hashes cover relative paths and file bytes in the package directory, using the validator file scope (including shared resources, excluding ignored directories).',
            'Before/after hashes compare the directory at two points in time, not an immutable filesystem snapshot. External resources are not fingerprinted.',
            'The export-time fingerprint is separate from the runtime fingerprints. Runtime contexts identify when each observation was recorded.',
            'Package source files are not embedded. Reproduction requires the matching package and environment; visual equivalence is not asserted.',
        ],
        generatedAt: generatedAt.toISOString(),
        packageName,
        readiness,
        staticValidation,
        runtimeFindings: getRuntimeFindings(runtimeResult, extendedState),
        runtimeTest: {
            status: standardReadiness.runtimeStatus,
            label: standardReadiness.runtimeLabel,
            phase: runtimePhase ?? null,
            result: enrichResult(runtimeResult),
        },
        ...(extendedState ? { extendedRuntimeTest: createExtendedReport(extendedState) } : {}),
    };
}

export function renderValidationReportHtml(report: ValidationReport): string {
    const findings = report.runtimeFindings ?? getRuntimeFindings(
        report.runtimeTest.result ?? undefined,
        { latestAttempt: report.extendedRuntimeTest?.result ?? undefined },
    );
    const statusColor = readinessColor(report.readiness.status);
    const staticStatus = report.readiness.staticLabel;
    const staticIssues = [
        renderIssueSection(report.staticValidation.errors, '#ef4444', 'Static Errors'),
        renderIssueSection(report.staticValidation.warnings, '#f59e0b', 'Static Warnings'),
        renderIssueSection(report.staticValidation.infos, '#3b82f6', 'Static Infos'),
    ].join('');
    const runtimeRows = report.runtimeTest.result?.steps.map((step) => `
            <tr>
                <td><span class="runtime-${step.status}">${escapeHtml(step.status.toUpperCase())}</span></td>
                <td><code>${escapeHtml(step.name)}</code>${renderStepContext(step)}</td>
                <td>${renderCheckMessage(step, findings, 'standard')}</td>
            </tr>`).join('') ?? '';
    const runtimeSection = runtimeRows
        ? `<h2>Standard Runtime Test — ${escapeHtml(report.runtimeTest.label)}</h2>
            <table>
                <thead><tr><th>Status</th><th>Check</th><th>Message</th></tr></thead>
                <tbody>${runtimeRows}</tbody>
            </table>`
        : `<h2>Standard Runtime Test — ${escapeHtml(report.runtimeTest.label)}</h2><p>${escapeHtml(runtimeEmptyMessage(report))}</p>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>OGraf Validation Report - ${escapeHtml(report.packageName)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; color: #1f2937; }
  h1 { font-size: 1.25rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1rem; margin-top: 2rem; }
  .meta { color: #6b7280; font-size: 0.85rem; margin-bottom: 1.5rem; }
  .badge { display: inline-block; padding: 0.15rem 0.6rem; border-radius: 9999px; font-weight: 600; font-size: 0.8rem; color: #fff; background: ${statusColor}; }
  .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin: 1.5rem 0; }
  .summary div { border: 1px solid #e5e7eb; border-radius: 0.375rem; padding: 0.75rem; }
  .summary strong { display: block; margin-top: 0.25rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  th { text-align: left; padding: 0.5rem 0.75rem; background: #f3f4f6; border-bottom: 2px solid #e5e7eb; }
  td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  code { font-family: monospace; font-size: 0.8rem; background: #f3f4f6; padding: 0.1rem 0.3rem; border-radius: 3px; }
  .ok, .runtime-pass { color: #16a34a; font-weight: 600; }
  .runtime-fail { color: #dc2626; font-weight: 600; }
  .runtime-warning { color: #d97706; font-weight: 600; }
  .runtime-skip { color: #6b7280; }
</style>
</head>
<body>
<h1>${escapeHtml(report.packageName)} <span class="badge">${escapeHtml(report.readiness.label)}</span></h1>
<p class="meta">Generated ${escapeHtml(report.generatedAt)} &middot; OGraf Validator</p>
<div class="summary">
  <div>Static Validation<strong>${escapeHtml(staticStatus)}</strong></div>
  <div>Runtime tests<strong>${escapeHtml(report.readiness.runtimeLabel)}</strong></div>
  <div>Overall Result<strong>${escapeHtml(report.readiness.label)}</strong></div>
</div>
<p>${escapeHtml(report.readiness.detail)}</p>
<p>${escapeHtml(report.readiness.scope)}</p>
${report.staticValidation.errors.length === 0 && report.staticValidation.warnings.length === 0
    ? '<p class="ok">No static validation issues found.</p>'
    : ''}
${staticIssues}
${report.readiness.runtimeCoverageIncomplete ? '<p>Test coverage is incomplete. See the individual test sections for checks that could not be completed.</p>' : ''}
<details><summary>Reproduction context and capture limits</summary>
<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(JSON.stringify({
    reportFormatVersion: report.reportFormatVersion, environment: report.environment,
    packageAtExport: report.packageAtExport ?? 'Not captured',
    standardRun: report.runtimeTest.result?.reportContext ?? 'Not captured',
    extendedRun: report.extendedRuntimeTest?.result?.reportContext ?? 'Not captured',
}, null, 2))}</pre>
<ul>${report.evidenceNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul></details>
<details><summary>Test coverage</summary>${report.coverage.map((suite) => `<h3>${suite.suite} — ${escapeHtml(suite.status)}</h3>
<p>${suite.checks.pass} passed · ${suite.checks.fail} failed · ${suite.checks.warning} inconclusive · ${suite.checks.skip} skipped checks</p>
${suite.modes.map((mode) => `<p>${mode.mode}: ${escapeHtml(coverageModeText(suite, mode))}; confirmed step indices: ${mode.steps.join(', ') || 'None recorded'}</p>`).join('')}
${suite.customActions.map((action) => `<p>${escapeHtml(action.id)}: ${action.status}</p>`).join('')}`).join('')}
<p>Recorded results may include retained findings. Profiles show attempted Load configurations, not visual verification.</p></details>
${renderRuntimeFindings(findings)}
${runtimeSection}
${renderExtendedReport(report.extendedRuntimeTest, findings)}
</body>
</html>`;
}

function enrichStep(step: RuntimeTestStep): RuntimeTestStep {
    return step.status === 'fail' || step.status === 'warning' || step.diagnostic
        ? { ...step, explanation: explainRuntimeStep(step), diagnostic: {
            ...step.diagnostic,
            ...diagnoseRuntimeError(step.error, step.diagnostic),
        } }
        : { ...step };
}

function enrichResult(result: RuntimeTestResult | undefined): RuntimeTestResult | null {
    return result ? { ...result, steps: result.steps.map(enrichStep) } : null;
}

function createExtendedReport(state: RuntimeSuiteState): NonNullable<ValidationReport['extendedRuntimeTest']> {
    const result = getRuntimeSuiteResult(state);
    const failed = result && (!result.passed || result.steps.some((step) => step.status === 'fail'));
    const status = failed ? 'failed'
        : state.active ? state.active.phase
            : !result ? 'not-run'
                : isConclusiveRuntimeResult(result) ? 'passed' : 'inconclusive';

    return {
        status,
        label: status === 'not-run' ? 'Not Run' : status[0]!.toUpperCase() + status.slice(1),
        latestAttempt: enrichResult(state.latestAttempt),
        lastCompleted: enrichResult(state.lastCompleted),
        retainedFailures: (state.retainedFailures ?? []).map(enrichStep),
        active: state.active ? { ...state.active, steps: state.active.steps.map(enrichStep) } : null,
        progress: state.active?.progress ?? null,
        result: enrichResult(result),
    };
}

function renderExtendedReport(extended: ValidationReport['extendedRuntimeTest'], findings: RuntimeFailureGroup[]): string {
    if (!extended) return '';

    const attempt = extended.latestAttempt;
    const budget = extended.active?.budgetMinutes ?? attempt?.budgetMinutes;
    const progress = extended.progress;
    const rows = extended.result?.steps.map((step) => `<tr>
        <td class="runtime-${step.status}">${escapeHtml(step.status.toUpperCase())}</td>
        <td><code>${escapeHtml(step.name)}</code>${renderStepContext(step)}</td>
        <td>${step.durationMs} ms</td><td>${renderCheckMessage(step, findings, 'extended')}</td>
    </tr>`).join('') ?? '';
    const scenarios = attempt?.scenarios ?? extended.lastCompleted?.scenarios ?? [];
    const scenarioRows = scenarios.map((scenario) => `<tr>
        <td>${escapeHtml(scenario.renderMode)}</td>
        <td>${escapeHtml(scenario.label)}</td><td>${escapeHtml(scenario.status)}</td>
        <td>${scenario.executedChecks}/${scenario.plannedChecks}</td>
        <td>${escapeHtml(scenario.reason ?? '')}</td>
    </tr>`).join('');
    const metadata = [
        budget ? `Budget: ${budget} minutes` : undefined,
        attempt?.outcome ? `Latest attempt: ${attempt.outcome}` : undefined,
        attempt?.runId ? `Run: ${attempt.runId}` : undefined,
        extended.lastCompleted?.runId ? `Last conclusive run: ${extended.lastCompleted.runId}` : undefined,
        extended.active ? `Current attempt: ${extended.active.phase}` : undefined,
    ].filter((entry): entry is string => entry !== undefined).map(escapeHtml).join(' · ');

    return `<h2>Extended Runtime Test — ${escapeHtml(extended.label)}</h2>
        <p>${metadata}</p>
        ${progress ? `<p>${progress.completedScenarios}/${progress.totalScenarios} scenarios completed
            ${escapeHtml(progress.renderMode ?? '')} ${escapeHtml(progress.scenarioLabel ?? '')}
            ${escapeHtml(progress.currentCheck ?? '')}</p>` : ''}
        ${extended.retainedFailures.length > 0 ? '<p>Known failures from earlier attempts remain until a complete, conclusive replacement test finishes.</p>' : ''}
        ${scenarioRows ? `<h3>Scenario coverage</h3><table><thead><tr>
            <th>Mode</th><th>Scenario</th><th>Status</th><th>Checks executed/planned</th><th>Reason</th>
            </tr></thead><tbody>${scenarioRows}</tbody></table>` : ''}
        <p>Checks cover API contracts and observed runtime errors. Visual correctness is not tested.</p>
        ${rows ? `<table><thead><tr><th>Status</th><th>Check</th><th>Duration</th><th>Message</th>
            </tr></thead><tbody>${rows}</tbody></table>` : ''}`;
}

function renderRuntimeFindings(findings: RuntimeFailureGroup[]): string {
    if (findings.length === 0) return '';
    return `<h2>Runtime findings (${findings.length})</h2>
        <p>Each issue is shown once, even when several checks encounter it.</p>`
        + findings.map((finding) => `<article id="${escapeHtml(finding.id)}">
            <h3>${escapeHtml(finding.label)}</h3>
            <p><code>${escapeHtml(finding.code)}</code></p>
            <p>${escapeHtml(finding.error ?? 'The runtime check failed.')}</p>
            <p>${finding.occurrences.length} ${finding.occurrences.length === 1 ? 'occurrence' : 'occurrences'} · ${
                [...new Set(finding.occurrences.map(({ step }) => step.suite === 'extended'
                    ? 'Extended test' : 'Standard test'))].join(' · ')
            }</p>
            ${finding.occurrences[0] ? renderRuntimeExplanation(finding.occurrences[0].step) : ''}
            ${finding.occurrences.length > 1 ? '<p>First observation shown. Expand calls to inspect each observation.</p>' : ''}
            <p><strong>How to fix:</strong> ${escapeHtml(finding.hint)}</p>
            ${renderSpecReference(finding.specRef)}
            <details><summary>Show calls and scenarios</summary>
            ${finding.occurrences.map(({ step }) => `<p>${step.suite === 'extended' ? 'Extended test' : 'Standard test'}
                · ${escapeHtml(step.name)}</p>${renderStepContext(step)}`).join('')}
            </details></article>`).join('');
}

function renderCheckMessage(step: RuntimeTestStep, findings: RuntimeFailureGroup[], suite: 'standard' | 'extended'): string {
    if (step.status !== 'fail') return renderRuntimeMessage(step);
    const key = runtimeFailureIdentity({ ...step, suite });
    const finding = findings.find((candidate) => candidate.occurrences.some(({ step: occurrence }) => (
        runtimeFailureIdentity(occurrence) === key
    )));
    return finding ? `<a href="#${escapeHtml(finding.id)}">See shared finding: ${escapeHtml(finding.label)}</a>`
        : renderRuntimeMessage(step);
}

function renderRuntimeExplanation(step: RuntimeTestStep): string {
    const explanation = explainRuntimeStep(step);
    return (explanation.expected ? `<p><strong>Expected:</strong> ${escapeHtml(explanation.expected)}</p>` : '')
        + `<p><strong>${explanation.expected ? 'Received' : 'Response'}:</strong></p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(explanation.received)}</pre>`;
}

function renderStepContext(step: RuntimeTestStep): string {
    const context = [step.renderMode, step.scenarioId, step.checkId]
        .filter((entry): entry is string => entry !== undefined);
    const expectation = step.expectedCurrentStep !== undefined
        ? `<p>Expected step: ${escapeHtml(formatCurrentStep(step.expectedCurrentStep))}; `
            + `actual: ${escapeHtml(formatCurrentStep(step.actualCurrentStep))}</p>` : '';

    const evidence = step.invocation
        ? `<details><summary>Call parameters and response</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(JSON.stringify({
            invocation: step.invocation, runId: step.runId,
            reportContext: step.reportContext ?? 'Not captured',
        }, null, 2))}</pre></details>` : '';
    return (context.length > 0 ? `<p>${context.map(escapeHtml).join(' · ')}</p>` : '') + expectation + evidence;
}

function formatCurrentStep(step: number | null | undefined): string {
    return step === null ? 'END' : step === undefined ? 'not reported' : String(step);
}

function renderIssueSection(issues: ValidationIssue[], color: string, label: string): string {
    if (issues.length === 0) return '';
    const rows = issues.map((issue) => `
            <tr>
                <td><code>${escapeHtml(issue.code)}</code></td>
                <td>${issue.path ? `<code>${escapeHtml(issue.path)}</code>` : '&mdash;'}</td>
                <td>${escapeHtml(issue.message)}${renderSpecReference(issue.specRef)}</td>
            </tr>`).join('');
    return `
            <h2 style="color:${color}">${label} (${issues.length})</h2>
            <table>
                <thead><tr><th>Code</th><th>Path</th><th>Message</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
}

function renderRuntimeMessage(step: RuntimeTestStep): string {
    const message = step.error ? escapeHtml(step.error) : '&mdash;';
    if (step.status !== 'fail' && step.status !== 'warning' && !step.diagnostic) return message;
    const diagnostic = diagnoseRuntimeError(step.error, step.diagnostic);

    return `${message}<p><code>${escapeHtml(diagnostic.code)}</code></p>`
        + `<p><strong>Next step:</strong> ${escapeHtml(diagnostic.hint)}</p>`
        + renderSpecReference(diagnostic.specRef);
}

function renderSpecReference(reference?: string): string {
    const href = safeSpecReference(reference);

    return href
        ? `<p><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Specification reference</a></p>`
        : '';
}

function runtimeEmptyMessage(report: ValidationReport): string {
    if (report.runtimeTest.status === 'running') return 'Runtime test is running.';
    if (report.runtimeTest.status === 'pending') return 'Runtime test is pending.';
    if (report.runtimeTest.status === 'not-run') return 'Runtime test was not run.';
    return `Runtime test completed: ${report.runtimeTest.label}.`;
}

function readinessColor(status: PackageReadiness['status']): string {
    if (status === 'checks-passed') return '#16a34a';
    if (status === 'needs-review') return '#d97706';
    if (status === 'runtime-pending' || status === 'runtime-running') return '#2563eb';
    return '#dc2626';
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
