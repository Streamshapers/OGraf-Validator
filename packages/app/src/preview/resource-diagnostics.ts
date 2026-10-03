import type { RuntimeSuiteState, RuntimeTestResult, RuntimeTestStep } from './runtime-test-types.js';
import { getRuntimeSuiteResult } from './runtime-suite-state.js';
import type { RuntimeDiagnosticDetails } from './runtime-diagnostic-types.js';

/** Strip credentials, queries and fragments before resource URLs enter reports. */
export function resourceLabel(value: string): string {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:'
            ? `${url.origin}${url.pathname}` : `${url.protocol}[resource]`;
    } catch { return value.split(/[?#]/)[0]!.slice(0, 4096); }
}

export function packageResourceDiagnostic(path: string, error: unknown): RuntimeDiagnosticDetails {
    let cause = error;
    for (let depth = 0; depth < 4 && cause instanceof Error && cause.cause; depth++) {
        cause = cause.cause;
    }
    return { code: 'RESOURCE_LOAD_FAILED',
        reason: cause instanceof DOMException && cause.name === 'NotFoundError' ? 'package-missing' : 'package-unreadable',
        field: resourceLabel(path),
    };
}


export interface ResourceObservation {
    resource: string;
    reason: string;
    observations: { suite: string; step: RuntimeTestStep }[];
}

export function getResourceObservations(standard?: RuntimeTestResult,
    extended?: RuntimeSuiteState): ResourceObservation[] {
    const grouped = new Map<string, ResourceObservation>();
    for (const [suite, result] of [['Standard', standard], ['Extended', getRuntimeSuiteResult(extended)]] as const) {
        for (const step of result?.steps ?? []) {
            if (step.diagnostic?.code !== 'RESOURCE_LOAD_FAILED') continue;
            const resource = step.diagnostic.field ?? 'Unknown resource';
            const reason = step.diagnostic.reason ?? 'unknown';
            const key = resource;
            const group = grouped.get(key) ?? { resource, reason, observations: [] };
            if (reason === 'sandbox-policy' || (reason.startsWith('package-') && group.reason !== 'sandbox-policy')) {
                group.reason = reason;
            }
            group.observations.push({ suite, step });
            grouped.set(key, group);
        }
    }
    return [...grouped.values()];
}

export function resourceCategory(reason: string): string {
    if (reason.startsWith('package-')) return 'Package resource';
    if (reason === 'sandbox-policy') return 'Browser policy restriction';
    return 'External/browser resource';
}
