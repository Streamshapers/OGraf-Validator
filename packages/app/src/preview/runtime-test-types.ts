/**
 * Types for the automated runtime test runner.
 * Tests the Web Component lifecycle (import → load → play → stop → dispose).
 */

export interface RuntimeTestResult {
    passed: boolean;
    /** True when a timeout/abort prevented a conclusive result. */
    inconclusive?: boolean;
    steps: RuntimeTestStep[];
    totalDurationMs: number;
}

export interface RuntimeTestStep {
    name: string;
    status: 'pass' | 'fail' | 'warning' | 'skip';
    durationMs: number;
    error?: string;
}
