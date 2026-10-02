import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    compareUpstreamSnapshots,
    createUpstreamClient,
    printUpstreamResult,
    runSpecUpstreamCheck,
} from './check-spec-upstream.mjs';

const API_ROOT = 'https://api.github.com/repos/ebu/ograf';
const PINNED = '1'.repeat(40);
const MAIN = '2'.repeat(40);
const MOVED_MAIN = '3'.repeat(40);
const hash = (value) => createHash('sha1').update(value).digest('hex');
const baseline = {
    LICENSE: 'MIT',
    'v1/specification/docs/Specification.md': 'Graphics specification',
    'v1/specification/docs/Specification_Server_API.md': 'Server API',
    'v1/specification/json-schemas/graphics/schema.json': '{}',
    'v1/specification/json-schemas/gdd/object.json': '{}',
    'v1/specification/json-schemas/gdd/README.md': 'GDD guidance',
    'v1/examples/l3rd-name/l3rd.ograf.json': '{}',
    'v1/examples/minimal/minimal.ograf.json': '{}',
    'v1/examples/ograf-logo/logo.ograf.json': '{}',
    'v1/examples/renderer-test/manifest.ograf.json': '{}',
    'v1/examples/l3rd-name/graphic.mjs': 'export default Graphic',
    'v1/examples/other/manifest.ograf.json': '{}',
    'v2/schema.json': '{}',
    'README.md': 'Repository README',
};

function makeFixture(upstreamFiles = baseline, pinnedFiles = baseline) {
    const responses = new Map();
    const calls = [];

    function buildTree(files) {
        const root = new Map();
        for (const [path, value] of Object.entries(files)) {
            const segments = path.split('/');
            let directory = root;
            for (const segment of segments.slice(0, -1)) {
                if (!directory.has(segment)) directory.set(segment, new Map());
                directory = directory.get(segment);
            }
            directory.set(segments.at(-1), typeof value === 'string'
                ? { type: 'blob', mode: '100644', sha: hash(value) }
                : value);
        }
        function storeTree(directory) {
            const tree = [...directory.entries()].sort(([left], [right]) => left.localeCompare(right))
                .map(([path, value]) => ({ path, ...(value instanceof Map
                    ? { type: 'tree', mode: '040000', sha: storeTree(value) }
                    : value) }));
            const sha = hash(JSON.stringify(tree));
            responses.set(`${API_ROOT}/git/trees/${sha}`, { sha, tree, truncated: false });
            return sha;
        }
        return storeTree(root);
    }

    for (const [commit, files] of [[PINNED, pinnedFiles], [MAIN, upstreamFiles]]) {
        responses.set(`${API_ROOT}/git/commits/${commit}`, { sha: commit, tree: { sha: buildTree(files) } });
    }
    responses.set(`${API_ROOT}/git/ref/heads/main`, {
        ref: 'refs/heads/main', object: { type: 'commit', sha: MAIN },
    });
    const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        if (!responses.has(url)) throw new Error(`Unexpected fixture request: ${url}`);
        return { ok: true, status: 200, redirected: false, url,
            json: async () => structuredClone(responses.get(url)) };
    };
    return { responses, calls, fetchImpl };
}

async function compare(fixture, options = {}) {
    return compareUpstreamSnapshots({ pinnedCommit: PINNED, fetchImpl: fixture.fetchImpl, ...options });
}

afterEach(() => vi.useRealTimers());

describe('upstream scope comparison', () => {
    it('is current when main advanced but scoped content did not change', async () => {
        const fixture = makeFixture({ ...baseline,
            'README.md': 'New repository README',
            'v1/specification/docs/Specification_Server_API.md': 'Changed server API',
            'v1/examples/l3rd-name/graphic.mjs': 'Changed module',
            'v1/examples/other/manifest.ograf.json': '{"changed":true}',
            'v2/schema.json': '{"changed":true}',
        });
        expect(await compare(fixture)).toEqual({
            status: 'current', exitCode: 0, pinnedCommit: PINNED, upstreamCommit: MAIN, changes: [],
            compareUrl: `https://github.com/ebu/ograf/compare/${PINNED}...${MAIN}`,
        });
    });

    it.each([
        'LICENSE', 'v1/specification/docs/Specification.md',
        'v1/specification/json-schemas/graphics/schema.json',
        'v1/specification/json-schemas/gdd/README.md',
        'v1/examples/l3rd-name/l3rd.ograf.json', 'v1/examples/minimal/minimal.ograf.json',
        'v1/examples/ograf-logo/logo.ograf.json', 'v1/examples/renderer-test/manifest.ograf.json',
    ])('detects an in-scope content change at %s', async (path) => {
        const result = await compare(makeFixture({ ...baseline, [path]: 'Changed content' }));
        expect(result).toMatchObject({ status: 'changed', exitCode: 1,
            changes: [{ path, kind: 'modified' }] });
    });

    it('reports added, deleted, renamed and changed schema paths in sorted order', async () => {
        const files = { ...baseline,
            'v1/specification/json-schemas/new/nested/not-json.txt': 'new schema companion',
            'v1/specification/json-schemas/renamed.json': baseline['v1/specification/json-schemas/gdd/object.json'],
        };
        delete files['v1/specification/json-schemas/gdd/object.json'];
        const result = await compare(makeFixture(files));
        expect(result).toMatchObject({ status: 'changed', exitCode: 1 });
        expect(result.changes).toEqual(expect.arrayContaining([
            { path: 'v1/specification/json-schemas/gdd/object.json', kind: 'deleted' },
            { path: 'v1/specification/json-schemas/renamed.json', kind: 'added' },
            { path: 'v1/specification/json-schemas/new/nested/not-json.txt', kind: 'added' },
        ]));
        expect(result.changes.map(({ path }) => path)).toEqual(result.changes.map(({ path }) => path).sort());
    });

    it('detects file-to-tree, symlink and ancestor type changes', async () => {
        const files = { ...baseline, LICENSE: { type: 'blob', mode: '120000', sha: hash('MIT') } };
        delete files['v1/specification/json-schemas/gdd/object.json'];
        files['v1/specification/json-schemas/gdd/object.json/child.json'] = '{}';
        const result = await compare(makeFixture(files));
        expect(result.changes).toContainEqual({ path: 'LICENSE', kind: 'type-changed' });
        expect(result.changes).toContainEqual({ path: 'v1/specification/json-schemas/gdd/object.json', kind: 'type-changed' });
        const replaced = Object.fromEntries(Object.entries(baseline).filter(([path]) => !path.startsWith('v1/')));
        replaced.v1 = 'A file replaced the directory';
        expect((await compare(makeFixture(replaced))).changes)
            .toContainEqual({ path: 'v1', kind: 'type-changed' });
    });

    it('resolves a moving main only once and uses immutable SHAs afterwards', async () => {
        const fixture = makeFixture();
        const originalFetch = fixture.fetchImpl;
        fixture.fetchImpl = async (url, options) => {
            const response = await originalFetch(url, options);
            if (url.endsWith('/git/ref/heads/main')) {
                const captured = await response.json();
                fixture.responses.set(url, { ref: 'refs/heads/main', object: { type: 'commit', sha: MOVED_MAIN } });
                response.json = async () => captured;
            }
            return response;
        };
        const result = await compare(fixture);
        expect(result.upstreamCommit).toBe(MAIN);
        expect(fixture.calls.filter(({ url }) => url.endsWith('/git/ref/heads/main'))).toHaveLength(1);
        expect(fixture.calls.some(({ url }) => url.includes(MOVED_MAIN))).toBe(false);
        expect(fixture.calls.every(({ url }) => !url.includes('?') && !url.includes('/commits/main'))).toBe(true);
    });

    it('caches nonrecursive tree reads by SHA across all paths and both commits', async () => {
        const fixture = makeFixture();
        expect((await compare(fixture)).status).toBe('current');
        const urls = fixture.calls.filter(({ url }) => url.includes('/git/trees/')).map(({ url }) => url);
        expect(new Set(urls).size).toBe(urls.length);
        expect(urls.length).toBeGreaterThan(2);
    });
});

describe('local prerequisite and output', () => {
    it('never fetches after a local integrity failure', async () => {
        const fetchImpl = vi.fn();
        const log = vi.fn();
        const result = await runSpecUpstreamCheck({ pinnedCommit: PINNED, fetchImpl, log,
            runLocalCheck: () => { throw new Error('Checksum mismatch'); },
        });
        expect(result).toMatchObject({ status: 'local-error', exitCode: 1, error: 'Checksum mismatch' });
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith('Local snapshot check failed: Checksum mismatch');
    });

    it('waits for successful local validation and prints both commits and a comparison link', async () => {
        const fixture = makeFixture({ ...baseline, LICENSE: 'Updated license' });
        let localPassed = false;
        const log = vi.fn();
        const result = await runSpecUpstreamCheck({ pinnedCommit: PINNED, log,
            runLocalCheck: async () => { await Promise.resolve(); localPassed = true; },
            fetchImpl: (...args) => { expect(localPassed).toBe(true); return fixture.fetchImpl(...args); },
        });
        expect(result.exitCode).toBe(1);
        const output = log.mock.calls.flat().join('\n');
        expect(output).toContain(PINNED);
        expect(output).toContain(MAIN);
        expect(output).toContain(`https://github.com/ebu/ograf/compare/${PINNED}...${MAIN}`);
        expect(output).toContain('do not by themselves establish normative');
        expect(output).toContain('- modified: "LICENSE"');
    });

    it('rejects malformed local commit metadata before making requests', async () => {
        const fetchImpl = vi.fn();
        const result = await runSpecUpstreamCheck({ pinnedCommit: '../main', fetchImpl,
            runLocalCheck: () => undefined, log: () => undefined,
        });
        expect(result.exitCode).toBe(1);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('prints unavailable without falsely claiming the snapshot is current', () => {
        const log = vi.fn();
        printUpstreamResult({ status: 'unavailable', pinnedCommit: PINNED, error: 'Offline' }, log);
        const output = log.mock.calls.flat().join('\n');
        expect(output).toContain('unavailable (not resolved)');
        expect(output).toContain('Upstream freshness unavailable: Offline');
        expect(output).not.toContain('Current:');
    });
});

describe('pinned upstream baseline completeness', () => {
    it('rejects complete-shaped empty roots instead of reporting current', async () => {
        const result = await compare(makeFixture({}, {}));
        expect(result).toMatchObject({ status: 'unavailable', exitCode: 2 });
        expect(result.error).toContain('Pinned upstream source');
        expect(result.error).toContain('LICENSE');
    });

    it.each([
        'LICENSE', 'v1/specification/docs/Specification.md',
        'v1/specification/json-schemas/graphics/schema.json',
        'v1/examples/l3rd-name/l3rd.ograf.json', 'v1/examples/minimal/minimal.ograf.json',
        'v1/examples/ograf-logo/logo.ograf.json', 'v1/examples/renderer-test/manifest.ograf.json',
    ])('requires the pinned regular file %s', async (path) => {
        const pinned = { ...baseline };
        delete pinned[path];
        const result = await compare(makeFixture(baseline, pinned));
        expect(result).toMatchObject({ status: 'unavailable', exitCode: 2 });
        expect(result.error).toContain(path);
    });

    it('requires the pinned schema directory and its main graphics schema', async () => {
        const pinned = Object.fromEntries(Object.entries(baseline)
            .filter(([path]) => !path.startsWith('v1/specification/json-schemas/')));
        const result = await compare(makeFixture(baseline, pinned));
        expect(result).toMatchObject({ status: 'unavailable', exitCode: 2 });
        expect(result.error).toContain('expected directory: v1/specification/json-schemas');
    });

    it('rejects a symlink or directory in place of an expected pinned file', async () => {
        const symlink = { ...baseline, LICENSE: { type: 'blob', mode: '120000', sha: hash('MIT') } };
        expect(await compare(makeFixture(baseline, symlink)))
            .toMatchObject({ status: 'unavailable', exitCode: 2 });
        const directory = { ...baseline, 'LICENSE/nested': 'MIT' };
        delete directory.LICENSE;
        expect(await compare(makeFixture(baseline, directory)))
            .toMatchObject({ status: 'unavailable', exitCode: 2 });
    });

    it('keeps upstream deletions as changes rather than unavailability', async () => {
        const result = await compare(makeFixture({}));
        expect(result).toMatchObject({ status: 'changed', exitCode: 1 });
        expect(result.changes).toContainEqual({ path: 'LICENSE', kind: 'deleted' });
        expect(result.changes).toContainEqual({
            path: 'v1/specification/json-schemas/graphics/schema.json', kind: 'deleted',
        });
    });
});

describe('upstream unavailability and safe HTTP behavior', () => {
    it.each([401, 403, 404, 429, 500, 302])('returns unavailable for HTTP %i', async (status) => {
        const result = await compareUpstreamSnapshots({ pinnedCommit: PINNED,
            fetchImpl: async () => ({ status, ok: false }),
        });
        expect(result).toMatchObject({ status: 'unavailable', exitCode: 2 });
        expect(result.error).toContain(`HTTP ${status}`);
    });

    it.each([
        null, [], {}, { ref: 'refs/heads/other', object: { type: 'commit', sha: MAIN } },
        { ref: 'refs/heads/main', object: { type: 'tree', sha: MAIN } },
        { ref: 'refs/heads/main', object: { type: 'commit', sha: 'short' } },
    ])('rejects malformed main references: %j', async (body) => {
        const fixture = makeFixture();
        fixture.responses.set(`${API_ROOT}/git/ref/heads/main`, body);
        expect(await compare(fixture)).toMatchObject({ status: 'unavailable', exitCode: 2 });
    });

    it.each([
        { sha: MOVED_MAIN, tree: { sha: MAIN } },
        { sha: MAIN, tree: { sha: 'not-a-sha' } },
        { sha: MAIN },
    ])('rejects malformed or mismatched commit responses', async (body) => {
        const fixture = makeFixture();
        fixture.responses.set(`${API_ROOT}/git/commits/${MAIN}`, body);
        expect(await compare(fixture)).toMatchObject({ status: 'unavailable', exitCode: 2, upstreamCommit: MAIN });
    });

    it.each(['truncated', 'unknown-completeness', 'wrong-sha', 'missing-tree', 'duplicate', 'nested-path', 'bad-mode', 'bad-type', 'bad-entry-sha'])(
    'rejects incomplete or malformed trees: %s', async (kind) => {
        const fixture = makeFixture();
        const sha = fixture.responses.get(`${API_ROOT}/git/commits/${MAIN}`).tree.sha;
        const tree = fixture.responses.get(`${API_ROOT}/git/trees/${sha}`);
        if (kind === 'truncated') tree.truncated = true;
        if (kind === 'unknown-completeness') delete tree.truncated;
        if (kind === 'wrong-sha') tree.sha = MOVED_MAIN;
        if (kind === 'missing-tree') delete tree.tree;
        if (kind === 'duplicate') tree.tree.push({ ...tree.tree[0] });
        if (kind === 'nested-path') tree.tree[0].path = 'nested/path';
        if (kind === 'bad-mode') tree.tree[0].mode = '040000';
        if (kind === 'bad-type') tree.tree[0].type = 'unknown';
        if (kind === 'bad-entry-sha') tree.tree[0].sha = 'short';
        expect(await compare(fixture)).toMatchObject({ status: 'unavailable', exitCode: 2 });
    });

    it('rejects cyclic schema trees rather than looping', async () => {
        const fixture = makeFixture();
        const tree = [...fixture.responses.values()].find((value) => value.tree?.some?.((entry) => entry.path === 'object.json'));
        tree.tree.push({ path: 'cycle', type: 'tree', mode: '040000', sha: tree.sha });
        const result = await compare(fixture);
        expect(result).toMatchObject({ status: 'unavailable', exitCode: 2 });
        expect(result.error).toContain('Cyclic');
    });

    it('does not expose response bodies, credentials, or thrown network exception text', async () => {
        const secret = 'test-private-token';
        const result = await compareUpstreamSnapshots({ pinnedCommit: PINNED, token: secret,
            fetchImpl: async () => { throw new Error(`Unexpected failure ${secret}`); },
        });
        expect(result).toMatchObject({ status: 'unavailable', exitCode: 2 });
        expect(JSON.stringify(result)).not.toContain(secret);
        const invalidJson = await compareUpstreamSnapshots({ pinnedCommit: PINNED,
            fetchImpl: async () => ({ ok: true, status: 200, json: () => { throw new Error(secret); } }),
        });
        expect(invalidJson.error).toContain('invalid JSON');
        expect(JSON.stringify(invalidJson)).not.toContain(secret);
    });

    it('sends the optional token only to fixed API URLs and never follows redirects', async () => {
        const fixture = makeFixture();
        await compare(fixture, { token: 'test-token' });
        for (const { url, options } of fixture.calls) {
            expect(new URL(url).origin).toBe('https://api.github.com');
            expect(options.redirect).toBe('error');
            expect(options.headers.Authorization).toBe('Bearer test-token');
            expect(options.headers['X-GitHub-Api-Version']).toBe('2026-03-10');
            expect(options.signal).toBeInstanceOf(AbortSignal);
        }
        const anonymous = makeFixture();
        await compare(anonymous);
        expect(anonymous.calls[0].options.headers).not.toHaveProperty('Authorization');
        const redirected = await compareUpstreamSnapshots({ pinnedCommit: PINNED, token: 'test-token',
            fetchImpl: async () => ({ ok: true, status: 200, redirected: true, url: 'https://elsewhere.test/' }),
        });
        expect(redirected).toMatchObject({ status: 'unavailable', exitCode: 2 });
    });

    it.each(['request', 'json'])('bounds the whole %s operation with a 15-second default timeout', async (stage) => {
        vi.useFakeTimers();
        let signal;
        const pending = compareUpstreamSnapshots({ pinnedCommit: PINNED,
            fetchImpl: async (_url, options) => {
                signal = options.signal;
                const forever = new Promise(() => undefined);
                return stage === 'request' ? forever : { ok: true, status: 200, json: () => forever };
            },
        });
        await vi.advanceTimersByTimeAsync(15_000);
        const result = await pending;
        expect(result).toMatchObject({ status: 'unavailable', exitCode: 2 });
        expect(result.error).toContain('timed out after 15000 ms');
        expect(signal.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('refuses arbitrary refs or routes in SHA-based client helpers', async () => {
        const fetchImpl = vi.fn();
        const client = createUpstreamClient({ fetchImpl, token: 'test-token' });
        expect(() => client.getCommitTree('../main')).toThrow(/full lowercase Git SHA/u);
        expect(() => client.getTree('https://elsewhere.test/')).toThrow(/full lowercase Git SHA/u);
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
