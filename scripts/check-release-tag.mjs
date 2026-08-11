import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stableTagPattern = /^(app|core)-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

const releaseTargets = {
    app: {
        workspace: 'packages/app',
        changelog: 'packages/app/CHANGELOG.md',
    },
    core: {
        workspace: 'packages/validator-core',
        changelog: 'packages/validator-core/CHANGELOG.md',
    },
};

export function parseReleaseTag(tag) {
    if (typeof tag !== 'string' || tag.length === 0) {
        throw new Error('Set RELEASE_TAG or pass an app-vX.Y.Z or core-vX.Y.Z tag.');
    }

    const match = stableTagPattern.exec(tag);
    if (match === null) {
        throw new Error(
            `Invalid release tag "${tag}". Use app-vX.Y.Z or core-vX.Y.Z with a stable SemVer version.`,
        );
    }

    const target = match[1];
    if (target !== 'app' && target !== 'core') {
        throw new Error(`Unsupported release target "${String(target)}".`);
    }

    return {
        target,
        version: `${match[2]}.${match[3]}.${match[4]}`,
    };
}

export function validateReleaseMetadata({ tag, packageJson, lockfile, changelog }) {
    const release = parseReleaseTag(tag);
    const definition = releaseTargets[release.target];

    if (packageJson.version !== release.version) {
        throw new Error(
            `${tag} does not match ${definition.workspace}/package.json version ${String(packageJson.version)}.`,
        );
    }

    const lockWorkspace = lockfile.packages?.[definition.workspace];
    if (lockWorkspace?.version !== release.version) {
        throw new Error(
            `${tag} does not match package-lock.json version ${String(lockWorkspace?.version)} for ${definition.workspace}.`,
        );
    }

    const escapedVersion = release.version.replaceAll('.', '\\.');
    const changelogPattern = new RegExp(
        `^## ${escapedVersion} - \\d{4}-\\d{2}-\\d{2}$`,
        'gmu',
    );
    const changelogHeadings = changelog.match(changelogPattern) ?? [];

    if (changelogHeadings.length !== 1) {
        throw new Error(
            `${definition.changelog} must contain exactly one dated "## ${release.version} - YYYY-MM-DD" heading.`,
        );
    }

    return {
        ...release,
        workspace: definition.workspace,
        changelog: definition.changelog,
    };
}

export async function checkReleaseTag(tag, root = repositoryRoot) {
    const release = parseReleaseTag(tag);
    const definition = releaseTargets[release.target];
    const [packageText, lockText, changelog] = await Promise.all([
        readFile(resolve(root, definition.workspace, 'package.json'), 'utf8'),
        readFile(resolve(root, 'package-lock.json'), 'utf8'),
        readFile(resolve(root, definition.changelog), 'utf8'),
    ]);

    return validateReleaseMetadata({
        tag,
        packageJson: JSON.parse(packageText),
        lockfile: JSON.parse(lockText),
        changelog,
    });
}

const invokedAsScript = process.argv[1] !== undefined
    && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedAsScript) {
    const tag = process.argv[2] ?? process.env.RELEASE_TAG;

    try {
        const release = await checkReleaseTag(tag);
        console.log(
            `Release tag OK: ${release.target} ${release.version} (${release.workspace}).`,
        );
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
