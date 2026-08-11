# OGraf Validator App Changelog

All notable changes to the hosted OGraf Validator app are documented here.

## 0.2.1 - 2026-08-11

### Added

- Search metadata, structured data, a canonical URL, sitemap, robots file, web app manifest, and a complete favicon set.
- A 1200 x 630 social preview image for link previews.
- Crawlable start content that explains the OGraf v1 manifest, GDD, inspection, and runtime checks.
- Local Open Sans and JetBrains Mono webfonts with their OFL license files.

### Changed

- Development and CI now use Node.js 24, npm 11, and the TypeScript 7 compiler. ESLint keeps a separate TypeScript 6 compiler API for compatibility.
- The application now uses React 19 and React DOM 19 with one shared React runtime.
- Styling now uses Tailwind CSS 4 through the Vite plugin and a CSS-first `ss-*` theme configuration.
- The welcome screen now describes the validator in clearer, search-friendly language.
- StreamShapers and OGraf logos are served locally. The StreamShapers wordmark follows the selected light or dark theme.

### Fixed

- The saved theme and page background are applied before React starts, preventing a white flash during loading.
- Preview and automatic runtime tests can start when Service Worker control is unavailable and use the isolated preview bridge instead.
- Expected resource cancellations during preview teardown no longer appear as runtime errors in the browser console.

### Privacy

- Loading the validator no longer sends automatic font or logo requests to Google Fonts, GitHub Raw, or StreamShapers.

## 0.2.0 - 2026-08-10

### Added

- Inspection for action durations, thumbnails, engine requirements, GDD ordering and visibility, and typed multi-select fields.
- Independent discovery and caching for multiple manifests in one directory.
- Session- and tab-isolated sandbox runners for interactive preview and automatic realtime and non-realtime runtime tests.
- Opaque-sandbox module graphs with Unicode subimports, package-local variable dynamic imports, and literal `new URL(..., import.meta.url)` assets.
- Sandbox-safe support for directory URLs, literal `import.meta.resolve(...)` package files, and lazy package fetches.
- Session-bound CSS graphs for nested imports, fonts, images, linked stylesheets, inline styles, and changed style text.
- Local `srcset` candidates with preserved density and width descriptors, including data URLs and concurrent assignments.
- Module and classic Dedicated Workers with local imports, `importScripts()`, package fetches, errors, and termination.
- Clear inconclusive results for unsupported dynamic worker entries and `SharedWorker` when they are used.
- Unicode-safe resource transport with media MIME types, `HEAD`, and byte-range support.
- App unit tests and Chromium end-to-end coverage for scanning, inspection, preview isolation, assets, workers, and runtime lifecycles.

### Changed

- OGraf steps and `currentStep` handling are consistently zero-based.
- Runtime ReturnPayload checks distinguish undefined success, 2xx success, non-2xx failure, malformed payloads, and top-level `currentStep`.
- Scan, watcher, and runtime results are generation-aware and abort when roots or files change.
- Opening a package moves its pending runtime test to the front of the queue.
- The header includes a rescan action for the current directory.
- Settings use clearer text, responsive controls, validated saved values, and a recoverable preview reset.
- Valid fixtures export complete OGraf `HTMLElement` implementations; an invalid fixture covers missing runtime API behavior.
- The app now uses Vite 8.2.1, Vitest 4.1.10, and PostCSS 8.5.26.

### Fixed

- Background runtime tests keep animation frames active for graphics that use libraries such as GSAP.
- DOM resource errors show the failed resource instead of `[object Event]`.
- Literal asset-directory URLs are no longer mistaken for files.

### Security

- Package JavaScript runs in transient iframes with `sandbox="allow-scripts"` and no same-origin capability instead of the validator origin.
