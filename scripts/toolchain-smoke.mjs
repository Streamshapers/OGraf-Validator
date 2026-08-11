import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const nativePackage = require('@typescript/native/package.json');
const apiPackage = require('typescript/package.json');

assertMinimumVersion('Node.js', process.versions.node, [24, 0, 0]);

const npmVersion = /^npm\/(\d+\.\d+\.\d+)/u.exec(
    process.env.npm_config_user_agent ?? '',
)?.[1];
if (npmVersion === undefined) {
    throw new Error('Could not read the npm version from npm_config_user_agent.');
}
assertMinimumVersion('npm', npmVersion, [11, 5, 1]);

assertMajorVersion('@typescript/native', nativePackage.version, 7);
assertMajorVersion('typescript API', apiPackage.version, 6);

const nativePackagePath = require.resolve('@typescript/native/package.json');
const nativeTscPath = resolve(dirname(nativePackagePath), nativePackage.bin.tsc);
const tscResult = spawnSync(process.execPath, [nativeTscPath, '--version'], {
    encoding: 'utf8',
});

if (tscResult.error !== undefined) {
    throw tscResult.error;
}

if (tscResult.status !== 0) {
    const details = tscResult.stderr.trim() || `exit code ${String(tscResult.status)}`;
    throw new Error(`Could not run the local TypeScript compiler: ${details}`);
}

const compilerVersion = tscResult.stdout.trim();
if (!/^Version 7\./u.test(compilerVersion)) {
    throw new Error(`Expected tsc 7.x, received "${compilerVersion}".`);
}

console.log(
    `Toolchain OK: Node.js ${process.versions.node}; npm ${npmVersion}; `
    + `${compilerVersion}; TypeScript API ${apiPackage.version}.`,
);

function assertMajorVersion(label, version, expectedMajor) {
    if (typeof version !== 'string' || !version.startsWith(`${expectedMajor}.`)) {
        throw new Error(`Expected ${label} ${expectedMajor}.x, received "${String(version)}".`);
    }
}

function assertMinimumVersion(label, version, minimum) {
    const parts = version.split('.').map((part) => Number.parseInt(part, 10));
    const valid = minimum.every((_, index) => {
        const part = parts[index];
        return part !== undefined && !Number.isNaN(part);
    });

    if (!valid || compareVersions(parts, minimum) < 0) {
        throw new Error(
            `Expected ${label} ${minimum.join('.')} or newer, received "${version}".`,
        );
    }
}

function compareVersions(left, right) {
    for (let index = 0; index < right.length; index += 1) {
        const difference = (left[index] ?? 0) - (right[index] ?? 0);
        if (difference !== 0) {
            return difference;
        }
    }
    return 0;
}
