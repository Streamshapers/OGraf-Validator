import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    generateValidatorSource,
    generatedValidatorPath as defaultGeneratedValidatorPath,
} from './generate-standalone-validator.mjs';
import {
    assertCurrentSnapshotReferences,
    assertSnapshotReferences,
    loadSnapshotMetadata,
    packageRoot,
    validateSnapshotMarkdown,
} from './spec-snapshot.mjs';

function normalizedRelativePath(path, snapshotRoot) {
    return relative(snapshotRoot, path).replaceAll('\\', '/');
}

function collectFiles(directory, snapshotRoot) {
    return readdirSync(directory)
        .map((name) => resolve(directory, name))
        .flatMap((path) => {
            const details = lstatSync(path);
            if (details.isSymbolicLink()) {
                throw new Error(`Snapshot must not contain symbolic links: ${normalizedRelativePath(path, snapshotRoot)}`);
            }
            if (details.isDirectory()) return collectFiles(path, snapshotRoot);
            if (!details.isFile()) {
                throw new Error(`Snapshot contains a non-regular file: ${normalizedRelativePath(path, snapshotRoot)}`);
            }
            return [path];
        });
}

function sha256(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function isCanonicalChecksumPath(path) {
    if (path === '' || path === 'SHA256SUMS') return false;
    if (path.includes('\\') || path.startsWith('/') || path.startsWith('./')) return false;
    if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
        return false;
    }
    return posix.normalize(path) === path;
}

export function parseChecksumManifest(content) {
    const expected = new Map();
    for (const line of content.split(/\r?\n/u).filter(Boolean)) {
        const match = /^([a-f0-9]{64}) {2}(.+)$/u.exec(line);
        if (match === null) throw new Error(`Malformed SHA256SUMS line: ${line}`);
        const path = match[2];
        const hash = match[1];
        if (path === undefined || hash === undefined || !isCanonicalChecksumPath(path)) {
            throw new Error(`Unsafe or non-canonical SHA256SUMS path: ${String(path)}`);
        }
        if (expected.has(path)) throw new Error(`Duplicate SHA256SUMS path: ${path}`);
        expected.set(path, hash);
    }
    if (expected.size === 0) throw new Error('SHA256SUMS must contain at least one file.');
    return expected;
}

function readUtf8(path) {
    return readFileSync(path, 'utf8');
}

// Overrides allow fixture repositories to exercise the complete read-only check.
// Production and online-check callers retain the no-argument entry point.
export function runSpecCheck({
    packageDirectory = packageRoot,
    generateSource = generateValidatorSource,
    log = console.log,
} = {}) {
    const repositoryRoot = resolve(packageDirectory, '../..');
    const specRoot = resolve(packageDirectory, 'spec');
    const snapshotMetadata = loadSnapshotMetadata(specRoot);
    const snapshotRoot = resolve(specRoot, snapshotMetadata.directory);
    const checksumPath = resolve(snapshotRoot, 'SHA256SUMS');
    const generatedValidatorPath = resolve(
        packageDirectory,
        relative(packageRoot, defaultGeneratedValidatorPath),
    );
    if (!existsSync(checksumPath)) {
        throw new Error(`Missing snapshot checksum file: ${checksumPath}`);
    }

    const snapshotMarkdown = readUtf8(resolve(snapshotRoot, 'SNAPSHOT.md'));
    validateSnapshotMarkdown(snapshotMetadata, snapshotMarkdown);

    assertCurrentSnapshotReferences(snapshotMetadata, [
        {
            label: 'README.md',
            content: readUtf8(resolve(repositoryRoot, 'README.md')),
            tokens: [
                snapshotMetadata.commit,
                snapshotMetadata.shortCommit,
                `packages/validator-core/spec/${snapshotMetadata.directory}`,
                snapshotMetadata.sourceDateDisplay,
            ],
        },
        {
            label: 'packages/validator-core/README.md',
            content: readUtf8(resolve(packageDirectory, 'README.md')),
            tokens: [
                snapshotMetadata.commit,
                snapshotMetadata.shortCommit,
                `spec/${snapshotMetadata.directory}`,
                snapshotMetadata.sourceDateDisplay,
            ],
        },
    ]);
    assertSnapshotReferences([{
        label: 'packages/validator-core/CHANGELOG.md',
        content: readUtf8(resolve(packageDirectory, 'CHANGELOG.md')),
        tokens: [snapshotMetadata.shortCommit],
    }]);

    const expected = parseChecksumManifest(readUtf8(checksumPath));
    const actualFiles = collectFiles(snapshotRoot, snapshotRoot)
        .map((path) => normalizedRelativePath(path, snapshotRoot))
        .filter((path) => path !== 'SHA256SUMS')
        .sort();

    for (const path of actualFiles) {
        const expectedHash = expected.get(path);
        if (expectedHash === undefined) {
            throw new Error(`Snapshot file is not pinned in SHA256SUMS: ${path}`);
        }
        const actualHash = sha256(resolve(snapshotRoot, path));
        if (actualHash !== expectedHash) throw new Error(`Snapshot checksum mismatch: ${path}`);
        expected.delete(path);
    }
    if (expected.size > 0) {
        throw new Error(`SHA256SUMS references missing files: ${[...expected.keys()].join(', ')}`);
    }

    if (!existsSync(generatedValidatorPath)) {
        throw new Error(`Missing generated validator: ${generatedValidatorPath}`);
    }
    if (readUtf8(generatedValidatorPath) !== generateSource()) {
        throw new Error('Generated validator drift detected. Run npm run generate:validator.');
    }

    log(
        `Pinned OGraf snapshot ${snapshotMetadata.shortCommit}, documentation, checksums, ` +
        'and generated validator are locally consistent; upstream freshness was not checked.',
    );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runSpecCheck();
}
