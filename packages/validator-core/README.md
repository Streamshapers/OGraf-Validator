# @streamshapers/ograf-validator-core

> Validates [OGraf Graphics Package](https://ograf.ebu.io/v1/specification/docs/Specification.html) manifests against the EBU OGraf specification. Works in Node.js and the browser. Zero runtime dependencies.

Part of [OGraf Validator](https://github.com/streamshapers/ograf-validator) by [StreamShapers](https://streamshapers.com).

## Installation

```bash
npm install @streamshapers/ograf-validator-core
```

## Usage

### Validate a manifest object

Use `validateManifest` when you already have the parsed JSON in memory - no file I/O needed.

```ts
import { validateManifest } from '@streamshapers/ograf-validator-core';

const manifest = JSON.parse(await fs.readFile('package.ograf.json', 'utf8'));
const result = validateManifest(manifest);

console.log(result.valid);      // true | false
console.log(result.errors);     // ValidationIssue[]
console.log(result.warnings);   // ValidationIssue[]
console.log(result.infos);      // ValidationIssue[]
```

### Validate a full package (manifest + file references)

Use `validatePackage` to also check that files referenced in the manifest (e.g. `main`) actually exist in the package. Implement the `VirtualFS` interface for your environment.

```ts
import { validatePackage } from '@streamshapers/ograf-validator-core';
import type { VirtualFS } from '@streamshapers/ograf-validator-core';
import { readFile, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';

class NodeFS implements VirtualFS {
    constructor(private readonly root: string) {}

    async readFile(path: string): Promise<string> {
        return readFile(join(this.root, path), 'utf8');
    }

    async fileExists(path: string): Promise<boolean> {
        try {
            await access(join(this.root, path));
            return true;
        } catch {
            return false;
        }
    }

    async listFiles(): Promise<string[]> {
        const entries = await readdir(this.root, { recursive: true });
        return entries.filter((e) => typeof e === 'string') as string[];
    }
}

const fs = new NodeFS('./my-package');
const manifestText = await fs.readFile('package.ograf.json');
const manifest = JSON.parse(manifestText);

const result = await validatePackage(manifest, fs);

if (!result.valid) {
    for (const error of result.errors) {
        console.error(`[${error.code}] ${error.path ?? ''} ${error.message}`);
    }
    process.exit(1);
}
```

### Working with results

```ts
import type { ValidationResult, ValidationIssue } from '@streamshapers/ograf-validator-core';

function printResult(result: ValidationResult): void {
    if (result.valid) {
        console.log('Package is valid.');
    }

    for (const issue of result.issues) {
        const prefix = issue.severity === 'error' ? '✗' :
                       issue.severity === 'warning' ? '⚠' : 'ℹ';
        const path = issue.path ? ` (${issue.path})` : '';
        console.log(`${prefix} [${issue.code}]${path} ${issue.message}`);
    }
}
```

---

## API Reference

### `validateManifest(manifest: unknown): ValidationResult`

Validates a manifest object in memory. Fast, synchronous-style (returns a plain object, no async needed).

### `validatePackage(manifest: unknown, fs: VirtualFS): Promise<ValidationResult>`

Validates a manifest and checks that files referenced in the manifest exist via `fs`. Superset of `validateManifest`.

### `VirtualFS`

```ts
interface VirtualFS {
    readFile(path: string): Promise<string>;
    fileExists(path: string): Promise<boolean>;
    listFiles(path?: string): Promise<string[]>;
}
```

Implement this interface to adapt the validator to any file source - local filesystem, zip archive, in-memory map, browser File System Access API, etc.

---

## Validation rules

### Errors — set `valid: false`

| Code | Description |
|------|-------------|
| `INVALID_MANIFEST` | Input is not a JSON object |
| `MISSING_FIELD` | Required field missing (`$schema`, `id`, `name`, `main`, `supportsRealTime`, `supportsNonRealTime`) |
| `INVALID_TYPE` | Field has the wrong type |
| `INVALID_ID` | `id` is empty or contains `/` |
| `INVALID_NAME` | `name` is empty |
| `INVALID_MAIN` | `main` is empty |
| `INVALID_AUTHOR` | `author` is present but not an object |
| `INVALID_CUSTOM_ACTIONS` | `customActions` is present but not an array |
| `INVALID_CUSTOM_ACTION` | A `customActions` entry is missing `id` or `name`, or is not an object |
| `DUPLICATE_CUSTOM_ACTION_ID` | Two `customActions` entries share the same `id` |
| `INVALID_STEP_COUNT` | `stepCount` is less than `-1` |
| `INVALID_RENDER_REQUIREMENTS` | `renderRequirements` is present but not an array of objects |
| `INVALID_GDD` | `schema` is present but not an object |
| `INVALID_GDD_TYPE` | GDD root `type` is not `"object"` |
| `MISSING_GDD_PROPERTIES` | GDD `schema` has no `properties` object |
| `INVALID_GDD_FIELD` | A GDD field definition is not an object |
| `MISSING_ASSET` | The `main` entry point file does not exist in the package |

### Warnings — `valid` stays `true`

| Code | Description |
|------|-------------|
| `INVALID_SCHEMA_REF` | `$schema` is not the exact official OGraf schema URL |
| `NO_RUNTIME_SUPPORT` | Both `supportsRealTime` and `supportsNonRealTime` are `false` — the graphic cannot be rendered |
| `UNUSUAL_MAIN_EXTENSION` | `main` has an unexpected file extension (expected `.js`, `.mjs`, or `.html`) |
| `EMPTY_PACKAGE` | Package directory contains no files besides the manifest |
| `LARGE_FILE` | A file in the package exceeds 10 MB |
| `MISSING_DEFAULT_ASSET` | A GDD field with `gddType: "file-path"` has a `default` value pointing to a non-existent file |

### Infos — informational only

| Code | Description |
|------|-------------|
| `MISSING_GDD` | No `schema` defined — valid but limits tooling support |
| `MISSING_GDD_TYPE` | A GDD field has no `gddType` hint |
| `INVALID_VERSION_FORMAT` | `version` does not follow semver (not required by spec) |
| `PACKAGE_FILE_COUNT` | Reports the total number of files in the package |
| `PACKAGE_TOTAL_SIZE` | Reports the total size of all files in the package |

---

## TypeScript types

All types are exported from the package root:

```ts
import type {
    OgrafManifest,
    OgrafAuthor,
    OgrafCustomAction,
    OgrafRenderRequirement,
    GddSchema,
    GddField,
    ValidationResult,
    ValidationIssue,
    ValidationSeverity,
    VirtualFS,
} from '@streamshapers/ograf-validator-core';
```

---

## Compatibility

| Environment | Support |
|-------------|---------|
| Node.js 18+ | Yes |
| Node.js 16 | Yes (ESM mode) |
| Browser (modern) | Yes |
| Deno | Yes (via npm specifier) |

No native modules, no filesystem access in the library itself — all I/O goes through `VirtualFS`.

---

## License

MIT © [StreamShapers](https://streamshapers.com)
