import { describe, expect, it } from 'vitest';
import {
    formatBooleanConstraint,
    formatDuration,
    formatNumberConstraint,
    formatRenderResolutionSummary,
    isExternalReference,
    readActionDurations,
    readCustomActions,
    readManifestName,
    readRenderRequirements,
    readThumbnails,
} from '../manifest-inspector.js';

describe('manifest inspector readers', () => {
    it('reads local and external thumbnails without resolving external resources', () => {
        const thumbnails = readThumbnails({
            thumbnails: [
                { file: 'assets/card.webp', resolution: { width: 640, height: 360 } },
                { file: 'https://cdn.example.test/card.jpg', resolution: { width: 1280, height: 720 } },
                { file: '', resolution: { width: 1, height: 1 } },
            ],
        });

        expect(thumbnails).toEqual([
            {
                file: 'assets/card.webp',
                external: false,
                resolution: { width: 640, height: 360 },
            },
            {
                file: 'https://cdn.example.test/card.jpg',
                external: true,
                resolution: { width: 1280, height: 720 },
            },
        ]);
    });

    it('reads render requirement alternatives including engines and internet constraints', () => {
        const requirements = readRenderRequirements({
            renderRequirements: [{
                resolution: {
                    width: { exact: 1920 },
                    height: { min: 720, ideal: 1080 },
                },
                frameRate: { min: 25, max: 60 },
                accessToPublicInternet: { exact: false },
                engine: [
                    { type: 'chromium', version: { min: '120' } },
                    { type: 'custom-engine', version: { min: 'v2' } },
                ],
            }],
        });

        expect(requirements).toHaveLength(1);
        expect(requirements[0]?.engines).toEqual([
            { type: 'chromium', minimumVersion: '120' },
            { type: 'custom-engine', minimumVersion: 'v2' },
        ]);
        expect(formatNumberConstraint(requirements[0]?.resolution?.width)).toBe('exact 1920');
        expect(formatRenderResolutionSummary(requirements)).toBe('1920 × ~1080');
        expect(formatNumberConstraint(requirements[0]?.frameRate)).toBe('min 25 · max 60');
        expect(formatBooleanConstraint(requirements[0]?.accessToPublicInternet)).toBe('exact false');
    });

    it('summarizes ideal and alternative render resolutions without treating them as exact', () => {
        const requirements = readRenderRequirements({
            renderRequirements: [
                { resolution: { width: { ideal: 1920 }, height: { ideal: 1080 } } },
                { resolution: { width: { min: 1280, max: 3840 }, height: { min: 720 } } },
            ],
        });

        expect(formatRenderResolutionSummary(requirements)).toBe('1920 × 1080 ideal · +1');
    });

    it('reads custom actions and action durations with zero-based step metadata', () => {
        const manifest = {
            name: 'Scoreboard',
            customActions: [{
                id: 'flash',
                name: 'Flash',
                description: 'Highlights the score.',
                schema: { type: 'object', properties: {} },
            }],
            actionDurations: [
                {
                    type: 'playAction',
                    duration: 500,
                    steps: [
                        { step: 0, duration: 200 },
                        { duration: 300 },
                    ],
                },
                { type: 'customAction', customActionId: 'flash', duration: -1 },
            ],
        };

        expect(readManifestName(manifest)).toBe('Scoreboard');
        expect(readCustomActions(manifest)).toEqual([{
            id: 'flash',
            name: 'Flash',
            description: 'Highlights the score.',
            hasSchema: true,
        }]);
        expect(readActionDurations(manifest)).toEqual([
            {
                type: 'playAction',
                duration: 500,
                steps: [
                    { step: 0, duration: 200 },
                    { duration: 300 },
                ],
            },
            {
                type: 'customAction',
                duration: -1,
                customActionId: 'flash',
                steps: [],
            },
        ]);
        expect(formatDuration(-1)).toBe('dynamic');
        expect(formatDuration(0)).toBe('0 ms');
    });
});

describe('isExternalReference', () => {
    it.each([
        'https://example.test/thumb.png',
        'http://example.test/thumb.png',
        '//example.test/thumb.png',
        '/shared/thumb.png',
        'data:image/png;base64,abc',
    ])('recognises %s as external', (file) => {
        expect(isExternalReference(file)).toBe(true);
    });

    it('keeps package-relative paths local', () => {
        expect(isExternalReference('assets/thumb.png')).toBe(false);
        expect(isExternalReference('./assets/thumb.png')).toBe(false);
    });
});
