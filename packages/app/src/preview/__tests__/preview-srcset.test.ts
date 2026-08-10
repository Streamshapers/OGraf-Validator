import { describe, expect, it } from 'vitest';
import {
    parsePreviewSrcset,
    preparePreviewSrcset,
    serializePreviewSrcset,
} from '../preview-srcset.js';
import { PREVIEW_PREFIX } from '../preview-resources.js';

const ORIGIN = 'https://validator.test';
const SESSION_ID = '0123456789abcdef';
const BASE_URL = `${ORIGIN}${PREVIEW_PREFIX}${SESSION_ID}/images/main.mjs`;

describe('preview srcset', () => {
    it('keeps density, width and data URL candidates intact', () => {
        const source = './small.png 1x, ./large.png 2x, ./wide.png 1280w, data:image/png;base64,AAAA 3x';
        const candidates = parsePreviewSrcset(source);
        expect(candidates).toEqual([
            { url: './small.png', descriptor: '1x' },
            { url: './large.png', descriptor: '2x' },
            { url: './wide.png', descriptor: '1280w' },
            { url: 'data:image/png;base64,AAAA', descriptor: '3x' },
        ]);
        expect(serializePreviewSrcset(candidates)).toBe(source);
    });

    it('loads only local Unicode package candidates', async () => {
        const reads: string[] = [];
        const prepared = await preparePreviewSrcset(
            './Grüße%20klein.png 1x, https://cdn.test/large.png 2x, data:image/png;base64,AAAA 3x',
            BASE_URL,
            SESSION_ID,
            async (path) => {
                reads.push(path);
                return Uint8Array.from([137, 80, 78, 71]).buffer;
            },
        );
        expect(reads).toEqual(['images/Grüße klein.png']);
        expect(prepared.candidates[0]).toMatchObject({
            url: `${ORIGIN}${PREVIEW_PREFIX}${SESSION_ID}/images/Gr%C3%BC%C3%9Fe%20klein.png`,
            descriptor: '1x',
            mimeType: 'image/png',
        });
        expect(prepared.candidates[1]?.buffer).toBeUndefined();
        expect(prepared.candidates[2]?.url).toBe('data:image/png;base64,AAAA');
    });
});
