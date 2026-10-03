import { getRuntimeFindings } from '../preview/runtime-findings.js';
import type { RuntimeSuiteState, RuntimeTestResult, RuntimeTestStep } from '../preview/runtime-test-types.js';
import { getRuntimeSuiteResult, isConclusiveRuntimeResult } from '../preview/runtime-suite-state.js';

export interface SuiteCoverage {
    suite: 'Standard' | 'Extended';
    status: string;
    issueCount: number;
    issueOccurrences: number;
    checks: Record<RuntimeTestStep['status'], number>;
    modes: { mode: 'RT' | 'NRT'; declared: boolean | null; steps: number[]; profiles: string[] }[];
    declaredStepCount: number | null;
    customActions: { id: string; status: 'Passed' | 'Failed' | 'Inconclusive' | 'Not run' | 'Not recorded' }[];
    evidenceMissing: boolean;
}

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function deriveRuntimeCoverage(manifest: unknown, standard?: RuntimeTestResult,
    extended?: RuntimeSuiteState, standardPhase?: string): SuiteCoverage[] {
    const data = record(manifest);
    const knownManifest = manifest !== undefined && manifest !== null;
    const count = data['stepCount'] ?? 1;
    const declaredStepCount = knownManifest && Number.isInteger(count) && (count as number) >= -1 ? count as number : null;
    const actions = Array.isArray(data['customActions']) ? data['customActions'] : [];
    return ([['Standard', standard, standardPhase], ['Extended', getRuntimeSuiteResult(extended), extended?.active?.phase]] as const)
        .map(([suite, result, phase]): SuiteCoverage => {
            const steps = result?.steps ?? [];
            const findings = getRuntimeFindings(result);
            const calls = steps.filter((step) => step.invocation?.dispatched);
            const checks = { pass: 0, fail: 0, warning: 0, skip: 0 };
            for (const step of steps) checks[step.status]++;
            const status = result && !result.passed ? 'Failed'
                : phase ? phase === 'pending' ? 'Queued' : 'Running'
                    : !result ? 'Not run' : isConclusiveRuntimeResult(result) ? 'Passed' : 'Inconclusive';
            return {
                suite, status, checks, declaredStepCount,
                issueCount: findings.length,
                issueOccurrences: findings.reduce((sum, finding) => sum + finding.occurrences.length, 0),
                evidenceMissing: !!result && !calls.length,
                modes: (['RT', 'NRT'] as const).map((mode) => {
                    const modeCalls = calls.filter((step) => step.renderMode === mode);
                    const profiles = modeCalls.filter((step) => step.invocation?.method === 'load')
                        .map((step) => {
                            const params = step.invocation!.parameters;
                            const render = record(record(params.type === 'json' ? params.value : undefined)['renderCharacteristics']);
                            const resolution = record(render['resolution']);
                            return typeof resolution['width'] === 'number' && typeof resolution['height'] === 'number'
                                ? `${resolution['width']} × ${resolution['height']}${typeof render['frameRate'] === 'number' ? ` · ${render['frameRate']} fps` : ''}${typeof render['accessToPublicInternet'] === 'boolean' ? ` · Internet requested: ${render['accessToPublicInternet'] ? 'yes' : 'no'}` : ''}` : 'Not captured';
                        });
                    return { mode, declared: knownManifest ? data[mode === 'RT' ? 'supportsRealTime' : 'supportsNonRealTime'] === true : null,
                        steps: [...new Set(modeCalls.filter((step) => step.status === 'pass' && step.invocation?.method === 'playAction'
                            && typeof step.actualCurrentStep === 'number' && Number.isInteger(step.actualCurrentStep)
                            && step.actualCurrentStep >= 0 && (declaredStepCount === null || declaredStepCount === -1 || step.actualCurrentStep < declaredStepCount)).map((step) => step.actualCurrentStep as number))].sort((a, b) => a - b),
                        profiles: [...new Set(profiles)],
                    };
                }),
                customActions: actions.flatMap((action) => {
                    const id = record(action)['id'];
                    if (typeof id !== 'string') return [];
                    const observations = calls.filter((step) => step.invocation?.method === 'customAction'
                        && step.invocation.parameters.type === 'json' && record(step.invocation.parameters.value)['id'] === id);
                    return [{ id, status: observations.some((step) => step.status === 'fail') ? 'Failed' as const
                        : observations.some((step) => step.status === 'warning' || step.status === 'skip') ? 'Inconclusive' as const
                            : observations.some((step) => step.status === 'pass') ? 'Passed' as const
                                : result && !calls.length ? 'Not recorded' as const : 'Not run' as const }];
                }),
            };
        });
}

export function coverageModeText(coverage: SuiteCoverage, mode: SuiteCoverage['modes'][number]): string {
    if (mode.declared === false) return 'Not applicable (not declared)';
    const count = coverage.declaredStepCount;
    const stepText = count === 0 ? 'No fixed steps' : count === -1 ? 'Dynamic steps (bounded test)'
        : count === null ? 'Step count unknown' : `${mode.steps.length} of ${count} steps confirmed`;
    return `${stepText} · ${mode.profiles.length ? mode.profiles.join('; ') : 'No render profile recorded'}`;
}

export function coverageIssueText(coverage: SuiteCoverage): string {
    const count = coverage.issueCount;
    const issues = `${count} ${count === 1 ? 'issue' : 'issues'}`;
    if (count === 0) return coverage.status === 'Not run' ? 'Not tested yet' : 'No issues detected';
    return `${issues} · ${coverage.issueOccurrences === 1 ? 'detected once'
        : `detected in ${coverage.issueOccurrences} checks`}`;
}
