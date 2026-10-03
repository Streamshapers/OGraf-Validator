import { derivePackageReadiness } from '../../readiness/package-readiness.js';
import { expect, it } from 'vitest';
import { getResourceObservations, packageResourceDiagnostic, resourceLabel } from '../resource-diagnostics.js';
import { diagnoseRuntimeError } from '../runtime-diagnostics.js';
import type { RuntimeTestResult } from '../runtime-test-types.js';

it('redacts credentials and URL queries and distinguishes a missing file from a read failure', () => {
    expect(resourceLabel('https://user:secret@example.com/a.png?token=secret#x')).toBe('https://example.com/a.png');
    expect(resourceLabel('data:image/png;base64,secret')).toBe('data:[resource]');
    expect(packageResourceDiagnostic('a.png', new DOMException('', 'NotFoundError')).reason).toBe('package-missing');
    expect(packageResourceDiagnostic('a.png', new Error('NotFoundError')).reason).toBe('package-unreadable');
});

it('groups repeated resource observations across suites without discarding evidence', () => {
    const result: RuntimeTestResult = { passed: true, inconclusive: true, totalDurationMs: 0, steps: [
        { name: 'resource', status: 'warning', durationMs: 0, error: 'Missing a.png',
            diagnostic: packageResourceDiagnostic('a.png', new DOMException('', 'NotFoundError')) },
    ] };
    const groups = getResourceObservations(result, { latestAttempt: { ...result, steps: [...result.steps, ...result.steps] } });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.observations).toHaveLength(3);
    expect(derivePackageReadiness({ valid: true, errors: [], warnings: [], infos: [], issues: [] },
        result, undefined, { latestAttempt: { ...result, steps: [...result.steps, ...result.steps] } }))
        .toMatchObject({ runtimeErrors: 0, runtimeWarnings: 1, totalIssues: 1, status: 'needs-review' });
    expect(groups[0]?.observations.map((item) => item.suite)).toEqual(['Standard', 'Extended', 'Extended']);
});

it('does not claim a normative violation or a specific network cause from a browser failure', () => {
    expect(diagnoseRuntimeError('', { code: 'RESOURCE_LOAD_FAILED', reason: 'sandbox-policy' }).hint)
        .toContain('not an OGraf violation');
    expect(diagnoseRuntimeError('', { code: 'RESOURCE_LOAD_FAILED', reason: 'external-network' }).hint)
        .toContain('exact cause is not always exposed');
});

it('preserves a wrapped file-not-found cause without inferring it from message text', () => {
    const wrapped = new Error('read failed', { cause: new DOMException('', 'NotFoundError') });
    expect(packageResourceDiagnostic('asset.png', wrapped).reason).toBe('package-missing');
});

it('prefers observed policy evidence when the same resource also has a generic fetch failure', () => {
    const result: RuntimeTestResult = { passed: true, inconclusive: true, totalDurationMs: 0,
        steps: ['external-network', 'sandbox-policy'].map((reason) => ({
            name: 'resource', status: 'warning', durationMs: 0,
            diagnostic: { code: 'RESOURCE_LOAD_FAILED', reason, field: 'https://example.com/' },
        })) };
    expect(getResourceObservations(result)).toMatchObject([{ reason: 'sandbox-policy', observations: [{}, {}] }]);
});
