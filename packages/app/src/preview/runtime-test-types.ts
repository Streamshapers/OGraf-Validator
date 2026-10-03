import type { RuntimeExplanation } from './runtime-explanation.js';
import type { ReportValue } from '../readiness/report-evidence.js';
import type { RuntimeReportContext } from '../readiness/report-context.js';
import type { RuntimeDiagnosticDetails } from './runtime-diagnostic-types.js';

export type RuntimeTestSuite = 'standard' | 'extended';
export type RuntimeBudgetMinutes = 2 | 5 | 10;
export type RuntimeRenderMode = 'RT' | 'NRT';
export type RuntimeTestOutcome = 'completed' | 'cancelled' | 'budget-exhausted';

export interface RuntimeScenarioResult {
    id: string;
    label: string;
    renderMode: RuntimeRenderMode;
    status: 'passed' | 'failed' | 'inconclusive' | 'not-applicable' | 'blocked' | 'not-run';
    reason?: string;
    plannedChecks: number;
    executedChecks: number;
}

export interface RuntimeTestProgress {
    completedScenarios: number;
    totalScenarios: number;
    scenarioId?: string;
    scenarioLabel?: string;
    renderMode?: RuntimeRenderMode;
    currentCheck?: string;
}

export interface RuntimeActiveAttempt {
    runId: string;
    phase: 'pending' | 'running' | 'cancelling';
    budgetMinutes: RuntimeBudgetMinutes;
    steps: RuntimeTestStep[];
    progress?: RuntimeTestProgress;
}

/** Evidence belongs to one package generation, never to a later filesystem scan. */
export interface RuntimeSuiteState {
    lastCompleted?: RuntimeTestResult;
    latestAttempt?: RuntimeTestResult;
    retainedFailures?: RuntimeTestStep[];
    active?: RuntimeActiveAttempt;
}

/**
 * Types for the automated runtime test runner.
 * Tests the Web Component lifecycle (import → load → play → stop → dispose).
 */

export interface RuntimeTestResult {
    reportContext?: RuntimeReportContext;
    passed: boolean;
    /** True when time limits, cancellation, or missing coverage prevent a conclusive result. */
    inconclusive?: boolean;
    steps: RuntimeTestStep[];
    totalDurationMs: number;
    suite?: RuntimeTestSuite;
    runId?: string;
    budgetMinutes?: RuntimeBudgetMinutes;
    outcome?: RuntimeTestOutcome;
    scenarios?: RuntimeScenarioResult[];
}

export interface RuntimeTestStep {
    explanation?: RuntimeExplanation;
    reportContext?: RuntimeReportContext;
    invocation?: {
        method: string;
        parameters: ReportValue;
        timeoutMs?: number;
        dispatched: boolean;
        startedAt: string;
        response?: ReportValue;
        wasPromise?: boolean;
    };
    name: string;
    status: 'pass' | 'fail' | 'warning' | 'skip';
    durationMs: number;
    error?: string;
    diagnostic?: RuntimeDiagnosticDetails;
    suite?: RuntimeTestSuite;
    runId?: string;
    scenarioId?: string;
    checkId?: string;
    renderMode?: RuntimeRenderMode;
    /** null represents the normalized undefined/end state, not a wire payload value. */
    expectedCurrentStep?: number | null;
    actualCurrentStep?: number | null;
}
