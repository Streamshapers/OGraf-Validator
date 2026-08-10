import { describe, expect, it } from 'vitest';
import type { GddField } from '@streamshapers/ograf-validator-core';
import {
    getKnownGddType,
    getSelectMultipleOptions,
    orderedGddEntries,
    orderedGddTreeEntries,
} from '../gdd-utils.js';

describe('orderedGddEntries', () => {
    it('puts ordered fields first and preserves source order for ties and unset fields', () => {
        const properties = {
            firstUnset: {},
            later: { order: 20 },
            first: { order: 10 },
            sameOrder: { order: 10 },
            secondUnset: {},
        };

        expect(orderedGddEntries(properties).map(([name]) => name)).toEqual([
            'first',
            'sameOrder',
            'later',
            'firstUnset',
            'secondUnset',
        ]);
    });

    it('treats non-finite order values as unset', () => {
        const properties = {
            invalid: { order: Number.NaN },
            ordered: { order: 1 },
        };

        expect(orderedGddEntries(properties).map(([name]) => name)).toEqual(['ordered', 'invalid']);
    });
});

describe('orderedGddTreeEntries', () => {
    it('includes nested object and array-item fields in per-level order', () => {
        const properties = {
            title: { type: 'string' },
            group: {
                type: 'object',
                properties: {
                    later: { type: 'string', order: 2 },
                    first: { type: 'string', order: 1 },
                },
            },
            people: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: { name: { type: 'string' } },
                },
            },
        } satisfies Record<string, GddField>;

        expect(orderedGddTreeEntries(properties).map(({ path, depth }) => [path, depth])).toEqual([
            ['title', 0],
            ['group', 0],
            ['group.first', 1],
            ['group.later', 1],
            ['people', 0],
            ['people[].name', 1],
        ]);
    });
});

describe('getKnownGddType', () => {
    it.each([
        'single-line',
        'multi-line',
        'file-path',
        'file-path/image-path',
        'select',
        'select-multiple',
        'color-rrggbb',
        'color-rrggbbaa',
        'percentage',
        'duration-ms',
    ])('recognises the public type %s exactly', (gddType) => {
        expect(getKnownGddType({ type: 'string', gddType } as GddField)).toBeDefined();
    });

    it('does not classify private types by substring', () => {
        expect(getKnownGddType({ type: 'string', gddType: 'vendor/color-rrggbb-special' } as GddField)).toBeUndefined();
        expect(getKnownGddType({ type: 'string', gddType: 'vendor/update-date' } as GddField)).toBeUndefined();
        expect(getKnownGddType({ type: 'string', gddType: 'dropdown' } as GddField)).toBeUndefined();
    });

    it('matches public GDD type names case-sensitively', () => {
        expect(getKnownGddType({ type: 'string', gddType: 'SELECT' })).toBeUndefined();
        expect(getKnownGddType({ type: 'string', gddType: 'select' })).toBe('select');
    });
});

describe('getSelectMultipleOptions', () => {
    it('preserves number values and resolves labels by their string representation', () => {
        const field = {
            type: 'array',
            gddType: 'select-multiple',
            items: { type: 'number', enum: [1.2, 3.5] },
            gddOptions: { labels: { '1.2': 'Low', '3.5': 'High' } },
        } as GddField;

        expect(getSelectMultipleOptions(field)).toEqual([
            { value: 1.2, label: 'Low' },
            { value: 3.5, label: 'High' },
        ]);
    });

    it('falls back to the value text when a label is absent', () => {
        const field = {
            type: 'array',
            gddType: 'select-multiple',
            items: { type: 'string', enum: ['one', 'two'] },
            gddOptions: { labels: { one: 'First' } },
        } as GddField;

        expect(getSelectMultipleOptions(field)).toEqual([
            { value: 'one', label: 'First' },
            { value: 'two', label: 'two' },
        ]);
    });
});
