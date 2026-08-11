# Validator Core Changelog

All notable changes to `@streamshapers/ograf-validator-core` are documented here.

## 0.2.0 - 2026-08-10

### Added

- A pinned, offline EBU OGraf v1 specification snapshot at commit `d42afced`, including manifest and GDD schemas and source hashes.
- Generated Ajv Draft 2020-12 standalone validation code with no runtime dependency.
- Validation for action durations, thumbnails, engine requirements, GDD ordering and visibility, typed multi-select fields, and vendor extensions.
- Recursive GDD validation for nested schemas, defaults, selections, colors, percentages, durations, and file references.
- Public manifest, action-duration, thumbnail, engine-requirement, GDD-option, and vendor-extension TypeScript types.
- Regression tests that ensure malformed input and file-system failures return validation issues instead of throwing.
- Package-export smoke tests for installed ESM, CJS, declarations, public APIs, the bundled specification snapshot, license, and changelog.

### Changed

- The repository builds and checks the package with Node.js 24, npm 11, and TypeScript 7 while keeping the published ES2020 output and zero runtime dependencies.
- Incorrect `$schema` values, unknown non-`v_*` fields, disabled realtime and non-realtime support, and non-integer `stepCount` values are errors.
- Missing GDD data is informational. Missing file-path defaults remain tooling warnings.
- File checks cover the main module, thumbnails, custom-action schemas, array items, and nested file references.
- `validatePackage()` keeps its compatible optional `manifestFilename` parameter and handles arbitrary input without uncaught errors.
- The package remains free of runtime dependencies and builds ESM, CJS, and declarations with TypeScript.
- Ajv is updated to 8.20.0 for validator generation, and Vitest is updated to 4.1.10.
