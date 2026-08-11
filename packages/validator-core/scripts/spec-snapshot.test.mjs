import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { parseChecksumManifest } from './check-spec.mjs';
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
    for (const root of temporaryRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

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
