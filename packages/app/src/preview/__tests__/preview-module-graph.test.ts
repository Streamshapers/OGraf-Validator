import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildPreviewModuleGraph,
    rewritePreviewModuleSource,
    syntheticModuleSpecifier,
} from '../preview-module-graph.js';
import { PREVIEW_PREFIX } from '../preview-resources.js';

const ORIGIN = 'https://validator.test';
const SESSION_ID = '0123456789abcdef';
const BASE_URL = `${ORIGIN}${PREVIEW_PREFIX}${SESSION_ID}/`;

describe('opaque-sandbox preview module graph', () => {
    beforeEach(() => {
        vi.stubGlobal('location', { origin: ORIGIN });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('rewrites Unicode static, export-from, and literal dynamic imports into a cyclic graph', async () => {
        const files = new Map<string, string>([
            ['main.mjs', [
                "import { label } from './helpers/über helper.mjs';",
                "export { cycle } from './cycle.mjs';",
                "export const later = () => import('./cycle.mjs');",
                'export default label;',
            ].join('\n')],
            ['helpers/über helper.mjs', "export const label = 'OK';"],
            ['cycle.mjs', "import value from './main.mjs'; export const cycle = value;"],
        ]);
        const reads: string[] = [];

        const graph = await buildPreviewModuleGraph(
            `${BASE_URL}main.mjs`,
            SESSION_ID,
            async (path) => {
                reads.push(path);
                const source = files.get(path);
                if (source === undefined) throw new Error(`missing ${path}`);
                return new TextEncoder().encode(source).buffer;
            },
        );

        expect(reads).toEqual(['main.mjs', 'helpers/über helper.mjs', 'cycle.mjs']);
        expect(graph.modules).toHaveLength(3);
        expect(graph.entrySpecifier).toBe(syntheticModuleSpecifier(`${BASE_URL}main.mjs`));
        const main = graph.modules.find(({ url }) => url.endsWith('/main.mjs'));
        expect(main?.source).toContain(syntheticModuleSpecifier(`${BASE_URL}helpers/%C3%BCber%20helper.mjs`));
        expect(main?.source).toContain(syntheticModuleSpecifier(`${BASE_URL}cycle.mjs`));
    });

    it('ignores import-looking comments and regular expressions', () => {
        const rewritten = rewritePreviewModuleSource([
            '// import "./comment.mjs";',
            'const matcher = /import\\s+"\\.\\/regex.mjs"/;',
            'import "./real.mjs";',
        ].join('\n'), `${BASE_URL}main.mjs`, SESSION_ID);

        expect(rewritten.dependencies).toEqual([`${BASE_URL}real.mjs`]);
        expect(rewritten.source).toContain('import "./comment.mjs"');
        expect(rewritten.source).toContain(syntheticModuleSpecifier(`${BASE_URL}real.mjs`));
    });

    it('rejects a relative import that escapes its session namespace', () => {
        expect(() => rewritePreviewModuleSource(
            'import "../../outside.mjs";',
            `${BASE_URL}main.mjs`,
            SESSION_ID,
        )).toThrow(/escapes the preview package session/);
    });

    it('includes and rewrites literal import.meta.url assets for the opaque sandbox', async () => {
        const files = new Map<string, string | Uint8Array>([
            ['main.mjs', [
                "export const image = new URL('./images/score board.png', import.meta.url);",
                "export const worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });",
            ].join('\n')],
            ['images/score board.png', new Uint8Array([137, 80, 78, 71])],
            ['worker.mjs', 'self.postMessage("ready");'],
        ]);

        const graph = await buildPreviewModuleGraph(
            `${BASE_URL}main.mjs`,
            SESSION_ID,
            async (path) => {
                const value = files.get(path);
                if (value === undefined) throw new Error(`missing ${path}`);
                return typeof value === 'string'
                    ? new TextEncoder().encode(value).buffer
                    : Uint8Array.from(value).buffer;
            },
        );

        expect(graph.modules.map(({ url }) => url)).toEqual([
            `${BASE_URL}main.mjs`,
            `${BASE_URL}images/score%20board.png`,
            `${BASE_URL}worker.mjs`,
        ]);
        const main = graph.modules[0];
        expect(main?.source).toContain('globalThis.__ografValidatorResolveAsset');
        expect(main?.source).toContain(syntheticModuleSpecifier(`${BASE_URL}images/score%20board.png`));
        expect(main?.source).toContain(syntheticModuleSpecifier(`${BASE_URL}worker.mjs`));
        expect(graph.workers).toHaveLength(1);
        expect(graph.workers[0]).toMatchObject({
            url: `${BASE_URL}worker.mjs`,
            type: 'module',
        });
        expect(graph.workers[0]?.source).toContain('postMessage');
    });

    it('does not flag unused SharedWorker or dynamic Worker code', async () => {
        const source = [
            "new SharedWorker('./shared.mjs', { type: 'module' });",
            "const workerPath = './dynamic.mjs';",
            'new Worker(workerPath, { type: \'module\' });',
        ].join('\n');
        const graph = await buildPreviewModuleGraph(
            `${BASE_URL}main.mjs`,
            SESSION_ID,
            async (path) => {
                if (path !== 'main.mjs') throw new Error(`unexpected read: ${path}`);
                return new TextEncoder().encode(source).buffer;
            },
        );

        expect(graph.workers).toEqual([]);
        expect(graph.diagnostics).toEqual([]);
    });

    it('preserves import.meta.url directory bases without reading them as files', async () => {
        const source = [
            "const assetBase = new URL('./assets/', import.meta.url);",
            "export default class Graphic extends HTMLElement {}",
        ].join('\n');
        const reads: string[] = [];
        const graph = await buildPreviewModuleGraph(
            `${BASE_URL}main.mjs`,
            SESSION_ID,
            async (path) => {
                reads.push(path);
                if (path !== 'main.mjs') throw new Error(`unexpected read: ${path}`);
                return new TextEncoder().encode(source).buffer;
            },
        );

        expect(reads).toEqual(['main.mjs']);
        expect(graph.modules[0]?.source).toContain(`new URL("${BASE_URL}assets/")`);
    });

    it('preserves original module URLs for non-literal import.meta.url expressions', () => {
        const rewritten = rewritePreviewModuleSource([
            "const baseSpecifier = './lib/images/';",
            'export const base = new URL(baseSpecifier, import.meta.url);',
            'export const moduleUrl = import.meta.url;',
            'const untouched = "import.meta.url";',
            '// import.meta.url',
        ].join('\n'), `${BASE_URL}main.mjs`, SESSION_ID);

        expect(rewritten.dependencies).toEqual([]);
        expect(rewritten.source).toContain(
            `new URL(baseSpecifier, "${BASE_URL}main.mjs")`,
        );
        expect(rewritten.source).toContain(
            `export const moduleUrl = "${BASE_URL}main.mjs";`,
        );
        expect(rewritten.source).toContain('const untouched = "import.meta.url";');
        expect(rewritten.source).toContain('// import.meta.url');
    });

    it('rewrites literal imports inside template expressions', () => {
        const rewritten = rewritePreviewModuleSource(
            "const lazy = `${import('./lazy.mjs')}`;",
            `${BASE_URL}main.mjs`,
            SESSION_ID,
        );

        expect(rewritten.dependencies).toEqual([`${BASE_URL}lazy.mjs`]);
        expect(rewritten.source).toContain(syntheticModuleSpecifier(`${BASE_URL}lazy.mjs`));
    });

    it('rewrites non-literal dynamic imports through the sandbox resolver', () => {
        const rewritten = rewritePreviewModuleSource(
            'export const load = (specifier) => import(specifier);',
            `${BASE_URL}main.mjs`,
            SESSION_ID,
        );

        expect(rewritten.requiresPackageModuleListing).toBe(true);
        expect(rewritten.source).toContain(
            'import(globalThis.__ografValidatorResolveImport((specifier),',
        );
    });

    it('preloads package-local module candidates for non-literal dynamic imports', async () => {
        const files = new Map<string, string>([
            ['main.mjs', "const path = './lazy.mjs'; export const lazy = () => import(path);"],
            ['lazy.mjs', "export const value = 'lazy';"],
            ['unused.json', '{}'],
            ['ignored.png', 'PNG'],
        ]);
        const graph = await buildPreviewModuleGraph(
            `${BASE_URL}main.mjs`,
            SESSION_ID,
            async (path) => {
                const value = files.get(path);
                if (value === undefined) throw new Error(`missing ${path}`);
                return new TextEncoder().encode(value).buffer;
            },
            undefined,
            async () => [...files.keys()],
        );

        expect(graph.modules.map(({ url }) => url)).toEqual([
            `${BASE_URL}main.mjs`,
            `${BASE_URL}lazy.mjs`,
            `${BASE_URL}unused.json`,
        ]);
    });

    it('resolves Ferryman-style import.meta.resolve calls against the package session', async () => {
        const files = new Map<string, string>([
            ['main.mjs', [
                "const player = './lib/lottie-web.esm.mjs';",
                "const animation = './lib/lottie-template.json';",
                'export async function load() {',
                '  const module = await import(import.meta.resolve(player));',
                '  const data = await fetch(import.meta.resolve(animation)).then((response) => response.json());',
                '  return { module, data };',
                '}',
            ].join('\n')],
            ['lib/lottie-web.esm.mjs', 'export const version = "test";'],
            ['lib/lottie-template.json', '{"layers":[]}'],
        ]);
        const graph = await buildPreviewModuleGraph(
            `${BASE_URL}main.mjs`,
            SESSION_ID,
            async (path) => {
                const value = files.get(path);
                if (value === undefined) throw new Error(`missing ${path}`);
                return new TextEncoder().encode(value).buffer;
            },
            undefined,
            async () => [...files.keys()],
        );

        const main = graph.modules.find(({ url }) => url.endsWith('/main.mjs'));
        expect(main?.source).not.toContain('import.meta.resolve');
        expect(main?.source).toContain('globalThis.__ografValidatorResolveMeta');
        expect(main?.source).toContain('globalThis.__ografValidatorResolveImport');
        expect(graph.modules.map(({ url }) => url)).toContain(`${BASE_URL}lib/lottie-web.esm.mjs`);
        expect(graph.modules.map(({ url }) => url)).toContain(`${BASE_URL}lib/lottie-template.json`);
    });

    it('preloads literal import.meta.resolve assets used by DOM elements', async () => {
        const files = new Map<string, string>([
            ['main.mjs', [
                'export function loadLogo() {',
                '  const image = new Image();',
                '  image.src = import.meta.resolve("./lib/ograf-logo.svg");',
                '  return image;',
                '}',
            ].join('\n')],
            ['lib/ograf-logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
        ]);
        const reads: string[] = [];
        const graph = await buildPreviewModuleGraph(
            `${BASE_URL}main.mjs`,
            SESSION_ID,
            async (path) => {
                reads.push(path);
                const value = files.get(path);
                if (value === undefined) throw new Error(`missing ${path}`);
                return new TextEncoder().encode(value).buffer;
            },
        );

        expect(reads).toEqual(['main.mjs', 'lib/ograf-logo.svg']);
        expect(graph.modules.map(({ url }) => url)).toContain(`${BASE_URL}lib/ograf-logo.svg`);
        expect(graph.modules[0]?.source).toContain('globalThis.__ografValidatorResolveMeta');
    });
});
