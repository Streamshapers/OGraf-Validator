import { describe, expect, it } from 'vitest';
import { prioritizeRuntimeQueue } from '../runtime-queue.js';

const item = (key: string) => ({ entry: { key } });

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
});
