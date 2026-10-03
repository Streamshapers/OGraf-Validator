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

## App distribution and manual FTP deployment

Build the app from the same reviewed commit that passed `npm run release:check`.
For app 0.3.0, validate metadata with `node scripts/check-release-tag.mjs app-v0.3.0`.
The core remains at its already published version unless core sources change.
Do not recreate an existing core release for an app-only update.

The website is the **contents** of `packages/app/dist/`, including `assets/`,
fonts, `preview-runner.html`, `preview-runner.js` and `preview-sw.js`.
Do not upload the repository, source files, `node_modules`, test reports or the
local roadmap. Keep release notes, checksums and verification notes outside the
public website root. Keep a SHA-256 file manifest with the local release archive.

Before an authorized upload:

1. Back up the complete currently deployed website and retain its server-specific
   configuration (such as `.htaccess`). The build does not contain or replace
   that configuration.
2. Extract the prepared ZIP locally. Check its checksum and file manifest. The
   extracted root should contain `index.html` directly, not a `dist/` wrapper.
3. Prefer uploading into a separate release directory and switching the document
   root after the upload. If only in-place FTP is available, use a maintenance
   window, upload all assets and runner files first, and replace `index.html`
   last. An in-place upload is not atomic; existing tabs may need reloading.
4. Retain old hashed assets until the new release is verified and old tabs have
   been reloaded. Do not delete the entire remote directory before uploading.
5. Verify the displayed app/core versions, folder and ZIP loading, one passing
   Graphic, the standard and extended tests, report exports and sandbox preview.
   Test with a fresh tab as well as a reload of an existing tab.
6. If verification fails, restore the complete previous build together. Do not
   mix runner/Service Worker files from different releases.

Serve the site over HTTPS with the existing JavaScript/WASM/font MIME types.
HTML, the preview runner and Service Worker should revalidate rather than stay
in a long-lived immutable cache; content-hashed `assets/` files can use a long
cache lifetime. Verify hosting cache/CDN behavior before considering the upload
complete. Local release preparation does not publish a GitHub release or upload
anything by FTP.
