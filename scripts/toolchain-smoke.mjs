import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const nativePackage = require('@typescript/native/package.json');
const apiPackage = require('typescript/package.json');

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

console.log(`Toolchain OK: ${compilerVersion}; TypeScript API ${apiPackage.version}.`);

function assertMajorVersion(label, version, expectedMajor) {
    if (typeof version !== 'string' || !version.startsWith(`${expectedMajor}.`)) {
        throw new Error(`Expected ${label} ${expectedMajor}.x, received "${String(version)}".`);
    }
}
