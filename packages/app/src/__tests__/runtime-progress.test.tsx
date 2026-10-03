import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PackageCache } from '../components/ContentArea.js';
import StatusBar from '../components/StatusBar.js';
import { completeRuntimeSuite, startRuntimeSuite } from '../preview/runtime-suite-state.js';
import type { RuntimeTestResult } from '../preview/runtime-test-types.js';
import { deriveRuntimeProgress } from '../runtime-progress.js';

const passed: RuntimeTestResult = { passed: true, steps: [], totalDurationMs: 1 };
const failed: RuntimeTestResult = {
    passed: false, totalDurationMs: 1,
    steps: [{ name: 'playAction()', status: 'fail', durationMs: 1, error: 'Wrong step' }],
};
const cache = (): PackageCache => ({
    validationResult: { valid: true, issues: [], errors: [], warnings: [], infos: [] },
    manifest: {}, assets: [], runtimeTest: passed,
});

function renderProgress(entry: PackageCache): string {
    return renderToStaticMarkup(<StatusBar version="0.3.0" packageCount={1} scanDepth={3}
        errorCount={0} warningCount={0} infoCount={0} lastScan={null} autoRevalidate={false}
        runtimeProgress={deriveRuntimeProgress([entry])} />);
}

describe('aggregate runtime progress', () => {
    it('keeps an unrequested extended suite neutral and counts packages once', () => {
        expect(deriveRuntimeProgress([])).toBeNull();
        expect(deriveRuntimeProgress([cache(), {
            ...cache(), extendedRuntimeTest: completeRuntimeSuite(undefined, passed),
        }])).toEqual({ done: 2, total: 2, failed: 0, inconclusive: 0 });
    });

    it.each(['pending', 'running', 'cancelling'] as const)(
        'does not claim completion while an extended attempt is %s', (phase) => {
            const entry = { ...cache(), extendedRuntimeTest: startRuntimeSuite(undefined, {
                runId: 'extended', budgetMinutes: 2, phase, steps: [],
            }) };
            expect(deriveRuntimeProgress([entry]))
                .toEqual({ done: 0, total: 1, failed: 0, inconclusive: 0 });
            expect(renderProgress(entry)).toContain('Runtime tests in progress');
            expect(renderProgress(entry)).not.toContain('All runtime tests passed');
        },
    );

    it('keeps known failures visible while a retry is still active', () => {
        const entry = { ...cache(), extendedRuntimeTest: startRuntimeSuite(
            completeRuntimeSuite(undefined, failed), {
                runId: 'retry', budgetMinutes: 2, phase: 'running', steps: [],
            },
        ) };
        expect(deriveRuntimeProgress([entry]))
            .toEqual({ done: 0, total: 1, failed: 1, inconclusive: 0 });
        const html = renderProgress(entry);
        expect(html).toContain('1 failed');
        expect(html).toContain('Runtime tests in progress');
        expect(html).toContain('#cc5662');
    });

    it('counts a cancelled extended attempt as completed but inconclusive', () => {
        const entry = { ...cache(), extendedRuntimeTest: completeRuntimeSuite(undefined, {
            ...passed, outcome: 'cancelled', inconclusive: true,
        }) };
        expect(deriveRuntimeProgress([entry]))
            .toEqual({ done: 1, total: 1, failed: 0, inconclusive: 1 });
        expect(renderProgress(entry)).toContain('1 review');
    });
});
