import type { VirtualFS } from '@streamshapers/ograf-validator-core';

const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', '.idea', 'dist', 'build', '__pycache__']);

/**
 * VirtualFS implementation backed by the File System Access API.
 * Wrap a FileSystemDirectoryHandle (the package root) to provide
 * file reads and existence checks used by validatePackage().
 */
export class BrowserFS implements VirtualFS {
    constructor(private readonly root: FileSystemDirectoryHandle) {}

    async readFile(path: string): Promise<string> {
        const handle = await this.resolveFile(path);
        const file = await handle.getFile();

        return file.text();
    }

    async readArrayBuffer(path: string): Promise<ArrayBuffer> {
        const handle = await this.resolveFile(path);
        const file = await handle.getFile();

        return file.arrayBuffer();
    }

    async fileExists(path: string): Promise<boolean> {
        try {
            await this.resolveFile(path);

            return true;
        } catch {
            return false;
        }
    }

    async getFileSize(path: string): Promise<number> {
        const handle = await this.resolveFile(path);
        const file = await handle.getFile();

        return file.size;
    }

    async listFiles(basePath?: string): Promise<string[]> {
        const start = basePath ? await this.resolveDir(basePath) : this.root;

        return collectFiles(start, '');
    }

    private async resolveFile(path: string): Promise<FileSystemFileHandle> {
        const parts = splitSafePath(path);
        const fileName = parts.pop();
        if (!fileName) throw new Error(`Invalid file path: "${path}"`);
        let dir = this.root;
        for (const segment of parts) {
            dir = await dir.getDirectoryHandle(segment);
        }

        return dir.getFileHandle(fileName);
    }

    private async resolveDir(path: string): Promise<FileSystemDirectoryHandle> {
        const parts = splitSafePath(path);
        let dir = this.root;
        for (const segment of parts) {
            dir = await dir.getDirectoryHandle(segment);
        }

        return dir;
    }
}

async function collectFiles(
    dir: FileSystemDirectoryHandle,
    prefix: string,
): Promise<string[]> {
    const results: string[] = [];
    const entries: [string, FileSystemHandle][] = [];
    for await (const entry of dir.entries()) entries.push(entry);
    entries.sort(([a], [b]) => a.localeCompare(b, 'en'));

    for (const [name, handle] of entries) {
        if (handle.kind === 'file') {
            results.push(prefix ? `${prefix}/${name}` : name);
        } else {
            if (IGNORED_DIRECTORIES.has(name) || name.startsWith('.')) continue;
            const subDir = handle as FileSystemDirectoryHandle;
            const subPrefix = prefix ? `${prefix}/${name}` : name;
            const sub = await collectFiles(subDir, subPrefix);
            results.push(...sub);
        }
    }

    return results;
}

function splitSafePath(path: string): string[] {
    const normalized = path.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
        throw new Error(`Absolute paths are not allowed: "${path}"`);
    }

    const parts = normalized.split('/').filter((part) => part.length > 0 && part !== '.');
    if (parts.some((part) => part === '..')) {
        throw new Error(`Parent traversal is not allowed: "${path}"`);
    }

    return parts;
}
