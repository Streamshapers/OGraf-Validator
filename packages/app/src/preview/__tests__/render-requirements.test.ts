import { describe, expect, it } from 'vitest';
import {
    getRenderRequirementOptions,
    selectRuntimeRenderRequirement,
} from '../render-requirements.js';

describe('render requirement alternatives', () => {
    it('exposes each representable alternative with engine/internet labels', () => {
        const options = getRenderRequirementOptions({
            renderRequirements: [
                {
                    resolution: { width: { exact: 1920 }, height: { exact: 1080 } },
                    frameRate: { ideal: 50 },
                    accessToPublicInternet: { exact: false },
                    engine: [{ type: 'CEF', version: { min: '139' } }],
                },
                {
                    resolution: { width: { ideal: 1280 }, height: { ideal: 720 } },
                    frameRate: { max: 30 },
                },
            ],
        });
        expect(options).toHaveLength(2);
        expect(options[0]).toMatchObject({
            index: 0,
            characteristics: { width: 1920, height: 1080, frameRate: 50, accessToPublicInternet: false },
            engineLabel: 'CEF >= 139',
            internetLabel: 'no public internet required',
        });
        expect(options[0]?.unverifiable).toHaveLength(2);
        expect(options[1]?.characteristics.frameRate).toBe(30);
    });

    it('selects the first representable alternative', () => {
        const selected = selectRuntimeRenderRequirement({
            renderRequirements: [
                { resolution: { width: { min: 2000, max: 1000 } } },
                { resolution: { width: { exact: 1280 }, height: { exact: 720 } } },
            ],
        });
        expect(selected.index).toBe(1);
        expect(selected.characteristics).toMatchObject({ width: 1280, height: 720 });
    });
});
