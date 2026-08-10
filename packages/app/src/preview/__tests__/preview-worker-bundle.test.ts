import { describe, expect, it } from 'vitest';
import { buildPreviewWorkerBundle } from '../preview-worker-bundle.js';
import { PREVIEW_PREFIX } from '../preview-resources.js';

const ORIGIN = 'https://validator.test';
const SESSION_ID = '0123456789abcdef';
const BASE_URL = `${ORIGIN}${PREVIEW_PREFIX}${SESSION_ID}/`;

describe('preview Worker preparation', () => {
    it('bundles module imports, literal dynamic imports, JSON and package fetch URLs', async () => {
        const files = new Map<string, string>([
            ['worker.mjs', [
                "import settings from './settings.json';",
                "import { value } from './helper.mjs';",
                "self.onmessage = async () => self.postMessage([settings.name, value, (await import('./lazy.mjs')).lazy, await fetch(new URL('./data.txt', import.meta.url)).then(r => r.text())]);",
            ].join('\n')],
            ['settings.json', '{"name":"worker"}'],
            ['helper.mjs', 'export const value = 7;'],
            ['lazy.mjs', 'export const lazy = 9;'],
        ]);
        const bundle = await buildPreviewWorkerBundle(
            { url: `${BASE_URL}worker.mjs`, type: 'module' },
            SESSION_ID,
            async (path) => new TextEncoder().encode(files.get(path) ?? '').buffer,
        );
        expect(bundle.type).toBe('module');
        expect(bundle.source).toContain('worker');
        expect(bundle.source).toContain('data.txt');
        expect(bundle.source).not.toContain("import('./lazy.mjs')");
    });

    it('prepares classic importScripts dependencies in dependency-first order', async () => {
        const files = new Map<string, string>([
            ['worker.js', "importScripts('./dep.js'); self.postMessage(dep);"],
            ['dep.js', 'self.dep = 42;'],
        ]);
        const bundle = await buildPreviewWorkerBundle(
            { url: `${BASE_URL}worker.js`, type: 'classic' },
            SESSION_ID,
            async (path) => new TextEncoder().encode(files.get(path) ?? '').buffer,
        );
        expect(bundle.type).toBe('classic');
        expect(bundle.entries?.map(({ url }) => url)).toEqual([
            `${BASE_URL}dep.js`,
            `${BASE_URL}worker.js`,
        ]);
        expect(bundle.entries?.at(-1)?.source).toContain('/*__OGRAF_CLASSIC_classic-1__*/');
    });

    it('marks non-literal classic dependencies as unsupported', async () => {
        const bundle = await buildPreviewWorkerBundle(
            { url: `${BASE_URL}worker.js`, type: 'classic' },
            SESSION_ID,
            async () => new TextEncoder().encode("const file = './dep.js'; importScripts(file);").buffer,
        );
        expect(bundle.unsupportedReason).toMatch(/non-literal importScripts/);
    });
});
