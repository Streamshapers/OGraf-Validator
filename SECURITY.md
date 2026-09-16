# Security Policy

OGraf Validator reads local packages and runs their JavaScript inside an
isolated browser sandbox. Security reports are welcome.

## Supported versions

| Package | Supported |
| --- | --- |
| OGraf Validator app 0.2.x | Yes |
| Validator core 0.2.x | Yes |
| Older versions | No |

## Report a vulnerability

Use GitHub's private vulnerability reporting:

[Report a vulnerability privately](https://github.com/Streamshapers/OGraf-Validator/security/advisories/new)

Please do not open a public issue for a possible vulnerability.

Include the following when possible:

- the affected app or core version;
- browser and operating system;
- a clear description of the impact;
- steps or a small test package that reproduces the problem;
- whether the issue can cross package, tab, session, directory, or origin
  boundaries.

Remove private data, credentials, licensed media, and unrelated package files
before sharing a reproduction.

We will review the report, confirm whether it is in scope, and coordinate a fix
and disclosure through the private advisory.

## Security scope

Examples of security issues include:

- package code reaching the validator DOM or origin storage;
- reading files outside the directory selected by the user;
- package or resource data leaking between sessions or tabs;
- path traversal or unsafe URL handling;
- script injection in validator UI or exported reports;
- a validation bypass with a direct security impact.

OGraf compatibility bugs without a security impact can be reported with the
public OGraf compatibility issue form.

## Preview communication

The preview iframe uses exactly `sandbox="allow-scripts"`. Its opaque origin
requires `targetOrigin: '*'` for the initial `postMessage` to that specific
iframe's `contentWindow`. This is not a broadcast. Adding `allow-same-origin`
would weaken the isolation and is not an acceptable way to silence a scanner.

The parent loads the application-owned runner and transfers one MessagePort
before sending any package code. The runner accepts this connection only from
its parent, checks the protocol and message shape, and then removes the window
message listener. Subsequent traffic uses the private port and checks the
protocol, runner ID, and session ID. Package file requests are limited to the
active session and normalized package-relative paths.

CodeQL's `js/cross-window-information-leak` rule reports this bootstrap because
of its wildcard target origin. The wildcard is an intentional exception for
the opaque frame. `packages/app/e2e/preview-security.spec.ts` exercises the real
runner in Chrome: a concrete target origin cannot connect, unrelated windows
cannot claim the port, and invalid protocol, runner, session, and replacement
connections are rejected. Reassess this exception if the runner URL becomes
package-controlled, package execution moves before the handshake, or the
receiver and session checks change.

Preview Service Worker error responses contain only fixed messages. Detailed
errors are logged in the trusted worker's console, not included in resource
responses that package code can read.
