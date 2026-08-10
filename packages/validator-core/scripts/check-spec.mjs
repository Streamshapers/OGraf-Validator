import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateValidatorSource, generatedValidatorPath } from './generate-standalone-validator.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const snapshotRoot = resolve(packageRoot, 'spec/ebu-ograf-v1-d42afced');
const checksumPath = resolve(snapshotRoot, 'SHA256SUMS');

function normalizedRelativePath(path) {
    return relative(snapshotRoot, path).replaceAll('\\', '/');
}

function collectFiles(directory) {
    return readdirSync(directory)
        .map((name) => resolve(directory, name))
        .flatMap((path) => statSync(path).isDirectory() ? collectFiles(path) : [path]);
}

function sha256(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

if (!existsSync(checksumPath)) {
    throw new Error(`Missing snapshot checksum file: ${checksumPath}`);
}

const expected = new Map(
    readFileSync(checksumPath, 'utf8')
        .trim()
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => {
            const match = /^([a-f0-9]{64}) {2}(.+)$/u.exec(line);
            if (match === null) throw new Error(`Malformed SHA256SUMS line: ${line}`);
            return [match[2], match[1]];
        }),
);

const actualFiles = collectFiles(snapshotRoot)
    .map(normalizedRelativePath)
    .filter((path) => path !== 'SHA256SUMS')
    .sort();

for (const path of actualFiles) {
    const expectedHash = expected.get(path);
    if (expectedHash === undefined) throw new Error(`Snapshot file is not pinned in SHA256SUMS: ${path}`);
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
if (readFileSync(generatedValidatorPath, 'utf8') !== generateValidatorSource()) {
    throw new Error('Generated validator drift detected. Run npm run generate:validator.');
}

console.log('Pinned OGraf snapshot checksums and generated validator are up to date.');
