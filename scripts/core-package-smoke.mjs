import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    access,
    mkdir,
    mkdtemp,
    readFile,
    rm,
    writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
    basename,
    dirname,
    join,
    resolve,
} from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const repositoryRoot = resolve(import.meta.dirname, '..');
const packageRoot = resolve(repositoryRoot, 'packages/validator-core');
const packageJson = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
const temporaryParent = resolve(tmpdir());
const temporaryPrefix = 'ograf-validator-core-smoke-';
const temporaryRoot = await mkdtemp(join(temporaryParent, temporaryPrefix));

try {
    const packDirectory = resolve(temporaryRoot, 'pack');
    const consumerDirectory = resolve(temporaryRoot, 'consumer');
    await mkdir(packDirectory);
    await mkdir(consumerDirectory);

    const packOutput = runNpm([
        'pack',
        '--workspace=packages/validator-core',
        `--pack-destination=${packDirectory}`,
        '--json',
    ], repositoryRoot);
    const packResult = JSON.parse(packOutput);
    assert.ok(Array.isArray(packResult), 'npm pack must return a JSON array.');
    assert.equal(packResult.length, 1, 'npm pack must create exactly one core tarball.');
    assert.equal(typeof packResult[0]?.filename, 'string', 'npm pack did not report a tarball filename.');

    const tarballPath = resolve(packDirectory, packResult[0].filename);
    assert.equal(dirname(tarballPath), packDirectory, 'npm pack returned a tarball outside the pack directory.');
    await access(tarballPath);

    await writeFile(
        resolve(consumerDirectory, 'package.json'),
        `${JSON.stringify({
            name: 'ograf-validator-core-smoke-consumer',
            private: true,
            type: 'module',
        }, null, 2)}\n`,
        'utf8',
    );
    await writeConsumerSmokeFiles(consumerDirectory);

    runNpm([
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--offline',
        '--package-lock=false',
        tarballPath,
    ], consumerDirectory);

    const installedRoot = resolve(
        consumerDirectory,
        'node_modules/@streamshapers/ograf-validator-core',
    );
    const installedPackageJson = JSON.parse(
        await readFile(resolve(installedRoot, 'package.json'), 'utf8'),
    );
    assert.equal(installedPackageJson.version, packageJson.version);
    assert.equal(
        installedPackageJson.dependencies,
        undefined,
        'The published core must have zero runtime dependencies.',
    );
    await access(resolve(installedRoot, 'dist/esm/index.js'));
    await access(resolve(installedRoot, 'dist/cjs/index.js'));
    await access(resolve(installedRoot, 'dist/types/index.d.ts'));
    await access(resolve(
        installedRoot,
        'spec/ebu-ograf-v1-d42afced/json-schemas/graphics/schema.json',
    ));

    run(process.execPath, ['esm-smoke.mjs'], consumerDirectory);
    run(process.execPath, ['cjs-smoke.cjs'], consumerDirectory);

    const typeScriptCompiler = require.resolve('typescript/bin/tsc');
    run(process.execPath, [
        typeScriptCompiler,
        '--project',
        resolve(consumerDirectory, 'tsconfig.json'),
    ], consumerDirectory);

    console.log(
        `Core package tarball smoke passed for ${packageJson.name}@${packageJson.version} ` +
        '(ESM, CJS, declarations, API, offline install).',
    );
} finally {
    await removeTemporaryRoot(temporaryRoot, temporaryParent, temporaryPrefix);
}

async function writeConsumerSmokeFiles(consumerDirectory) {
    const manifestSource = `{
    $schema: 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json',
    id: 'package-smoke',
    name: 'Package smoke',
    main: 'graphic.mjs',
    supportsRealTime: true,
    supportsNonRealTime: false,
}`;

    await writeFile(resolve(consumerDirectory, 'esm-smoke.mjs'), `
import assert from 'node:assert/strict';
import { validateManifest, validatePackage } from '@streamshapers/ograf-validator-core';

assert.equal(typeof validateManifest, 'function');
assert.equal(typeof validatePackage, 'function');
assert.equal(validateManifest(null).valid, false);

const manifest = ${manifestSource};
const fs = {
    async readFile() { return ''; },
    async fileExists(path) { return path === 'graphic.mjs'; },
    async listFiles() { return ['graphic.mjs']; },
    async getFileSize() { return 1; },
};
const result = await validatePackage(manifest, fs, 'package-smoke.ograf.json');
assert.equal(result.valid, true, JSON.stringify(result.errors));
`, 'utf8');

    await writeFile(resolve(consumerDirectory, 'cjs-smoke.cjs'), `
const assert = require('node:assert/strict');
const core = require('@streamshapers/ograf-validator-core');

assert.equal(typeof core.validateManifest, 'function');
assert.equal(typeof core.validatePackage, 'function');
assert.equal(core.validateManifest(null).valid, false);
`, 'utf8');

    await writeFile(resolve(consumerDirectory, 'type-smoke.ts'), `
import { validateManifest, validatePackage } from '@streamshapers/ograf-validator-core';
import type {
    OgrafActionDuration,
    OgrafEngineRequirement,
    OgrafManifest,
    OgrafThumbnail,
    ValidationIssueCode,
    ValidationResult,
    VirtualFS,
} from '@streamshapers/ograf-validator-core';

const manifest: OgrafManifest = ${manifestSource};
const fs: VirtualFS = {
    async readFile(): Promise<string> { return ''; },
    async fileExists(path: string): Promise<boolean> { return path === 'graphic.mjs'; },
    async listFiles(): Promise<string[]> { return ['graphic.mjs']; },
};
const result: ValidationResult = validateManifest(manifest);
const code: ValidationIssueCode = 'INVALID_MANIFEST';
const duration: OgrafActionDuration = { type: 'playAction', duration: 0 };
const engine: OgrafEngineRequirement = { type: 'CEF', version: { min: '139' } };
const thumbnail: OgrafThumbnail = { file: 'thumbnail.png' };

void result;
void code;
void duration;
void engine;
void thumbnail;
void validatePackage(manifest, fs, 'package-smoke.ograf.json');
`, 'utf8');

    await writeFile(resolve(consumerDirectory, 'tsconfig.json'), `${JSON.stringify({
        compilerOptions: {
            target: 'ES2020',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            noEmit: true,
            skipLibCheck: false,
        },
        files: ['type-smoke.ts'],
    }, null, 2)}\n`, 'utf8');
}

function runNpm(args, cwd) {
    const npmCli = process.env.npm_execpath;
    if (npmCli) return run(process.execPath, [npmCli, ...args], cwd);

    const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    return run(executable, args, cwd);
}

function run(command, args, cwd) {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        env: process.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (result.error) throw result.error;
    if (result.status !== 0) {
        const output = [result.stdout, result.stderr]
            .filter((entry) => typeof entry === 'string' && entry.trim() !== '')
            .join('\n');
        throw new Error(
            `Command failed (${command} ${args.join(' ')}):${output ? `\n${output}` : ''}`,
        );
    }
    return result.stdout.trim();
}

async function removeTemporaryRoot(target, parent, prefix) {
    const safeTarget = resolve(target);
    const safeParent = resolve(parent);
    if (
        dirname(safeTarget) !== safeParent ||
        !basename(safeTarget).startsWith(prefix) ||
        safeTarget === safeParent
    ) {
        throw new Error(`Refusing to remove unexpected smoke directory: ${safeTarget}`);
    }

    await rm(safeTarget, {
        recursive: true,
        force: true,
        maxRetries: 3,
    });
}
