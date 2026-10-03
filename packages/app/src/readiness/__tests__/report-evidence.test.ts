import { expect, it } from 'vitest';
import { captureReportValue } from '../report-evidence.js';

it('preserves undefined separately from null, including nested response fields', () => {
    expect(captureReportValue(undefined)).toEqual({ type: 'undefined' });
    expect(captureReportValue(null)).toEqual({ type: 'json', value: null });
    expect(captureReportValue({ currentStep: undefined, nested: [null, undefined] })).toEqual({
        type: 'json', value: { currentStep: null, nested: [null, null] },
        undefinedPaths: [['currentStep'], ['nested', 1]],
    });
});

it('captures a detached value before an input can be mutated', () => {
    const input = { data: { title: 'Original' } };
    const evidence = captureReportValue(input);
    input.data.title = 'Changed';
    expect(evidence).toEqual({ type: 'json', value: { data: { title: 'Original' } } });
});

it('marks cyclic, oversized and special values unavailable without failing the runtime test', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    for (const value of [cyclic, 'x'.repeat(100_001), NaN, 1n, new Map(), new Date()]) {
        expect(captureReportValue(value).type).toBe('unavailable');
    }
    expect(captureReportValue(Array.from({ length: 20_001 }, () => 0)).type).toBe('unavailable');
});

it('does not confuse vendor keys with encoding metadata or pollute prototypes', () => {
    const value = JSON.parse('{"type":"undefined","__proto__":{"polluted":true}}') as unknown;
    expect(captureReportValue(value)).toEqual({ type: 'json', value });
    expect(Object.prototype).not.toHaveProperty('polluted');
});
