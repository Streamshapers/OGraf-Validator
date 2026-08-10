const IGNORED_DIRS = new Set(['node_modules', '.git', '.idea', 'dist', 'build', '__pycache__']);
const MAX_DEPTH = 6;

export interface PackageEntry {
    /** Stable unique key. Equal to the manifest path relative to the selected root. */
    key: string;
    /**
     * Backwards-compatible cache key used by the current app shell.
     * Equal to `key`; do not treat it as a directory path.
     */
    path: string;
    /** Manifest path relative to the selected root, e.g. "graphics/lower-third.ograf.json". */
    manifestPath: string;
    /** Directory containing the manifest, relative to the selected root. */
    directoryPath: string;
    /** Human-readable fallback shown until the manifest has been parsed. */
    displayName: string;
    dirHandle: FileSystemDirectoryHandle;
    /** The actual *.ograf.json filename found (e.g. "manifest.ograf.json") */
    manifestFilename: string;
}

/**
 * Recursively scan a directory handle for ograf packages.
 * Every file ending with ".ograf.json" represents an independent Graphic.
 * Multiple manifests may share one directory and its resources, so discovery
 * always continues into child directories after finding a manifest.
 */
export async function scanPackages(
    dir: FileSystemDirectoryHandle,
    relativePath = '',
    depth = 0,
    maxDepth = MAX_DEPTH,
    signal?: AbortSignal,
): Promise<PackageEntry[]> {
    throwIfAborted(signal);
    if (depth > maxDepth) return [];

    const entries: [string, FileSystemHandle][] = [];
    for await (const entry of dir.entries()) {
        throwIfAborted(signal);
        entries.push(entry);
    }
    entries.sort(([a], [b]) => compareNames(a, b));

    const manifestFilenames = entries
        .filter((entry): entry is [string, FileSystemFileHandle] =>
            entry[1].kind === 'file' && entry[0].endsWith('.ograf.json'),
        )
        .map(([name]) => name);

    const packages: PackageEntry[] = manifestFilenames.map((manifestFilename) => {
        const manifestPath = joinPath(relativePath, manifestFilename);
        const displayName = manifestFilenames.length === 1
            ? (relativePath || dir.name)
            : manifestPath;

        return {
            key: manifestPath,
            path: manifestPath,
            manifestPath,
            directoryPath: relativePath || '.',
            displayName,
            dirHandle: dir,
            manifestFilename,
        };
    });

    for (const [name, handle] of entries) {
        throwIfAborted(signal);
        if (handle.kind !== 'directory') continue;
        if (IGNORED_DIRS.has(name) || name.startsWith('.')) continue;

        const subPath = relativePath ? `${relativePath}/${name}` : name;
        const subPackages = await scanPackages(
            handle as FileSystemDirectoryHandle,
            subPath,
            depth + 1,
            maxDepth,
            signal,
        );
        packages.push(...subPackages);
    }

    return packages;
}

function joinPath(parent: string, child: string): string {
    return parent ? `${parent}/${child}` : child;
}

function compareNames(a: string, b: string): number {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (!signal?.aborted) return;
    if (signal.reason !== undefined) throw signal.reason;
    throw new DOMException('Directory scan aborted.', 'AbortError');
}
