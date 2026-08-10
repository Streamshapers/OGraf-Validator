import type { ValidationIssue, ValidationResult } from '@streamshapers/ograf-validator-core';
import type { RuntimeTestResult } from '../preview/runtime-test-types.js';
import {
    derivePackageReadiness,
    type PackageReadiness,
    type RuntimeTestPhase,
} from './package-readiness.js';

export interface ValidationReport {
    generatedAt: string;
    packageName: string;
    readiness: PackageReadiness;
    staticValidation: ValidationResult;
    runtimeTest: {
        status: PackageReadiness['runtimeStatus'];
        label: string;
        phase: RuntimeTestPhase | null;
        result: RuntimeTestResult | null;
    };
}

export function createValidationReport(
    packageName: string,
    staticValidation: ValidationResult,
    runtimeResult?: RuntimeTestResult,
    runtimePhase?: RuntimeTestPhase,
    generatedAt = new Date(),
): ValidationReport {
    const readiness = derivePackageReadiness(staticValidation, runtimeResult, runtimePhase);
    return {
        generatedAt: generatedAt.toISOString(),
        packageName,
        readiness,
        staticValidation,
        runtimeTest: {
            status: readiness.runtimeStatus,
            label: readiness.runtimeLabel,
            phase: runtimePhase ?? null,
            result: runtimeResult ?? null,
        },
    };
}

export function renderValidationReportHtml(report: ValidationReport): string {
    const statusColor = readinessColor(report.readiness.status);
    const staticStatus = report.staticValidation.valid ? 'Manifest Valid' : 'Manifest Invalid';
    const staticIssues = [
        renderIssueSection(report.staticValidation.errors, '#ef4444', 'Static Errors'),
        renderIssueSection(report.staticValidation.warnings, '#f59e0b', 'Static Warnings'),
        renderIssueSection(report.staticValidation.infos, '#3b82f6', 'Static Infos'),
    ].join('');
    const runtimeRows = report.runtimeTest.result?.steps.map((step) => `
            <tr>
                <td><span class="runtime-${step.status}">${escapeHtml(step.status.toUpperCase())}</span></td>
                <td><code>${escapeHtml(step.name)}</code></td>
                <td>${step.error ? escapeHtml(step.error) : '&mdash;'}</td>
            </tr>`).join('') ?? '';
    const runtimeSection = runtimeRows
        ? `<h2>Runtime Test</h2>
            <table>
                <thead><tr><th>Status</th><th>Check</th><th>Message</th></tr></thead>
                <tbody>${runtimeRows}</tbody>
            </table>`
        : `<h2>Runtime Test</h2><p>${escapeHtml(runtimeEmptyMessage(report))}</p>`;

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
  <div>Static Validation<strong>${staticStatus}</strong></div>
  <div>Runtime Test<strong>${escapeHtml(report.runtimeTest.label)}</strong></div>
  <div>Overall Readiness<strong>${escapeHtml(report.readiness.label)}</strong></div>
</div>
${report.staticValidation.errors.length === 0 && report.staticValidation.warnings.length === 0
    ? '<p class="ok">No static validation issues found.</p>'
    : ''}
${staticIssues}
${runtimeSection}
</body>
</html>`;
}

function renderIssueSection(issues: ValidationIssue[], color: string, label: string): string {
    if (issues.length === 0) return '';
    const rows = issues.map((issue) => `
            <tr>
                <td><code>${escapeHtml(issue.code)}</code></td>
                <td>${issue.path ? `<code>${escapeHtml(issue.path)}</code>` : '&mdash;'}</td>
                <td>${escapeHtml(issue.message)}</td>
            </tr>`).join('');
    return `
            <h2 style="color:${color}">${label} (${issues.length})</h2>
            <table>
                <thead><tr><th>Code</th><th>Path</th><th>Message</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
}

function runtimeEmptyMessage(report: ValidationReport): string {
    if (report.runtimeTest.status === 'running') return 'Runtime test is running.';
    if (report.runtimeTest.status === 'pending') return 'Runtime test is pending.';
    if (report.runtimeTest.status === 'not-run') return 'Runtime test was not run.';
    return `Runtime test completed: ${report.runtimeTest.label}.`;
}

function readinessColor(status: PackageReadiness['status']): string {
    if (status === 'production-ready') return '#16a34a';
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
