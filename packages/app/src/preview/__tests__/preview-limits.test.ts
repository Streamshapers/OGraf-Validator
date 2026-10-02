import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPreviewModuleGraph } from '../preview-module-graph.js';
import { buildPreviewWorkerBundle } from '../preview-worker-bundle.js';
import { buildPreviewCssGraph, PreviewResourceGraphError } from '../preview-resource-graph.js';
import { PreviewDiagnosticError } from '../preview-errors.js';
import { serializeResourceError } from '../preview-runner-client.js';

const SESSION = '0123456789abcdef';
const BASE = `https://validator.test/__ograf_preview__/${SESSION}/`;
const encode = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;

describe('preview implementation limits are inconclusive', () => {
    beforeEach(() => vi.stubGlobal('location', { origin: 'https://validator.test' }));
    afterEach(() => vi.unstubAllGlobals());

    it('tags module count and byte limits at their source', async () => {
        await expect(buildPreviewModuleGraph(`${BASE}0.mjs`, SESSION, async (path) => {
            const next = Number.parseInt(path, 10) + 1;
            return encode(`import './${next}.mjs';`);
        })).rejects.toMatchObject({ diagnostic: { code: 'PREVIEW_LIMITATION', reason: 'module-count-limit' } });
        await expect(buildPreviewModuleGraph(`${BASE}main.mjs`, SESSION,
            async () => new ArrayBuffer(32 * 1024 * 1024 + 1),
        )).rejects.toMatchObject({ diagnostic: { code: 'PREVIEW_LIMITATION', reason: 'module-byte-limit' } });
    });

    it.each(['classic', 'module'] as const)('tags %s worker byte and file limits', async (type) => {
        await expect(buildPreviewWorkerBundle({ url: `${BASE}0.js`, type }, SESSION,
            async () => new ArrayBuffer(16 * 1024 * 1024 + 1),
        )).rejects.toMatchObject({ diagnostic: { code: 'PREVIEW_LIMITATION', reason: 'worker-bytes-limit' } });
        await expect(buildPreviewWorkerBundle({ url: `${BASE}0.js`, type }, SESSION, async (path) => {
            const next = Number.parseInt(path, 10) + 1;
            return encode(type === 'module' ? `import './${next}.js';` : `importScripts('./${next}.js');`);
        })).rejects.toMatchObject({ diagnostic: { code: 'PREVIEW_LIMITATION', reason: 'worker-files-limit' } });
    });

    it('retains CSS count and byte limit metadata across trusted serialization', async () => {
        await expect(buildPreviewCssGraph({ sessionId: SESSION, baseUrl: `${BASE}0.css`,
            entryUrl: `${BASE}0.css`, readFile: async (path) => encode(`@import './${Number.parseInt(path, 10) + 1}.css';`),
        })).rejects.toMatchObject({ diagnostic: { code: 'PREVIEW_LIMITATION', reason: 'TOO_MANY_STYLESHEETS' } });
        await expect(buildPreviewCssGraph({ sessionId: SESSION, baseUrl: `${BASE}0.css`,
            entryUrl: `${BASE}0.css`, readFile: async () => new ArrayBuffer(32 * 1024 * 1024 + 1),
        })).rejects.toMatchObject({ diagnostic: { code: 'PREVIEW_LIMITATION', reason: 'RESOURCE_GRAPH_TOO_LARGE' } });
        const error = new PreviewResourceGraphError({
            code: 'TOO_MANY_ASSETS', resourceKind: 'asset', path: 'image.png', message: 'Limit reached',
        });
        expect(error).toBeInstanceOf(PreviewDiagnosticError);
        expect(serializeResourceError(error)).toMatchObject({ diagnostic: {
            code: 'PREVIEW_LIMITATION', reason: 'TOO_MANY_ASSETS',
        } });
    });

    it('does not turn actual resource failures or forged codes into limitations', () => {
        expect(serializeResourceError(new PreviewResourceGraphError({
            code: 'RESOURCE_READ_FAILED', resourceKind: 'asset', path: 'missing.png', message: 'Missing',
        })).diagnostic).toBeUndefined();
        expect(serializeResourceError(Object.assign(new Error('Limit'), {
            diagnostic: { code: 'PREVIEW_LIMITATION' },
        })).diagnostic).toBeUndefined();
    });
});
