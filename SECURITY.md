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
