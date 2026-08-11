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

You need Node.js 24 or newer, npm 11 or newer, and Google Chrome for browser
tests.

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
- Add a changelog entry to the app or core changelog when users are affected.

### Specification changes

The validator uses a pinned OGraf Graphics v1 snapshot. Do not edit vendored
schema files or generated validation code by hand.

Discuss specification updates before starting them. A spec update should be a
separate pull request that records the upstream commit, updates source hashes,
regenerates the standalone validator, and adds fixtures for changed behavior.

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

By submitting a contribution, you agree that it may be distributed under the
[MIT License](LICENSE).
