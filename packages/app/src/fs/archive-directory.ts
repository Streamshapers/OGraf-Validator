/** Read-only, in-memory directory adapter. No archive contents are persisted or extracted to disk. */
const archives = new WeakSet<object>();

export function isArchiveDirectory(handle: FileSystemDirectoryHandle | null): boolean {
    return handle !== null && archives.has(handle);
}

export function createArchiveDirectory(name: string, files: Map<string, File>): FileSystemDirectoryHandle {
    const directories = new Map<string, FileSystemDirectoryHandle>();
    const fileHandles = new Map<string, FileSystemFileHandle>();
    const readOnly = () => { throw new DOMException('ZIP imports are read-only.', 'NotAllowedError'); };
    const notFound = () => new DOMException('Archive entry not found.', 'NotFoundError');
    const checkName = (value: string) => {
        if (!value || value === '.' || value === '..' || /[/\\]/.test(value)) throw notFound();
    };
    const directory = (path: string): FileSystemDirectoryHandle => {
        const existing = directories.get(path);
        if (existing) return existing;
        const prefix = path ? `${path}/` : '';
        const childNames = new Set([...files.keys()].filter((file) => file.startsWith(prefix))
            .map((file) => file.slice(prefix.length).split('/')[0]!));
        const children = () => [...childNames].sort().map((child): [string, FileSystemHandle] => {
            const full = prefix + child;
            const file = files.get(full);
            if (!file) return [child, directory(full)];
            let handle = fileHandles.get(full);
            if (!handle) {
                handle = { kind: 'file', name: child, getFile: async () => file,
                    createWritable: async () => readOnly(),
                    isSameEntry: async (other: FileSystemHandle) => other === handle,
                } as FileSystemFileHandle;
                fileHandles.set(full, handle);
            }
            return [child, handle];
        });
        const handle = {
            kind: 'directory', name: path ? path.split('/').at(-1)! : name,
            async getFileHandle(child: string, options?: FileSystemGetFileOptions) {
                child = child.normalize('NFC');
                checkName(child);
                if (options?.create) readOnly();
                const found = children().find(([key, entry]) => key === child && entry.kind === 'file');
                if (!found) throw notFound();
                return found[1] as FileSystemFileHandle;
            },
            async getDirectoryHandle(child: string, options?: FileSystemGetDirectoryOptions) {
                child = child.normalize('NFC');
                checkName(child);
                if (options?.create) readOnly();
                const found = children().find(([key, entry]) => key === child && entry.kind === 'directory');
                if (!found) throw notFound();
                return found[1] as FileSystemDirectoryHandle;
            },
            async *entries() { yield* children(); },
            async *keys() { yield* [...childNames].sort(); },
            async *values() { for (const [, entry] of children()) yield entry; },
            async *[Symbol.asyncIterator]() { yield* children(); },
            async isSameEntry(other: FileSystemHandle) { return other === handle; },
            async removeEntry() { readOnly(); },
            async resolve(other: FileSystemHandle) {
                for (const [full, entry] of [...directories, ...fileHandles]) {
                    if (entry === other && (full === path || full.startsWith(prefix))) {
                        return full === path ? [] : full.slice(prefix.length).split('/');
                    }
                }
                return null;
            },
        } as FileSystemDirectoryHandle;
        directories.set(path, handle);
        archives.add(handle);
        return handle;
    };
    return directory('');
}
