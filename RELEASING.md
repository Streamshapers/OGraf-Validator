# Releasing OGraf Validator

The app and validator core have separate versions and changelogs. There is no
shared repository version.

## Release tags

Use these exact stable SemVer tag formats:

- App: `app-vX.Y.Z`
- Validator core and npm package: `core-vX.Y.Z`

For example, app version `0.3.0` uses `app-v0.3.0`, while core version `0.2.1`
uses `core-v0.2.1`.

The tag version must match all of these files:

- the affected package's `package.json`
- the affected workspace entry in `package-lock.json`
- one dated `## X.Y.Z - YYYY-MM-DD` heading in the affected changelog

Prerelease tags are not supported yet. Do not create a root `vX.Y.Z` tag. Never
move, delete, or reuse a tag or package version after it has been published.

## Release pull requests

A pull request with release-relevant app or core changes must include:

1. the version update for the affected package;
2. the matching workspace version in `package-lock.json`;
3. the release notes in the affected changelog.

Include these changes in the same pull request as the released behavior. Do not
add them after the pull request has been merged or the app has been deployed.
Documentation, tests, and repository infrastructure that do not change a
released app or package do not need a version bump.

Run the full release gate before merging:

```bash
npm ci
npm run release:check
```

## Create a release

1. Merge the release pull request into `master` after all required checks pass.
2. Create a new GitHub release from the final `master` commit.
3. Use the exact app or core tag described above.
4. Copy the matching changelog section into the GitHub release notes.
5. Publish the GitHub release. Do not create it as a prerelease.

You can check the release metadata locally before publishing:

```bash
node scripts/check-release-tag.mjs app-v0.3.0
node scripts/check-release-tag.mjs core-v0.2.1
```

## Core package publishing

Publishing any GitHub release starts `.github/workflows/publish-core.yml` to
check the tag convention and confirm that the tagged commit is part of
`master`. For a valid `core-vX.Y.Z` release, the workflow also:

1. checks the tag, package version, lockfile, and changelog;
2. runs the complete release gate from the tagged commit;
3. publishes `@streamshapers/ograf-validator-core` to npm through OpenID
   Connect (OIDC).

The workflow does not use a long-lived npm token. npm creates provenance for
the public package automatically. An `app-vX.Y.Z` release never publishes an
npm package.

The npm package must have this trusted publisher configuration:

- Provider: GitHub Actions
- Organization: `Streamshapers`
- Repository: `OGraf-Validator`
- Workflow filename: `publish-core.yml`
- Environment: leave empty
- Allowed action: `npm publish`

After the first automated publish succeeds, set the npm package's publishing
access to require two-factor authentication and disallow traditional publish
tokens.
