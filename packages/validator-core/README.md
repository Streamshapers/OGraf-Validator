# @streamshapers/ograf-validator-core

Validate OGraf Graphics v1 manifests and package references in Node.js or a
browser. The published package has zero runtime dependencies.

This package is part of
[OGraf Validator](https://github.com/Streamshapers/OGraf-Validator) by
[StreamShapers](https://streamshapers.com). It validates the stable
[OGraf Graphics v1 specification](https://ograf.ebu.io/v1/specification/docs/Specification.html).

See the [validator core changelog](CHANGELOG.md) for package-specific release notes.

## Installation

```bash
npm install @streamshapers/ograf-validator-core
```

The package exports a library only. It has no `bin` entry and is not an `npx`
CLI.

## Usage

### Validate an in-memory manifest

```ts
import { validateManifest } from '@streamshapers/ograf-validator-core';

const result = validateManifest(manifest);

console.log(result.valid);
console.log(result.errors);
console.log(result.warnings);
console.log(result.infos);
```

### Validate a manifest and its package files

Implement `VirtualFS` for the environment that owns the package files, then
pass the parsed manifest and optional manifest filename:

```ts
import { validatePackage } from '@streamshapers/ograf-validator-core';
import type { VirtualFS } from '@streamshapers/ograf-validator-core';
import { access, readFile, readdir, stat } from 'node:fs/promises';
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
        return entries.filter((entry): entry is string => typeof entry === 'string');
    }

    async getFileSize(path: string): Promise<number> {
        return (await stat(join(this.root, path))).size;
    }
}

const packageFs = new NodeFS('./my-package');
const manifestFilename = 'lower-third.ograf.json';
const manifest = JSON.parse(await packageFs.readFile(manifestFilename));
const result = await validatePackage(manifest, packageFs, manifestFilename);

for (const issue of result.issues) {
    console.log(`${issue.severity} [${issue.code}] ${issue.path ?? ''} ${issue.message}`);
}
```

`validatePackage` checks the `main` module, package-relative thumbnails, and
recursive file-path defaults in the manifest GDD, custom-action schemas, and
array items. It also reports package file counts, total size when available,
and file-access failures.

## Public API

### `validateManifest(manifest: unknown): ValidationResult`

Validates a parsed manifest in memory and returns synchronously.

### `validatePackage(manifest: unknown, fs: VirtualFS, manifestFilename?: string): Promise<ValidationResult>`

Runs manifest validation and package-file checks. The optional filename is
validated when supplied and preserves the existing API shape.

### `VirtualFS`

```ts
interface VirtualFS {
    readFile(path: string): Promise<string>;
    fileExists(path: string): Promise<boolean>;
    listFiles(path?: string): Promise<string[]>;
    getFileSize?(path: string): Promise<number>;
}
```

Both validators accept arbitrary `unknown` input. Malformed objects and failing
or malformed `VirtualFS` results are converted to validation issues instead of
escaping as uncaught errors.

### `ValidationResult`

```ts
interface ValidationResult {
    valid: boolean;
    issues: ValidationIssue[];
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    infos: ValidationIssue[];
}

interface ValidationIssue {
    severity: 'error' | 'warning' | 'info';
    code: string;
    message: string;
    path?: string;
    specRef?: string;
}
```

`valid` is false exactly when `errors` is non-empty. `ValidationIssue.code`
remains `string` for source compatibility; the exported `ValidationIssueCode`
type enumerates built-in codes.

## Validation model

Validation is applied in three layers:

1. the pinned official manifest and GDD JSON schemas;
2. normative prose and cross-field rules;
3. package file checks and tooling diagnostics.

The core understands `actionDurations`, local and external `thumbnails`, all
`renderRequirements` alternatives including `engine`, recursive GDD structures,
`hidden`, `order`, `select-multiple`, vendor `v_*` extensions, and nested
file-path defaults.

Normative additions include:

- `$schema` must be the exact official URL;
- unknown fields must use the `v_*` prefix;
- at least one runtime support flag must be true;
- `stepCount` must be `-1` or a non-negative integer even though the pinned
  upstream JSON Schema currently uses `number`;
- `author.name` is required when `author` is present;
- `customActions[].schema` may be an object or `null`.

A missing GDD is informational. The core deliberately does not emit a semver
recommendation or a generic missing-`gddType` message.

## Issue codes

### Errors

| Code | Meaning |
| --- | --- |
| `INVALID_MANIFEST` | Input is not a safe JSON object or cannot be inspected |
| `MISSING_FIELD` | A required manifest or nested field is missing |
| `INVALID_TYPE` | A field has an invalid type, including non-integer `stepCount` |
| `INVALID_ID` | `id` is empty or contains `/` |
| `INVALID_NAME` | `name` is empty |
| `INVALID_MAIN` | `main` is empty |
| `UNUSUAL_MAIN_EXTENSION` | `main` is not a `.js` or `.mjs` module |
| `INVALID_SCHEMA_REF` | `$schema` is not the exact official URL |
| `UNKNOWN_FIELD` | A non-standard field lacks the `v_*` prefix |
| `NO_RUNTIME_SUPPORT` | Both runtime support flags are false |
| `INVALID_AUTHOR` | `author` is not an object |
| `MISSING_AUTHOR_NAME` | A present author object lacks `name` |
| `INVALID_CUSTOM_ACTIONS` | `customActions` is not an array |
| `INVALID_CUSTOM_ACTION` | A custom-action declaration is malformed |
| `DUPLICATE_CUSTOM_ACTION_ID` | Custom actions reuse an ID |
| `INVALID_ACTION_DURATION` | An action duration or step duration is malformed |
| `DUPLICATE_ACTION_DURATION` | An action, custom action, step, or fallback has multiple duration entries |
| `UNKNOWN_CUSTOM_ACTION_DURATION` | A duration references an undeclared custom action |
| `INVALID_STEP_COUNT` | `stepCount` is below `-1` |
| `INVALID_RENDER_REQUIREMENT` | A render, engine, or constraint declaration is malformed |
| `INVALID_GDD` | A manifest or custom-action GDD is invalid |
| `INVALID_THUMBNAIL` | A thumbnail, image extension, or resolution is invalid |
| `INVALID_MANIFEST_FILENAME` | A supplied filename does not end in `.ograf.json` |
| `MISSING_ASSET` | The package-relative `main` file does not exist |
| `MISSING_THUMBNAIL_ASSET` | A package-relative thumbnail does not exist |
| `FILE_ACCESS_ERROR` | A `VirtualFS` operation failed or returned malformed data |

### Warnings

| Code | Meaning |
| --- | --- |
| `EMPTY_PACKAGE` | The directory contains no files except manifests |
| `LARGE_FILE` | A package file exceeds 10 MB |
| `MISSING_DEFAULT_ASSET` | A package-relative file-path GDD default does not exist |

### Information

| Code | Meaning |
| --- | --- |
| `MISSING_GDD` | No manifest GDD `schema` is defined |
| `PACKAGE_FILE_COUNT` | Number of files returned by `VirtualFS` |
| `PACKAGE_TOTAL_SIZE` | Aggregate size when `getFileSize` is available |

For compatibility, `ValidationIssueCode` still contains several legacy names
that the current validator does not emit. New integrations should use the
canonical singular `INVALID_RENDER_REQUIREMENT` and consolidated `INVALID_GDD`
codes listed above.

## Exported TypeScript types

The package root exports manifest, GDD, validation, and file-system types,
including:

```ts
import type {
    OgrafManifest,
    OgrafVendorExtensions,
    OgrafAuthor,
    OgrafCustomAction,
    OgrafActionDuration,
    OgrafActionStepDuration,
    OgrafPlayActionDuration,
    OgrafUpdateActionDuration,
    OgrafStopActionDuration,
    OgrafCustomActionDuration,
    OgrafRenderRequirement,
    OgrafEngineRequirement,
    OgrafEngineVersionRequirement,
    OgrafThumbnail,
    GddSchema,
    GddField,
    GddOptions,
    ValidationResult,
    ValidationIssue,
    ValidationIssueCode,
    ValidationSeverity,
    VirtualFS,
} from '@streamshapers/ograf-validator-core';
```

## Offline specification maintenance

The immutable source snapshot lives at
`spec/ebu-ograf-v1-d42afced/`. It comes from EBU OGraf commit
[`d42afced`](https://github.com/ebu/ograf/commit/d42afcedf9348e05e35b2009b04fb9552785e35b)
from 7 August 2026. Ajv 8.20.0 in 2020-12 mode is a development dependency and
compiles the vendored schemas into
`src/generated/ograf-manifest-validator.ts`; published runtime code does not
import Ajv or load network resources.

From this package directory:

```bash
npm run generate:validator
npm run spec:check
```

`spec:check` verifies `SHA256SUMS` and fails when regenerated standalone code
differs from the checked-in artifact.

## Compatibility

The package provides ESM, CommonJS, and TypeScript declarations. The supported
repository toolchain is Node.js 24+ and npm 11+. Browser consumers should use a
modern bundler; all file access remains behind `VirtualFS`.

## License

[MIT](LICENSE) - [StreamShapers](https://streamshapers.com)
