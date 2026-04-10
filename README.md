# OGraf Validator

> Validate, inspect and preview [OGraf Graphics Packages](https://ograf.ebu.io/v1/specification/docs/Specification.html) — directly in the browser.

Built by [StreamShapers](https://streamshapers.com) as a community tool for the EBU OGraf ecosystem.

**Live app**: [validator.streamshapers.com](https://validator.streamshapers.com)  
**npm**: [`@streamshapers/ograf-validator-core`](https://www.npmjs.com/package/@streamshapers/ograf-validator-core)

---

## What it does

OGraf packages are Web Components. They must implement a specific JavaScript API, carry a manifest file, and declare their data contract via GDD. Getting all of that right by eye is tedious.

OGraf Validator loads a package directory from your local file system and tells you exactly what is wrong, what looks suspicious, and what is informational, without uploading anything to a server.

---

## Features

### Validation

- Checks every required field, type, and constraint from the OGraf v1 spec
- Reports **errors** (package is invalid), **warnings** (valid but suspicious), and **infos** (best-practice hints)
- All packages in a directory are validated automatically on open, no manual trigger needed
- Export the full report as **JSON** (CI-friendly) or **HTML** (human-readable)

### Inspection

| Tab | What you see |
|-----|-------------|
| Validation | All issues with error codes, paths, and messages |
| Manifest | Full JSON tree of the manifest file |
| GDD | Parsed Graphics Data Definition schema |
| Assets | All files in the package with their validation status |

### Preview

The Preview tab is a full OGraf API test harness. Mount the graphic in a real browser context and drive every spec method interactively.

**Lifecycle**
- `load` / `dispose` with configurable render type and render characteristics (width × height × fps)
- Reload without full page refresh

**Actions**
- `playAction` — with `delta`, `goto`, and per-call `skipAnimation` override
- `stopAction` — with `skipAnimation` override
- `updateAction` — sends the current data form state
- `customAction` — auto-discovered from `manifest.customActions`, each with its own payload editor

**Non-realtime** *(shown when `supportsNonRealTime: true`)*
- `goToTime` — slider + numeric input, 0–60 000 ms
- `setActionsSchedule` — JSON editor with example skeleton

**Data editor**
- Dynamic form built from the GDD schema — no manual JSON editing needed for known fields
- Supports all `gddType` values: `single-line`, `multi-line`, `dropdown`, `number`, `integer`, `boolean`, `color`, `date`, `url`, `email`, `file-path`, and more
- Nested objects and arrays with add/remove controls
- Raw JSON escape hatch at the bottom, always in sync
- Resets to schema defaults with one click

**Event log**
- Every API call logged with method, params, result, and duration
- `console.log/warn/error/info` from the graphic captured inline
- Console entries can be filtered out with a single toggle
- Collapsible detail view per entry

**Manifest diff**
- When you re-select a package and the manifest has changed, a git-style unified diff appears automatically
- 3-line context, collapsed unchanged sections, toggle with a checkbox

---

## Using the app

1. Open [validator.streamshapers.com](https://validator.streamshapers.com) in a Chromium-based browser (Chrome, Edge)
2. Click **Open Directory** and select a folder containing one or more OGraf packages
3. All packages are validated immediately, pick one in the sidebar to inspect it

> The File System Access API is required. Firefox is not supported.

---

## Using validator-core in CI/CD

The validation logic is published as a standalone npm package with zero runtime dependencies.

```bash
npm install @streamshapers/ograf-validator-core
```

```ts
import { validateManifest, validatePackage } from '@streamshapers/ograf-validator-core';

// Validate a manifest object in memory
const result = validateManifest(manifest);
console.log(result.valid);   // true | false
console.log(result.errors);  // ValidationIssue[]

// Validate a full package (manifest + file references)
// Implement VirtualFS to provide file access for your environment
const result = await validatePackage(manifest, fs);
```

`VirtualFS` is a simple interface - implement it for `node:fs`, a zip archive, or any other source:

```ts
interface VirtualFS {
    fileExists(path: string): Promise<boolean>;
    readFile(path: string): Promise<string>;
    listFiles(): Promise<string[]>;
}
```

---

## Monorepo structure

```
ograf-validator/
├── packages/
│   ├── validator-core/    # @streamshapers/ograf-validator-core — pure TS, zero deps
│   └── app/               # Web app — React + Vite + Tailwind CSS
├── fixtures/
│   ├── valid-basic/       # Simple lower-third (realtime)
│   ├── valid-realtime/    # Football scoreboard (realtime + non-realtime, GDD with dropdown)
└── └── invalid-missing-fields/  # Deliberately broken package for test coverage
```

---

## Local development

```bash
# Install all dependencies
npm install

# Start the app dev server
npm run dev          # http://localhost:3000

# Run validator-core unit tests
npm run test:core    # 47 tests

# Type-check all packages
npm run typecheck

# Build everything
npm run build
```

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Build | Vite 5 |
| UI | React 18 + TypeScript |
| Styling | Tailwind CSS v3 |
| Validator | TypeScript, zero dependencies |
| Tests | Vitest |

---

## Contributing

Issues and pull requests are welcome. Please follow the [Conventional Commits](https://www.conventionalcommits.org/) format for commit messages.

The OGraf specification is the source of truth: [ograf.ebu.io/v1/specification](https://ograf.ebu.io/v1/specification/docs/Specification.html)

---

## License

MIT © [StreamShapers](https://streamshapers.com)
