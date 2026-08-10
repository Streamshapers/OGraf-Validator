import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
const esmDirectory = resolve(packageRoot, 'dist/esm');
const cjsDirectory = resolve(packageRoot, 'dist/cjs');
await Promise.all([
    mkdir(esmDirectory, { recursive: true }),
    mkdir(cjsDirectory, { recursive: true }),
]);
await Promise.all([
    writeFile(resolve(esmDirectory, 'package.json'), '{"type":"module"}\n', 'utf8'),
    writeFile(resolve(cjsDirectory, 'package.json'), '{"type":"commonjs"}\n', 'utf8'),
]);
