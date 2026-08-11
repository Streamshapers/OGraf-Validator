# OGraf Validator

Validate, inspect, and safely preview [OGraf Graphics Packages](https://ograf.ebu.io/v1/specification/docs/Specification.html) directly in a Chromium browser.

OGraf Validator is an open-source [StreamShapers](https://streamshapers.com) community tool. Package files stay on the local machine; no backend or upload is involved.

- Live app: [validator.streamshapers.com](https://validator.streamshapers.com)
- Core package: [`@streamshapers/ograf-validator-core`](https://www.npmjs.com/package/@streamshapers/ograf-validator-core)
- Changelogs: [app](packages/app/CHANGELOG.md) · [validator core](packages/validator-core/CHANGELOG.md)
- Specification snapshot: EBU OGraf v1 commit [`d42afced`](https://github.com/ebu/ograf/commit/d42afcedf9348e05e35b2009b04fb9552785e35b), 7 August 2026

## What it covers

The validator checks the pinned OGraf v1 manifest and GDD schemas, additional normative prose rules, and local package references in three explicit stages. It understands, among other fields:

- `actionDurations`, including step fallbacks and custom-action references;
- local and external `thumbnails` plus declared resolution;
- all `renderRequirements` alternatives, `engine`, and `accessToPublicInternet`;
- recursive GDD schemas, `hidden`, `order`, `select`, and typed `select-multiple`;
- nested file-path defaults and custom-action payload schemas;
- multiple independent `*.ograf.json` manifests in one shared asset directory.

Validation is split into errors, warnings, and tooling information. Incorrect `$schema` values, unknown non-`v_*` fields, both runtime flags being false, and non-integer `stepCount` values are errors. A missing GDD is tooling information only. Every statically valid Graphic is queued automatically for a sequential runtime test.

## Inspector and preview

The Inspector shows manifest data, GDD fields, assets, thumbnails, render alternatives, custom actions, and resolved duration declarations. External thumbnails are metadata-only until the user explicitly loads one.

Graphic JavaScript runs only inside a transient `<iframe sandbox="allow-scripts">` with an opaque origin. Each load/reload uses a new session URL namespace:

```text
/__ograf_preview__/<sessionId>/<package-relative-path>
```

Session and tab tokens isolate packages, tabs, reloads, and complete ESM dependency graphs. The file bridge blocks absolute paths and parent traversal, handles Unicode and spaces, supplies media MIME types, and supports `HEAD` and byte-range requests. Graphic code cannot access the validator DOM, origin storage, or same-origin APIs.

The opaque sandbox receives package modules through an in-frame Blob/import-map graph. Static imports, export-from declarations, literal and package-local variable dynamic imports, and literal `new URL(..., import.meta.url)` assets retain package-relative resolution without giving the Graphic access to the validator origin. Directory bases such as `new URL('./assets/', import.meta.url)` stay hierarchical; package files requested below them are read lazily through the validated session MessagePort.

Local CSS `@import` and `url(...)` references work in linked stylesheets,
`<style>` elements, style attributes, and direct `element.style` changes.
Package candidates in `srcset` keep their density or width descriptor. Module
and classic Dedicated Workers support local imports, `importScripts()`, and
package `fetch()` calls. If a Graphic starts a non-static Worker entry or a
`SharedWorker`, the runtime test reports an inconclusive preview limitation,
not an OGraf validation error. Unused Worker code in libraries has no effect.

The interactive harness covers:

- `load`, `dispose`, `playAction`, `stopAction`, `updateAction`, and `customAction`;
- `goToTime` and `setActionsSchedule` for non-realtime Graphics;
- zero-based top-level `currentStep`, exact ReturnPayload validation, 2xx success handling, and concurrent action Promises;
- separate RT and NRT lifecycle sessions for dual-mode Graphics;
- default-derived custom-action payloads, with an explicit skip reason when defaults cannot build one;
- normative schedule entries using `action.type` and `action.params`;
- native render surfaces that are scaled only for display.

Automatic tests use the first locally representable render alternative. Engine and internet conditions that the browser cannot verify are reported as such. Runtime operations use `skipAnimation: true`; their 10-second safety timeout is an inconclusive warning, not a static specification error.

## Browser requirements

Use a current Chromium-based browser such as Chrome or Edge. The File System Access API and Service Workers are required. Firefox is intentionally outside the supported browser scope.

1. Open the app.
2. Select a directory containing one or more `*.ograf.json` files.
3. Validation and background runtime tests start automatically.
4. Select a Graphic to inspect it or use the interactive preview.

The scanner keeps every manifest independent by its complete path relative to the selected root. Manifests in the same directory share their asset listing. Root changes and watched file changes abort stale scans and runtime sessions before results can reach the new selection.

## Core library

Install the library in a Node.js or browser project:

```bash
npm install @streamshapers/ograf-validator-core
```

```ts
import { validateManifest, validatePackage } from '@streamshapers/ograf-validator-core';

const manifestResult = validateManifest(manifest);

const packageResult = await validatePackage(
    manifest,
    fs,
    'lower-third.ograf.json', // optional, retained for API compatibility
);
```

`VirtualFS` keeps file access host-independent:

```ts
interface VirtualFS {
    readFile(path: string): Promise<string>;
    fileExists(path: string): Promise<boolean>;
    listFiles(path?: string): Promise<string[]>;
    getFileSize?(path: string): Promise<number>;
}
```

Both public validators accept arbitrary `unknown` input. Malformed objects and `VirtualFS` failures are returned as issues rather than thrown. The published core has no runtime dependencies. It does not expose a CLI or `bin` entry.

## Local development

```bash
npm install          # Node.js 20.19 or newer
npm run dev          # http://localhost:3000
npm run spec:check   # Snapshot hashes and generated standalone validator
npm test             # Core and app unit tests
npm run typecheck
npm run build
npm run smoke:core   # ESM/CJS/types package-export smoke
npm run test:e2e     # Playwright using installed Chrome
npm run audit        # Full dependency audit, including development tools
npm run release:check
```

`npm run release:check` runs lint, type checking, unit tests, the pinned-spec
check, production builds, the installed-package smoke test, Chromium tests, and
both production-only and full dependency audits.

The vendored specification is never downloaded at application runtime. Updating it is an explicit manual process; `npm run spec:check` verifies the snapshot and generated validator artifacts.

Production is deployed as static files to ALL-INKL web hosting. Deployment is
manual and is not part of the repository scripts.

## Repository layout

```text
ograf-validator/
├── packages/
│   ├── validator-core/   # Pure TypeScript validation library
│   │   └── spec/         # Immutable EBU d42afced snapshot
│   └── app/              # React/Vite browser application
├── fixtures/             # Valid, invalid-static, and invalid-runtime packages
└── scripts/              # Package and specification checks
```

## Scope

This repository targets the stable OGraf Graphics v1 specification. The separate OGraf Server API, ZIP import, accounts, backend services, and non-OGraf template formats are out of scope.

## Contributing

Issues and pull requests are welcome. Use Conventional Commits and keep relative ESM imports suffixed with `.js`.

## License

MIT © [StreamShapers](https://streamshapers.com)
