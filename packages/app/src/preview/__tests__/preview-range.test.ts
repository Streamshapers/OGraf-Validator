import { describe, expect, it } from 'vitest';
import { parseSingleByteRange } from '../preview-range.js';

describe('parseSingleByteRange', () => {
    it('parses bounded, open-ended and suffix ranges', () => {
        expect(parseSingleByteRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 });
        expect(parseSingleByteRange('bytes=7-', 10)).toEqual({ start: 7, end: 9 });
        expect(parseSingleByteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
        expect(parseSingleByteRange('bytes=-30', 10)).toEqual({ start: 0, end: 9 });
    });

    it('clamps the end and rejects unsatisfiable or multipart ranges', () => {
        expect(parseSingleByteRange('bytes=7-99', 10)).toEqual({ start: 7, end: 9 });
        expect(parseSingleByteRange('bytes=10-', 10)).toBeNull();
        expect(parseSingleByteRange('bytes=5-2', 10)).toBeNull();
        expect(parseSingleByteRange('bytes=0-1,4-5', 10)).toBeNull();
        expect(parseSingleByteRange('bytes=-0', 10)).toBeNull();
    });
});
