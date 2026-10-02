import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_ROOT = 'https://api.github.com/repos/ebu/ograf';
const REPOSITORY = 'https://github.com/ebu/ograf';
const REQUEST_TIMEOUT_MS = 15_000;
const SHA = /^[a-f0-9]{40}$/u;
const TREE_MODES = { blob: ['100644', '100755', '120000'], tree: ['040000'], commit: ['160000'] };

export const UPSTREAM_SCOPE = Object.freeze([
    { path: 'LICENSE', recursive: false },
    { path: 'v1/specification/docs/Specification.md', recursive: false },
    { path: 'v1/specification/json-schemas', recursive: true },
    { path: 'v1/examples/l3rd-name/l3rd.ograf.json', recursive: false },
    { path: 'v1/examples/minimal/minimal.ograf.json', recursive: false },
    { path: 'v1/examples/ograf-logo/logo.ograf.json', recursive: false },
    { path: 'v1/examples/renderer-test/manifest.ograf.json', recursive: false },
]);

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireSha(value, label) {
    if (typeof value !== 'string' || !SHA.test(value)) {
        throw new Error(`Malformed GitHub ${label}: expected a full lowercase Git SHA.`);
    }
    return value;
}

/** Uses only fixed GitHub API routes and never follows a redirect with credentials. */
export function createUpstreamClient({ fetchImpl = fetch, token, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid request timeout.');
    const trees = new Map();
    const commits = new Map();

    async function request(route) {
        const url = `${API_ROOT}${route}`;
        const controller = new AbortController();
        let timer;
        const deadline = new Promise((_, reject) => {
            timer = setTimeout(() => {
                controller.abort();
                reject(new Error(`GitHub request timed out after ${timeoutMs} ms: ${route}`));
            }, timeoutMs);
        });
        const operation = async () => {
            let response;
            try {
                response = await fetchImpl(url, {
                    method: 'GET',
                    redirect: 'error',
                    signal: controller.signal,
                    headers: {
                        Accept: 'application/vnd.github+json',
                        'X-GitHub-Api-Version': '2026-03-10',
                        ...(typeof token === 'string' && token.length > 0
                            ? { Authorization: `Bearer ${token}` } : {}),
                    },
                });
            } catch {
                throw new Error(`GitHub request failed: ${route}`);
            }
            if (!response || response.status !== 200 || response.ok !== true) {
                throw new Error(`GitHub returned HTTP ${response?.status ?? 'unknown'}: ${route}`);
            }
            if (response.redirected || (response.url && response.url !== url)) {
                throw new Error(`Unexpected GitHub response URL: ${route}`);
            }
            try {
                return await response.json();
            } catch {
                throw new Error(`GitHub returned invalid JSON: ${route}`);
            }
        };
        try {
            return await Promise.race([operation(), deadline]);
        } finally {
            clearTimeout(timer);
        }
    }

    async function resolveMain() {
        const result = await request('/git/ref/heads/main');
        if (!isRecord(result) || result.ref !== 'refs/heads/main' ||
            !isRecord(result.object) || result.object.type !== 'commit') {
            throw new Error('Malformed GitHub main reference.');
        }
        return requireSha(result.object.sha, 'main commit');
    }

    function getCommitTree(commit) {
        requireSha(commit, 'commit request');
        if (!commits.has(commit)) {
            commits.set(commit, request(`/git/commits/${commit}`).then((result) => {
                if (!isRecord(result) || result.sha !== commit || !isRecord(result.tree)) {
                    throw new Error(`Malformed GitHub commit response: ${commit}`);
                }
                return requireSha(result.tree.sha, 'commit tree');
            }));
        }
        return commits.get(commit);
    }

    function getTree(sha) {
        requireSha(sha, 'tree request');
        if (!trees.has(sha)) {
            trees.set(sha, request(`/git/trees/${sha}`).then((result) => {
                if (!isRecord(result) || result.sha !== sha || !Array.isArray(result.tree)) {
                    throw new Error(`Malformed GitHub tree response: ${sha}`);
                }
                if (result.truncated !== false) {
                    throw new Error(`GitHub tree is truncated or completeness is unknown: ${sha}`);
                }
                const entries = new Map();
                for (const entry of result.tree) {
                    if (!isRecord(entry) || typeof entry.path !== 'string' || !entry.path ||
                        entry.path === '.' || entry.path === '..' || /[\\/]/u.test(entry.path) ||
                        [...entry.path].some((character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127) ||
                        !Object.hasOwn(TREE_MODES, entry.type) ||
                        !TREE_MODES[entry.type].includes(entry.mode) || entries.has(entry.path)) {
                        throw new Error(`Malformed or duplicate GitHub tree entry: ${sha}`);
                    }
                    requireSha(entry.sha, 'tree entry');
                    entries.set(entry.path, { type: entry.type, mode: entry.mode, sha: entry.sha });
                }
                return entries;
            }));
        }
        return trees.get(sha);
    }

    return { resolveMain, getCommitTree, getTree };
}

/** Directory markers detect path/type changes without treating unrelated subtree edits as changes. */
export async function collectScopedEntries(rootTree, client) {
    const entries = new Map();
    const add = (path, entry) => entries.set(path, entry.type === 'tree'
        ? { type: entry.type, mode: entry.mode }
        : entry);

    async function walkTree(sha, path, ancestors = new Set()) {
        if (ancestors.has(sha)) throw new Error(`Cyclic GitHub tree data at ${path}.`);
        const nextAncestors = new Set([...ancestors, sha]);
        const children = await client.getTree(sha);
        for (const [name, entry] of children) {
            const childPath = `${path}/${name}`;
            add(childPath, entry);
            if (entry.type === 'tree') await walkTree(entry.sha, childPath, nextAncestors);
        }
    }

    for (const scope of UPSTREAM_SCOPE) {
        const segments = scope.path.split('/');
        let sha = rootTree;
        for (let index = 0; index < segments.length; index += 1) {
            const children = await client.getTree(sha);
            const entry = children.get(segments[index]);
            if (!entry) break;
            const path = segments.slice(0, index + 1).join('/');
            add(path, entry);
            if (index === segments.length - 1) {
                if (scope.recursive && entry.type === 'tree') await walkTree(entry.sha, path);
            } else if (entry.type === 'tree') {
                sha = entry.sha;
            } else {
                break;
            }
        }
    }
    return entries;
}

export function compareScopedEntries(pinned, upstream) {
    const changes = [];
    const paths = [...new Set([...pinned.keys(), ...upstream.keys()])].sort();
    for (const path of paths) {
        const before = pinned.get(path);
        const after = upstream.get(path);
        if (!before) changes.push({ path, kind: 'added' });
        else if (!after) changes.push({ path, kind: 'deleted' });
        else if (before.type !== after.type || before.mode !== after.mode) {
            changes.push({ path, kind: 'type-changed' });
        } else if (before.sha !== after.sha) changes.push({ path, kind: 'modified' });
    }
    return changes;
}

/** A complete-shaped API response must still contain the known pinned source baseline. */
export function validatePinnedScopedEntries(entries) {
    const expected = [
        ...UPSTREAM_SCOPE,
        { path: 'v1/specification/json-schemas/graphics/schema.json', recursive: false },
    ];
    for (const { path, recursive } of expected) {
        const entry = entries.get(path);
        const valid = recursive
            ? entry?.type === 'tree' && entry.mode === '040000'
            : entry?.type === 'blob' && ['100644', '100755'].includes(entry.mode);
        if (!valid) {
            throw new Error(`Pinned upstream source is missing an expected ${recursive ? 'directory' : 'regular file'}: ${path}`);
        }
    }
}

export async function compareUpstreamSnapshots({ pinnedCommit, ...options }) {
    requireSha(pinnedCommit, 'pinned commit');
    let upstreamCommit;
    try {
        const client = createUpstreamClient(options);
        upstreamCommit = await client.resolveMain();
        const [pinnedTree, upstreamTree] = await Promise.all([
            client.getCommitTree(pinnedCommit), client.getCommitTree(upstreamCommit),
        ]);
        const [pinned, upstream] = await Promise.all([
            collectScopedEntries(pinnedTree, client), collectScopedEntries(upstreamTree, client),
        ]);
        validatePinnedScopedEntries(pinned);
        const changes = compareScopedEntries(pinned, upstream);
        return {
            status: changes.length === 0 ? 'current' : 'changed',
            exitCode: changes.length === 0 ? 0 : 1,
            pinnedCommit, upstreamCommit, changes,
            compareUrl: `${REPOSITORY}/compare/${pinnedCommit}...${upstreamCommit}`,
        };
    } catch (error) {
        return {
            status: 'unavailable', exitCode: 2, pinnedCommit,
            ...(upstreamCommit ? {
                upstreamCommit, compareUrl: `${REPOSITORY}/compare/${pinnedCommit}...${upstreamCommit}`,
            } : {}),
            error: error instanceof Error ? error.message : 'Upstream comparison failed.',
        };
    }
}

export function printUpstreamResult(result, log = console.log) {
    if (result.status === 'local-error') {
        log(`Local snapshot check failed: ${result.error}`);
        return;
    }
    log(`Pinned snapshot commit: ${result.pinnedCommit}`);
    log(`Upstream main commit: ${result.upstreamCommit ?? 'unavailable (not resolved)'}`);
    if (result.compareUrl) log(`Comparison: ${result.compareUrl}`);
    if (result.status === 'unavailable') log(`Upstream freshness unavailable: ${result.error}`);
    else if (result.status === 'current') {
        log('Current: scoped upstream content matches the pinned snapshot.');
    } else {
        log('Changed: scoped upstream content differs and requires review.');
        log('Content changes do not by themselves establish normative specification changes.');
        for (const change of result.changes) log(`- ${change.kind}: ${JSON.stringify(change.path)}`);
    }
}

/** Local integrity is a prerequisite; a failed prerequisite never performs a network request. */
export async function runSpecUpstreamCheck({
    runLocalCheck = async () => (await import('./check-spec.mjs')).runSpecCheck(),
    pinnedCommit,
    log = console.log,
    token = process.env['GITHUB_TOKEN'],
    ...options
} = {}) {
    try {
        await runLocalCheck();
        pinnedCommit ??= (await import('./spec-snapshot.mjs')).snapshotMetadata.commit;
        requireSha(pinnedCommit, 'pinned commit');
    } catch (error) {
        const result = {
            status: 'local-error', exitCode: 1,
            error: error instanceof Error ? error.message : 'Local snapshot check failed.',
        };
        printUpstreamResult(result, log);
        return result;
    }
    const result = await compareUpstreamSnapshots({ pinnedCommit, token, ...options });
    printUpstreamResult(result, log);
    return result;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const result = await runSpecUpstreamCheck();
    process.exitCode = result.exitCode;
}
