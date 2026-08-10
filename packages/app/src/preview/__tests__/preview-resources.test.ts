import { describe, expect, it } from 'vitest';
import {
    PREVIEW_PREFIX,
    PREVIEW_PROTOCOL_VERSION,
    assertPreviewSessionId,
    buildPreviewResourceUrl,
    createPreviewSecurityToken,
    createPreviewSessionId,
    normalizePreviewPath,
    parsePreviewResourceUrl,
} from '../preview-resources.js';
import { isPreviewFileRequest, requestTargetsTab } from '../preview-protocol.js';

describe('preview resource paths', () => {
    it('normalizes separators and Unicode to NFC', () => {
        expect(normalizePreviewPath('assets\\Cafe\u0301.png')).toBe('assets/Caf\u00e9.png');
    });

    it.each([
        '../secret.mjs',
        'assets/../../secret.mjs',
        'C:\\secret.mjs',
        '/absolute.mjs',
        'https://example.test/main.mjs',
        '\\server\\share\\main.mjs',
    ])('rejects traversal or absolute path %s', (path) => {
        expect(() => normalizePreviewPath(path)).toThrow();
    });

    it('round-trips an encoded, sessionized URL', () => {
        const sessionId = '0123456789abcdef';
        const url = buildPreviewResourceUrl('graphics/Gr\u00fc\u00dfe main.mjs', sessionId, 'https://validator.test');
        expect(url).toBe(`https://validator.test${PREVIEW_PREFIX}${sessionId}/graphics/Gr%C3%BC%C3%9Fe%20main.mjs`);
        expect(parsePreviewResourceUrl(url, 'https://validator.test')).toEqual({
            sessionId,
            path: 'graphics/Gr\u00fc\u00dfe main.mjs',
        });
    });

    it('rejects a cross-origin resource URL', () => {
        expect(() => parsePreviewResourceUrl(
            `https://other.test${PREVIEW_PREFIX}0123456789abcdef/main.mjs`,
            'https://validator.test',
        )).toThrow();
    });
});

describe('preview session protocol', () => {
    it('uses the postMessage protocol and session namespace', () => {
        expect(PREVIEW_PROTOCOL_VERSION).toBe(3);
        expect(PREVIEW_PREFIX).toBe('/__ograf_preview__/');
    });

    it('generates valid unguessable session ids and tab tokens', () => {
        const sessionId = createPreviewSessionId();
        expect(assertPreviewSessionId(sessionId)).toBe(sessionId);
        expect(sessionId.length).toBeGreaterThanOrEqual(16);
        expect(createPreviewSecurityToken()).toMatch(/^[a-f0-9]{64}$/);
    });

    it('targets a registered tab token and permits only the restart fallback', () => {
        const request = {
            protocol: PREVIEW_PROTOCOL_VERSION,
            type: 'OGRAF_PREVIEW_FILE_REQUEST' as const,
            requestId: 'request',
            sessionId: '0123456789abcdef',
            path: 'main.mjs',
            tabToken: 'a'.repeat(64),
        };
        expect(isPreviewFileRequest(request)).toBe(true);
        expect(requestTargetsTab(request, 'a'.repeat(64))).toBe(true);
        expect(requestTargetsTab(request, 'b'.repeat(64))).toBe(false);
        expect(requestTargetsTab({ ...request, tabToken: undefined }, 'b'.repeat(64))).toBe(true);
    });
});
