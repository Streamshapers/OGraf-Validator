import { describe, expect, it } from 'vitest';
import { enqueueRuntimeJob, prioritizeRuntimeQueue } from '../runtime-queue.js';

const item = (key: string) => ({ entry: { key } });
const job = (key: string, suite: 'standard' | 'extended' = 'standard') => ({
    entry: { key }, suite,
});

describe('enqueueRuntimeJob', () => {
    it('runs a manual extended request immediately after its own waiting standard check', () => {
        const queue = [job('first'), job('selected'), job('last')];
        expect(enqueueRuntimeJob(queue, job('selected', 'extended'), true)).toEqual([
            job('selected'), job('selected', 'extended'), job('first'), job('last'),
        ]);
        expect(queue).toEqual([job('first'), job('selected'), job('last')]);
    });

    it('prioritizes manual work without a pending prerequisite', () => {
        expect(enqueueRuntimeJob([job('other')], job('selected', 'extended'), true))
            .toEqual([job('selected', 'extended'), job('other')]);
    });

    it('allows both suites for a package but deduplicates the same suite', () => {
        const queue = [job('selected'), job('selected', 'extended')];
        expect(enqueueRuntimeJob(queue, job('selected', 'extended'), true)).toEqual(queue);
        expect(enqueueRuntimeJob([job('selected')], job('selected', 'extended'))).toEqual(queue);
    });

    it('appends automatic standard work and prioritizes an explicit standard retry', () => {
        expect(enqueueRuntimeJob([job('first')], job('next')))
            .toEqual([job('first'), job('next')]);
        expect(enqueueRuntimeJob([job('first')], job('next'), true))
            .toEqual([job('next'), job('first')]);
    });

    it('does not let a newly selected standard check overtake explicit extended work', () => {
        const queue = [job('manual'), job('manual', 'extended'), job('other')];
        expect(enqueueRuntimeJob(queue, job('selected'), true))
            .toEqual([job('manual'), job('manual', 'extended'), job('selected'), job('other')]);
    });
});

describe('prioritizeRuntimeQueue', () => {
    it('moves the selected package ahead of other waiting packages', () => {
        const queue = [item('active-next'), item('selected'), item('last')];

        expect(prioritizeRuntimeQueue(queue, 'selected').map((entry) => entry.entry.key))
            .toEqual(['selected', 'active-next', 'last']);
    });

    it('keeps the remaining queue order unchanged', () => {
        const queue = [item('first'), item('second'), item('third'), item('selected')];

        expect(prioritizeRuntimeQueue(queue, 'selected').map((entry) => entry.entry.key))
            .toEqual(['selected', 'first', 'second', 'third']);
    });

    it('leaves the queue unchanged when the package is not waiting', () => {
        const queue = [item('first'), item('second')];

        expect(prioritizeRuntimeQueue(queue, 'missing').map((entry) => entry.entry.key))
            .toEqual(['first', 'second']);
    });

    it('keeps manual extended work and its standard prerequisite ahead of selection', () => {
        const queue = [job('manual'), job('manual', 'extended'), job('other'), job('selected')];
        expect(prioritizeRuntimeQueue(queue, 'selected'))
            .toEqual([job('manual'), job('manual', 'extended'), job('selected'), job('other')]);
        expect(prioritizeRuntimeQueue(queue, 'manual')).toEqual(queue);
    });
});
