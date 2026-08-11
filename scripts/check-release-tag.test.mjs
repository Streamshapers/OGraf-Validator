import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

import {
    parseReleaseTag,
    validateReleaseMetadata,
} from './check-release-tag.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = resolve(repositoryRoot, 'scripts/check-release-tag.mjs');

const validMetadata = {
    tag: 'core-v1.2.3',
    packageJson: { version: '1.2.3' },
    lockfile: {
        packages: {
            'packages/validator-core': { version: '1.2.3' },
        },
    },
    changelog: '# Changelog\n\n## 1.2.3 - 2026-08-12\n',
};

test('parses stable app and core tags', () => {
    assert.deepEqual(parseReleaseTag('app-v0.2.1'), {
        target: 'app',
        version: '0.2.1',
    });
    assert.deepEqual(parseReleaseTag('core-v10.20.30'), {
        target: 'core',
        version: '10.20.30',
    });
});

test('rejects unknown, prerelease, and leading-zero tags', () => {
    for (const tag of ['v1.2.3', 'web-v1.2.3', 'core-v1.2.3-beta.1', 'app-v01.2.3']) {
        assert.throws(() => parseReleaseTag(tag), /Invalid release tag/u);
    }
});

test('accepts matching package, lockfile, and changelog metadata', () => {
    assert.deepEqual(validateReleaseMetadata(validMetadata), {
        target: 'core',
        version: '1.2.3',
        workspace: 'packages/validator-core',
        changelog: 'packages/validator-core/CHANGELOG.md',
    });
});

test('rejects package and lockfile version mismatches', () => {
    assert.throws(
        () => validateReleaseMetadata({
            ...validMetadata,
            packageJson: { version: '1.2.4' },
        }),
        /package\.json version 1\.2\.4/u,
    );
    assert.throws(
        () => validateReleaseMetadata({
            ...validMetadata,
            lockfile: {
                packages: {
                    'packages/validator-core': { version: '1.2.4' },
                },
            },
        }),
        /package-lock\.json version 1\.2\.4/u,
    );
});

test('requires one dated changelog heading', () => {
    assert.throws(
        () => validateReleaseMetadata({
            ...validMetadata,
            changelog: '# Changelog\n',
        }),
        /exactly one dated/u,
    );
    assert.throws(
        () => validateReleaseMetadata({
            ...validMetadata,
            changelog: [validMetadata.changelog, validMetadata.changelog].join('\n'),
        }),
        /exactly one dated/u,
    );
});

test('checks current metadata independently of the working directory', async () => {
    const appPackage = JSON.parse(
        await readFile(resolve(repositoryRoot, 'packages/app/package.json'), 'utf8'),
    );
    const result = spawnSync(
        process.execPath,
        [scriptPath, `app-v${String(appPackage.version)}`],
        {
            cwd: dirname(repositoryRoot),
            encoding: 'utf8',
            env: {
                ...process.env,
                RELEASE_TAG: 'core-v9.9.9',
            },
        },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Release tag OK: app/u);
});
