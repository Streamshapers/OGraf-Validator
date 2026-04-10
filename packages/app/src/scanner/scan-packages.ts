const IGNORED_DIRS = new Set(['node_modules', '.git', '.idea', 'dist', 'build', '__pycache__']);
const MAX_DEPTH = 6;

export interface PackageEntry {
    /** Relative path from root, e.g. "valid-basic" or "packages/my-graphic" */
    path: string;
    /** Directory name shown in UI */
    displayName: string;
    dirHandle: FileSystemDirectoryHandle;
    /** The actual *.ograf.json filename found (e.g. "manifest.ograf.json") */
    manifestFilename: string;
}

/**
 * Recursively scan a directory handle for ograf packages.
 * A package is any directory containing a file ending with ".ograf.json".
 * Stops recursing once a manifest is found in a directory.
 */
export async function scanPackages(
    dir: FileSystemDirectoryHandle,
    relativePath = '',
    depth = 0,
): Promise<PackageEntry[]> {
    if (depth > MAX_DEPTH) return [];

    const manifestFilename = await findOgrafManifest(dir);
    if (manifestFilename) {
        return [
            {
                path: relativePath || '.',
                displayName: relativePath || dir.name,
                dirHandle: dir,
                manifestFilename,
            },
        ];
    }

    const packages: PackageEntry[] = [];

    for await (const [name, handle] of dir.entries()) {
        if (handle.kind !== 'directory') continue;
        if (IGNORED_DIRS.has(name) || name.startsWith('.')) continue;

        const subPath = relativePath ? `${relativePath}/${name}` : name;
        const subPackages = await scanPackages(
            handle as FileSystemDirectoryHandle,
            subPath,
            depth + 1,
        );
        packages.push(...subPackages);
    }

    return packages;
}

/** Returns the first *.ograf.json filename found in a directory, or null. */
async function findOgrafManifest(dir: FileSystemDirectoryHandle): Promise<string | null> {
    for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'file' && name.endsWith('.ograf.json')) {
            return name;
        }
    }

    return null;
}
