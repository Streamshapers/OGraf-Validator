import { useEffect, useRef } from 'react';

/** Recursively collect { path → lastModified } for all files in a directory. */
async function getSnapshot(
    handle: FileSystemDirectoryHandle,
    prefix = '',
): Promise<Map<string, number>> {
    const snapshot = new Map<string, number>();
    for await (const [name, entry] of handle.entries()) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (entry.kind === 'file') {
            const file = await (entry as FileSystemFileHandle).getFile();
            snapshot.set(path, file.lastModified);
        } else if (entry.kind === 'directory') {
            const sub = await getSnapshot(entry as FileSystemDirectoryHandle, path);
            for (const [k, v] of sub) snapshot.set(k, v);
        }
    }
    return snapshot;
}

function snapshotsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
    if (a.size !== b.size) return false;
    for (const [key, val] of a) {
        if (b.get(key) !== val) return false;
    }
    return true;
}

/**
 * Polls a directory for file changes at a given interval.
 * Calls `onChanged` when any file is added, removed, or modified.
 * Does nothing when `enabled` is false or `dirHandle` is null.
 */
export function useFileWatcher(
    dirHandle: FileSystemDirectoryHandle | null,
    enabled: boolean,
    intervalMs: number,
    onChanged: () => void,
): void {
    const snapshotRef = useRef<Map<string, number> | null>(null);
    const onChangedRef = useRef(onChanged);
    onChangedRef.current = onChanged;

    useEffect(() => {
        if (!enabled || !dirHandle) {
            snapshotRef.current = null;
            return;
        }

        let cancelled = false;

        // Take initial snapshot without triggering a change
        void getSnapshot(dirHandle).then((initial) => {
            if (!cancelled) snapshotRef.current = initial;
        });

        const id = setInterval(() => {
            void getSnapshot(dirHandle).then((next) => {
                if (cancelled) return;
                const prev = snapshotRef.current;
                if (prev !== null && !snapshotsEqual(prev, next)) {
                    onChangedRef.current();
                }
                snapshotRef.current = next;
            });
        }, intervalMs);

        return () => {
            cancelled = true;
            clearInterval(id);
            snapshotRef.current = null;
        };
    }, [dirHandle, enabled, intervalMs]);
}
