# Contributing

Thanks for helping improve OGraf Validator.

## Before you start

- Search existing issues before opening a new one.
- Use [GitHub Security Advisories](SECURITY.md) for security problems. Do not
  report them in a public issue.
- Do not attach private broadcast packages, credentials, licensed media, or
  other files that you cannot share publicly.
- Keep changes focused. Large refactors that are not needed for OGraf support
  should be discussed in an issue first.

## Development setup

You need Node.js 24 or newer, npm 11.5.1 or newer, and Google Chrome for
browser tests.

The project runs `tsc` with TypeScript 7. ESLint currently uses the TypeScript
6 compiler API through a separate package alias. Keep both root dependencies
until `typescript-eslint` supports the TypeScript 7 API.

```bash
npm ci
npm run dev
```

The app runs at `http://localhost:3000`.

## Repository structure

- `packages/app` contains the React browser application.
- `packages/validator-core` contains the public validation library and the
  pinned OGraf v1 specification snapshot.
- `fixtures` contains valid and invalid packages used by tests.
- `scripts` contains release and package checks.

## Making changes

- Use clear, simple English in the UI and documentation.
- Keep relative ESM imports suffixed with `.js`, including imports written in
  TypeScript.
- Keep package code inside the opaque preview sandbox. Do not add
  `allow-same-origin` or expose directory handles to a Graphic.
- Add tests for changes to validation, scanning, preview transport, runtime
  behavior, or package readiness.
- Follow the [release guide](RELEASING.md) for version changes and tags.
- Include the affected package version, lockfile version, and changelog entry
  in every release-relevant pull request.

### Specification changes

The validator uses a pinned OGraf Graphics v1 snapshot. Do not edit vendored
schema files or generated validation code by hand.

Discuss specification updates before starting them. A spec update should be a
separate pull request that records the upstream commit, updates source hashes,
regenerates the standalone validator, and adds fixtures for changed behavior.

Use `npm run spec:check` for offline integrity and `npm run spec:check:upstream`
for a read-only comparison with EBU `main`. The latter first verifies local
integrity, then compares the Graphics specification, all JSON-schema sources,
license, and the four existing reference manifests. It resolves `main` once so
all requests inspect the same commit. Website and Server API changes are outside
this scope.

The online result is `current` (exit 0), `changed` (exit 1; manual review needed),
or `unavailable` (exit 2; the API could not be checked). Local integrity failures
exit 1 without making network requests. `GITHUB_TOKEN` is optional for local
calls. No command downloads replacement files or creates commits automatically.

The **EBU specification freshness** workflow runs on the default branch every
Monday at 07:23 UTC and supports manual dispatch. Source changes and unavailable
checks fail this independent workflow; normal PR and release gates remain offline.

For an approved update:

1. Record the complete target commit and its UTC committer date. Review the
   selected source diff; annotations and example corrections do not establish
   new normative requirements.
2. Replace the single `ebu-ograf-v1-<sha8>` directory with the target commit's
   root `LICENSE`, `v1/specification/docs/Specification.md`, complete
   `v1/specification/json-schemas` tree, and these exact manifests:
   `l3rd-name/l3rd.ograf.json`, `minimal/minimal.ograf.json`,
   `ograf-logo/logo.ograf.json`, and `renderer-test/manifest.ograf.json` under
   `v1/examples`. Preserve UTF-8 content; apply only checkout LF normalization.
3. Update `SNAPSHOT.json`, `SNAPSHOT.md`, and sorted `SHA256SUMS` entries for all
   snapshot files except the checksum file itself. Update both READMEs and the
   Unreleased core changelog; retain historical release entries.
4. Run `npm run generate:validator --workspace=packages/validator-core`. Review
   the generated diff and any effects on hand-written rules and types. Update
   reference tests while retaining independent regressions for older defects.
5. Run the checks below, the core-package smoke test, and an online check. A
   still-newer EBU commit may require review but must not silently replace the
   explicitly selected target.

## Checks

Run the checks that cover your change. Before opening a pull request, run the
complete release gate when possible:

```bash
npm run release:check
```

The release gate runs linting, type checking, unit tests, spec checks, builds,
the installed core-package smoke test, Playwright against the production
`dist`, and dependency audits.

## Commits and pull requests

- Use Conventional Commits, for example `fix(app): explain runtime payload
  errors` or `feat(core): validate thumbnail paths`.
- Explain what changed and why.
- Link related issues or OGraf specification sections.
- Include screenshots for visible UI changes.
- Keep generated files in the same commit as the source change that produced
  them.
- Do not mix unrelated cleanup into a feature or bug fix.
- Do not move or reuse release tags.

By submitting a contribution, you agree that it may be distributed under the
[MIT License](LICENSE).
