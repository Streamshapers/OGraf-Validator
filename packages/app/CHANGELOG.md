# OGraf Validator App Changelog

All notable changes to the hosted OGraf Validator app are documented here.

## 0.3.0 - 2026-10-03

### Added

- Expected/received runtime explanations with captured inputs per observation, consistent clipboard/report details, and explicit missing-evidence labels.
- Manifest issue links that expand and focus the affected field (or the parent of a missing field), with current-value inspection and ambiguity checks.

- Reproduction context in JSON/HTML reports: build and EBU versions, browser, run times, bounded package fingerprints, actual call parameters, render configuration and raw responses with explicit undefined/unavailable evidence.
- Local export review with included-data inspection and cancellation before download; retained observations keep their original runtime context.

- Optional extended runtime tests for relative and absolute step navigation, animation-enabled actions, repeated lifecycles, and NRT seeking.
- Separate standard and extended results with scenario progress, background execution, cancellation, and two-minute budgets with five- and ten-minute retries after timeouts.
- Scenario and step expectations in diagnostic details and exports, with explicit coverage limits and fresh sandbox sessions for independent scenarios.

### Fixed

- Describe executed checks with Checks Passed/Failed and Manifest Valid/Invalid instead of production readiness and a synthetic percentage. Share scope notes across the UI and exports; JSON readiness now uses `checks-passed`, `checksPassed`, and `staticLabel` in place of the former production status and score.

- Show repeated contract failures once across standard and extended tests, with all observations available in expandable details and exports. Keep incomplete coverage separate from issue counts.
- Preserve known runtime failures during retries and incomplete or cancelled attempts; replace them only after a conclusive run of the same suite.
- Ignore stale progress and results after package changes and await sandbox cleanup before advancing the runtime queue.

## 0.2.4 - 2026-10-03

### Fixed

- Diagnose runtime failures from structured check metadata instead of matching words in Graphic errors; distinguish EmptyPayload, status fields, steps, exports, and Promise contracts.
- Bound test-data generation, validate generated input before invoking Graphics, exercise parameterless custom actions, and mark incomplete checks as inconclusive.
- Capture uncaught runtime errors through cleanup and check the expected first step when the manifest declares a known step count.
- Validate manual schedule parameter shapes and declared custom-action IDs before dispatch.
- Update indirect development dependencies `brace-expansion` and `fast-uri` to resolve the release audit findings.

### Added

- Consistent diagnostic guidance and official specification references in the UI, clipboard output, and JSON/HTML reports.
- Browser regressions for runtime diagnostics, input gaps, cleanup failures, exports, and the versioned sandbox handshake.

## 0.2.3 - 2026-09-16

### Fixed

- Keep internal file-broker errors out of preview resource responses while preserving their HTTP status codes.
- Return empty bodies for failed HEAD requests.

### Added

- Regression tests for preview error responses and the isolated runner handshake, with documentation of its required wildcard target origin.

## 0.2.2 - 2026-09-16

### Changed

- Update React and React DOM to 19.3.0, the preview Worker bundler to Rollup 4.63.1, PostCSS to 8.5.28, and Lucide icons to 1.44.0.
- Update Vite to 8.3.0, its React plugin to 6.1.1, Playwright to 1.63.0, and the linting and type dependencies.

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

- Preview background colors and images are rendered inside the isolated sandbox, so they remain visible behind transparent Graphics in Chromium.
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
