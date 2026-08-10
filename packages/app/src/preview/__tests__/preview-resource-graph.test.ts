import { describe, expect, it } from 'vitest';
import { buildPreviewCssGraph } from '../preview-resource-graph.js';
import { PREVIEW_PREFIX } from '../preview-resources.js';

const ORIGIN = 'https://validator.test';
const SESSION_ID = '0123456789abcdef';
const BASE_URL = `${ORIGIN}${PREVIEW_PREFIX}${SESSION_ID}/styles/`;

describe('preview CSS resource graph', () => {
    it('prepares nested CSS, fonts, images and a cycle while preserving remote and data URLs', async () => {
        const files = new Map<string, string | Uint8Array>([
            ['styles/main.css', [
                '@import "./nested theme.css" screen;',
                '@font-face { src: url("../fonts/Grüße.woff2") format("woff2"); }',
                '.hero { background: url(data:image/svg+xml,%3Csvg%3E); mask: url(https://cdn.test/mask.svg); }',
            ].join('\n')],
            ['styles/nested theme.css', [
                '@import "./main.css";',
                '.card { background-image: url("../images/back plate.png"); }',
            ].join('\n')],
            ['fonts/Grüße.woff2', new Uint8Array([1, 2, 3])],
            ['images/back plate.png', new Uint8Array([137, 80, 78, 71])],
        ]);

        const graph = await buildPreviewCssGraph({
            sessionId: SESSION_ID,
            baseUrl: `${BASE_URL}main.css`,
            entryUrl: `${BASE_URL}main.css`,
            readFile: async (path) => {
                const value = files.get(path);
                if (value === undefined) throw new Error(`missing ${path}`);
                return typeof value === 'string'
                    ? new TextEncoder().encode(value).buffer
                    : Uint8Array.from(value).buffer;
            },
        });

        expect(graph.stylesheets).toHaveLength(2);
        expect(graph.stylesheets.at(-1)?.id).toBe(graph.entryId);
        expect(graph.assets.map(({ path }) => path).sort()).toEqual([
            'fonts/Grüße.woff2',
            'images/back plate.png',
        ]);
        expect(graph.stylesheets.at(-1)?.source).not.toContain('@import');
        expect(graph.stylesheets.at(-1)?.source).toContain('@media screen');
        expect(graph.stylesheets.at(-1)?.source).toContain('__OGRAF_ASSET_');
        expect(graph.stylesheets.at(-1)?.source).toContain('data:image/svg+xml,%3Csvg%3E');
        expect(graph.stylesheets.at(-1)?.source).toContain('https://cdn.test/mask.svg');
        expect(graph.warnings).toEqual(['Ignored circular CSS import "styles/main.css".']);
    });

    it('rejects a relative URL that leaves the active session', async () => {
        await expect(buildPreviewCssGraph({
            sessionId: SESSION_ID,
            baseUrl: `${ORIGIN}${PREVIEW_PREFIX}${SESSION_ID}/main.css`,
            source: '.bad { background: url("../../secret.png") }',
            readFile: async () => new ArrayBuffer(0),
        })).rejects.toMatchObject({
            code: 'SESSION_ESCAPE',
            resourceKind: 'asset',
        });
    });
});
