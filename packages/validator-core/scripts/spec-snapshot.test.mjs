import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseChecksumManifest, runSpecCheck } from './check-spec.mjs';
import {
    assertCurrentSnapshotReferences,
    assertSnapshotReferences,
    formatSnapshotDate,
    loadSnapshotMetadata,
    snapshotMetadata,
    validateSnapshotMarkdown,
    validateSnapshotMetadata,
} from './spec-snapshot.mjs';

const validValue = {
    formatVersion: 1,
    specification: 'OGraf Graphics v1',
    upstreamRepository: 'https://github.com/ebu/ograf',
    commit: '0123456789abcdef0123456789abcdef01234567',
    sourceDate: '2026-08-07',
};
const temporaryRoots = [];

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const root of temporaryRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

function createSpecCheckFixture() {
    const root = mkdtempSync(resolve(tmpdir(), 'ograf-spec-check-'));
    temporaryRoots.push(root);
    const packageDirectory = resolve(root, 'packages/validator-core');
    const directory = `ebu-ograf-v1-${validValue.commit.slice(0, 8)}`;
    const snapshotDirectory = resolve(packageDirectory, 'spec', directory);
    const generatedPath = resolve(packageDirectory, 'src/generated/ograf-manifest-validator.ts');
    mkdirSync(resolve(snapshotDirectory, 'docs'), { recursive: true });
    mkdirSync(resolve(packageDirectory, 'src/generated'), { recursive: true });

    const files = new Map([
        ['SNAPSHOT.json', `${JSON.stringify(validValue, null, 2)}\n`],
        ['SNAPSHOT.md', [
            `- Commit: \`${validValue.commit}\``,
            `- Commit URL: https://github.com/ebu/ograf/tree/${validValue.commit}`,
            `- Source date: ${validValue.sourceDate}`,
            '- Vendored paths: `v1/specification/docs/Specification.md`, ' +
                '`v1/specification/json-schemas/**`, and the four upstream ' +
                '`v1/examples/*.ograf.json` manifests',
        ].join('\n')],
        ['docs/Specification.md', '# Fixture specification\n'],
    ]);
    for (const [path, content] of files) {
        writeFileSync(resolve(snapshotDirectory, path), content);
    }
    const checksums = [...files].map(([path, content]) =>
        `${createHash('sha256').update(content).digest('hex')}  ${path}\n`).join('');
    writeFileSync(resolve(snapshotDirectory, 'SHA256SUMS'), checksums);
    const readme = [
        validValue.commit,
        `packages/validator-core/spec/${directory}`,
        formatSnapshotDate(validValue.sourceDate),
    ].join('\n');
    writeFileSync(resolve(root, 'README.md'), readme);
    writeFileSync(resolve(packageDirectory, 'README.md'), readme);
    writeFileSync(resolve(packageDirectory, 'CHANGELOG.md'), validValue.commit.slice(0, 8));
    const generatedSource = '// Expected standalone validator\n';
    writeFileSync(generatedPath, generatedSource);

    return {
        root,
        packageDirectory,
        snapshotDirectory,
        generatedPath,
        files,
        checksums,
        options: {
            packageDirectory,
            generateSource: vi.fn(() => generatedSource),
            log: vi.fn(),
        },
    };
}

function createSpecRoot(directories) {
    const root = mkdtempSync(resolve(tmpdir(), 'ograf-spec-snapshot-'));
    temporaryRoots.push(root);
    for (const directory of directories) {
        const snapshotRoot = resolve(root, directory);
        mkdirSync(snapshotRoot);
        writeFileSync(
            resolve(snapshotRoot, 'SNAPSHOT.json'),
            `${JSON.stringify(validValue, null, 2)}\n`,
            'utf8',
        );
    }
    return root;
}

describe('OGraf snapshot metadata', () => {
    it('loads the current repository snapshot', () => {
        expect(snapshotMetadata.commit).toMatch(/^[a-f0-9]{40}$/u);
        expect(snapshotMetadata.directory).toBe(
            `ebu-ograf-v1-${snapshotMetadata.commit.slice(0, 8)}`,
        );
        expect(snapshotMetadata.sourceDateDisplay).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/u);
    });

    it('validates and derives the active snapshot identity', () => {
        expect(validateSnapshotMetadata(validValue, 'ebu-ograf-v1-01234567')).toMatchObject({
            commit: validValue.commit,
            directory: 'ebu-ograf-v1-01234567',
            shortCommit: '01234567',
            sourceDateDisplay: '7 August 2026',
        });
        expect(formatSnapshotDate('2024-02-29')).toBe('29 February 2024');
    });

    it('rejects malformed commits, impossible dates, extra keys, and stale directory names', () => {
        expect(() => validateSnapshotMetadata(
            { ...validValue, commit: '01234567' },
            'ebu-ograf-v1-01234567',
        )).toThrow(/40-character Git SHA/u);
        expect(() => validateSnapshotMetadata(
            { ...validValue, sourceDate: '2026-02-31' },
            'ebu-ograf-v1-01234567',
        )).toThrow(/real date/u);
        expect(() => validateSnapshotMetadata(
            { ...validValue, extra: true },
            'ebu-ograf-v1-01234567',
        )).toThrow(/exactly these keys/u);
        expect(() => validateSnapshotMetadata(
            validValue,
            'ebu-ograf-v1-deadbeef',
        )).toThrow(/must be ebu-ograf-v1-01234567/u);
    });

    it('requires exactly one snapshot directory', () => {
        expect(() => loadSnapshotMetadata(createSpecRoot([]))).toThrow(/exactly one/u);
        expect(() => loadSnapshotMetadata(createSpecRoot([
            'ebu-ograf-v1-01234567',
            'ebu-ograf-v1-deadbeef',
        ]))).toThrow(/exactly one/u);
    });

    it('rejects stale human-readable metadata and documentation references', () => {
        const metadata = validateSnapshotMetadata(validValue, 'ebu-ograf-v1-01234567');
        const validMarkdown = [
            `- Commit: \`${validValue.commit}\``,
            `- Commit URL: https://github.com/ebu/ograf/tree/${validValue.commit}`,
            '- Source date: 2026-08-07',
            '- Vendored paths: `v1/specification/docs/Specification.md`, ' +
                '`v1/specification/json-schemas/**`, and the four upstream ' +
                '`v1/examples/*.ograf.json` manifests',
        ].join('\n');

        expect(() => validateSnapshotMarkdown(metadata, validMarkdown)).not.toThrow();
        expect(() => validateSnapshotMarkdown(
            metadata,
            validMarkdown.replace(validValue.commit, 'f'.repeat(40)),
        )).toThrow(/exactly this line/u);
        expect(() => assertSnapshotReferences([{
            label: 'README.md',
            content: 'old snapshot',
            tokens: [validValue.commit],
        }])).toThrow(/README\.md/u);

        expect(() => assertCurrentSnapshotReferences(metadata, [{
            label: 'README.md',
            content: [
                validValue.commit,
                'ebu-ograf-v1-01234567',
                `https://github.com/ebu/ograf/commit/${validValue.commit}`,
                `https://github.com/ebu/ograf/commit/${'f'.repeat(40)}`,
            ].join('\n'),
            tokens: [validValue.commit, 'ebu-ograf-v1-01234567'],
        }])).toThrow(/stale EBU commit URL/u);
    });
});

describe('snapshot checksum manifest', () => {
    const hash = 'a'.repeat(64);

    it('accepts canonical unique package paths', () => {
        expect(parseChecksumManifest(
            `${hash}  docs/Specification.md\n${hash}  SNAPSHOT.json\n`,
        )).toEqual(new Map([
            ['docs/Specification.md', hash],
            ['SNAPSHOT.json', hash],
        ]));
    });

    it('rejects duplicate and unsafe paths', () => {
        expect(() => parseChecksumManifest(
            `${hash}  docs/Specification.md\n${hash}  docs/Specification.md\n`,
        )).toThrow(/Duplicate/u);
        for (const path of ['../outside', './inside', 'folder\\file', '/absolute', 'SHA256SUMS']) {
            expect(() => parseChecksumManifest(`${hash}  ${path}\n`)).toThrow(/path/u);
        }
    });
});

describe('offline specification check', () => {
    it('checks a complete local fixture without network access or writes', () => {
        const fixture = createSpecCheckFixture();
        const network = vi.fn(() => { throw new Error('Network must not be used.'); });
        vi.stubGlobal('fetch', network);

        expect(() => runSpecCheck(fixture.options)).not.toThrow();

        expect(network).not.toHaveBeenCalled();
        expect(fixture.options.generateSource).toHaveBeenCalledOnce();
        expect(fixture.options.log).toHaveBeenCalledWith(
            expect.stringContaining('locally consistent; upstream freshness was not checked'),
        );
        for (const [path, content] of fixture.files) {
            expect(readFileSync(resolve(fixture.snapshotDirectory, path), 'utf8')).toBe(content);
        }
        expect(readFileSync(resolve(fixture.snapshotDirectory, 'SHA256SUMS'), 'utf8'))
            .toBe(fixture.checksums);
    });

    it.each(['file', 'checksum'])('rejects corrupted local %s content', (corruption) => {
        const fixture = createSpecCheckFixture();
        if (corruption === 'file') {
            writeFileSync(resolve(fixture.snapshotDirectory, 'docs/Specification.md'), 'changed');
        } else {
            writeFileSync(resolve(fixture.snapshotDirectory, 'SHA256SUMS'),
                fixture.checksums.replace(/^[a-f0-9]{64}/u, '0'.repeat(64)));
        }

        expect(() => runSpecCheck(fixture.options)).toThrow(/Snapshot checksum mismatch/u);
        expect(fixture.options.generateSource).not.toHaveBeenCalled();
    });

    it.each(['SHA256SUMS', 'docs/Specification.md'])(
        'rejects a missing %s through the full check', (path) => {
            const fixture = createSpecCheckFixture();
            rmSync(resolve(fixture.snapshotDirectory, path));

            expect(() => runSpecCheck(fixture.options)).toThrow(/Missing snapshot checksum|missing files/u);
            expect(fixture.options.log).not.toHaveBeenCalled();
        },
    );

    it('reloads and validates metadata instead of trusting imported metadata', () => {
        const fixture = createSpecCheckFixture();
        writeFileSync(resolve(fixture.snapshotDirectory, 'SNAPSHOT.json'), JSON.stringify({
            ...validValue, commit: 'f'.repeat(40),
        }));

        expect(() => runSpecCheck(fixture.options)).toThrow(/Snapshot directory must be/u);
        expect(fixture.options.generateSource).not.toHaveBeenCalled();
    });

    it('rejects stale snapshot markdown before reporting local consistency', () => {
        const fixture = createSpecCheckFixture();
        const path = resolve(fixture.snapshotDirectory, 'SNAPSHOT.md');
        writeFileSync(path, readFileSync(path, 'utf8').replace(validValue.commit, 'f'.repeat(40)));

        expect(() => runSpecCheck(fixture.options)).toThrow(/SNAPSHOT\.md must contain/u);
    });

    it.each(['README.md', 'packages/validator-core/README.md', 'packages/validator-core/CHANGELOG.md'])(
        'rejects stale references in %s through the full check', (path) => {
            const fixture = createSpecCheckFixture();
            writeFileSync(resolve(fixture.root, path), 'Stale documentation.');

            expect(() => runSpecCheck(fixture.options)).toThrow(/does not reference/u);
            expect(fixture.options.generateSource).not.toHaveBeenCalled();
        },
    );

    it.each(['missing', 'stale'])('rejects a %s generated validator', (state) => {
        const fixture = createSpecCheckFixture();
        if (state === 'missing') rmSync(fixture.generatedPath);
        else writeFileSync(fixture.generatedPath, '// Stale standalone validator\n');

        expect(() => runSpecCheck(fixture.options)).toThrow(/Missing generated|Generated validator drift/u);
        expect(fixture.options.log).not.toHaveBeenCalled();
    });

    it('retains rejection of unpinned files and symbolic links', () => {
        const fixture = createSpecCheckFixture();
        const extra = resolve(fixture.snapshotDirectory, 'extra.md');
        writeFileSync(extra, 'Unpinned.');
        expect(() => runSpecCheck(fixture.options)).toThrow(/not pinned/u);

        rmSync(extra);
        symlinkSync(resolve(fixture.snapshotDirectory, 'docs/Specification.md'), extra);
        expect(() => runSpecCheck(fixture.options)).toThrow(/symbolic links/u);
    });
});
