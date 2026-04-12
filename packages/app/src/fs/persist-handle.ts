/**
 * Persists a FileSystemDirectoryHandle in IndexedDB so it can be
 * restored across sessions (user must re-confirm permission on reopen).
 */

const DB_NAME  = 'ograf-validator';
const DB_VER   = 1;
const STORE    = 'handles';
const KEY      = 'last-directory';

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
        const tx  = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(handle, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
    });
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
        req.onerror   = () => reject(req.error);
    });
}
