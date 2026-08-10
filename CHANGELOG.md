# Changelog

All notable changes to this project are documented here.

## 0.2.0 - 2026-08-10

### Added

- Pinned, offline EBU OGraf v1 specification snapshot at commit `d42afced`,
  including manifest/GDD schemas, source hashes, and generated Ajv 2020-12
  standalone validation code.
- Validation and inspection for action durations, thumbnails, engine requirements, GDD ordering/visibility, and typed multi-select fields.
- Independent discovery and caching for multiple manifests in one directory.
- Session- and tab-isolated sandbox runners for interactive preview and automatic RT/NRT runtime tests.
- Opaque-sandbox module graphs preserve Unicode subimports, package-local variable dynamic imports, and literal `new URL(..., import.meta.url)` assets through in-frame Blob URLs.
- `new URL('./assets/', import.meta.url)` directory bases no longer get mistaken for files; lazy package fetches remain session-bound and preserve the resource MIME type.
- Package files referenced with literal `import.meta.resolve(...)` calls load through sandbox-safe Blob URLs, including images used by DOM elements.
- Session-bound CSS graphs support nested imports, fonts, images, inline styles,
  style attributes, and dynamically changed style text.
- Local `srcset` candidates preserve density and width descriptors, including
  data URLs and concurrent assignments.
- Module and classic Dedicated Workers support local imports, `importScripts()`,
  package fetches, errors, and termination. Unsupported dynamic entries and
  `SharedWorker` are reported as inconclusive preview limits only when used;
  unused library code does not affect readiness.
- Background runtime tests keep animation frames active for graphics that use animation libraries such as GSAP.
- DOM resource errors now show the failed resource instead of `[object Event]`.
- Unicode-safe ESM resource transport with media MIME types, `HEAD`, and byte-range support.
- App unit tests, Chromium end-to-end coverage, and package-export smoke checks.
- Public manifest, action-duration, thumbnail, engine-requirement, vendor-extension,
  and GDD TypeScript types.

### Changed

- OGraf steps and `currentStep` handling are consistently zero-based.
- ReturnPayload results now distinguish permitted undefined success, 2xx success,
  non-2xx failure, malformed payloads, and top-level `currentStep`.
- Scan, watcher, and runtime results are generation-aware and abort cleanly when roots or files change.
- Opening a package moves its pending runtime test to the front of the queue.
- The header now has a rescan action for the current directory.
- Settings now use clearer text, responsive controls, validated saved values, and a recoverable preview reset.
- Valid fixtures now export complete OGraf `HTMLElement` implementations; an invalid-runtime fixture covers missing API behavior.
- `INVALID_SCHEMA_REF`, `UNKNOWN_FIELD`, `NO_RUNTIME_SUPPORT`, and unusual
  non-module `main` extensions now block validity. Missing GDD remains
  informational, while missing file-path defaults remain tooling warnings.
- Core and app versions are now `0.2.0`; the core remains zero-runtime-dependency
  and keeps the compatible optional `manifestFilename` parameter on
  `validatePackage`.
- The development toolchain now uses Vite 8.2.1, Vitest 4.1.10, PostCSS 8.5.26,
  and Ajv 8.20.0. The core ESM/CJS build uses TypeScript directly.
- `npm run release:check` now includes the full audit; both production and
  development dependency audits must report zero findings.

### Security

- Package JavaScript no longer runs in the validator origin. It executes in transient iframes with `sandbox="allow-scripts"` and no same-origin capability.
