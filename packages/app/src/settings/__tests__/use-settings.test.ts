import { describe, expect, it } from 'vitest';
import { normalizeSettings } from '../use-settings.js';

describe('normalizeSettings', () => {
    it('keeps valid saved settings', () => {
        expect(normalizeSettings({
            theme: 'light',
            scanDepth: 12,
            autoRevalidate: true,
            revalidateInterval: 10,
            hiddenSeverities: ['warning'],
        })).toEqual({
            theme: 'light',
            scanDepth: 12,
            autoRevalidate: true,
            revalidateInterval: 10,
            hiddenSeverities: ['warning'],
        });
    });

    it('replaces invalid saved values with safe defaults', () => {
        expect(normalizeSettings({
            theme: 'blue',
            scanDepth: 'deep',
            autoRevalidate: 'yes',
            revalidateInterval: 60,
            hiddenSeverities: ['error'],
        })).toEqual({
            theme: 'dark',
            scanDepth: 6,
            autoRevalidate: false,
            revalidateInterval: 2,
            hiddenSeverities: [],
        });
    });

    it('clamps scan depth and removes duplicate severity values', () => {
        expect(normalizeSettings({
            scanDepth: 99,
            hiddenSeverities: ['warning', 'warning', 'info'],
        })).toMatchObject({
            scanDepth: 20,
            hiddenSeverities: ['warning', 'info'],
        });
    });
});
