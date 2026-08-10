import { describe, expect, it } from 'vitest';
import { scanPackages } from '../scan-packages.js';

interface MockTree {
    [name: string]: 'file' | MockTree;
}

describe('scanPackages', () => {
    it('discovers every manifest in a directory and continues into child directories', async () => {
        const root = createDirectory('graphics', {
            'z.ograf.json': 'file',
            'a.ograf.json': 'file',
            shared: {
                'image.png': 'file',
                'nested.ograf.json': 'file',
            },
        });

        const result = await scanPackages(root);

        expect(result.map((entry) => entry.manifestPath)).toEqual([
            'a.ograf.json',
            'z.ograf.json',
            'shared/nested.ograf.json',
        ]);
        expect(result.map((entry) => entry.key)).toEqual(result.map((entry) => entry.manifestPath));
        expect(result.map((entry) => entry.path)).toEqual(result.map((entry) => entry.manifestPath));
        expect(result[0]?.directoryPath).toBe('.');
        expect(result[2]?.directoryPath).toBe('shared');
        expect(result[0]?.dirHandle).toBe(root);
        expect(result[1]?.dirHandle).toBe(root);
        expect(new Set(result.map((entry) => entry.key)).size).toBe(result.length);
    });

    it('is deterministic regardless of directory iteration order', async () => {
        const root = createDirectory('graphics', {
            zebra: { 'third.ograf.json': 'file' },
            'second.ograf.json': 'file',
            alpha: { 'first.ograf.json': 'file' },
        }, true);

        const result = await scanPackages(root);

        expect(result.map((entry) => entry.manifestPath)).toEqual([
            'second.ograf.json',
            'alpha/first.ograf.json',
            'zebra/third.ograf.json',
        ]);
    });

    it('honours ignored directories and the maximum depth', async () => {
        const root = createDirectory('graphics', {
            '.hidden': { 'hidden.ograf.json': 'file' },
            node_modules: { 'dependency.ograf.json': 'file' },
            level1: {
                'included.ograf.json': 'file',
                level2: { 'too-deep.ograf.json': 'file' },
            },
        });

        const result = await scanPackages(root, '', 0, 1);

        expect(result.map((entry) => entry.manifestPath)).toEqual(['level1/included.ograf.json']);
    });

    it('aborts during directory iteration with an AbortError', async () => {
        const controller = new AbortController();
        const root = createDirectory('graphics', {
            'first.ograf.json': 'file',
            'second.ograf.json': 'file',
        }, false, () => controller.abort());

        await expect(scanPackages(root, '', 0, 6, controller.signal)).rejects.toMatchObject({
            name: 'AbortError',
        });
    });
});

function createDirectory(
    name: string,
    tree: MockTree,
    reverse = false,
    beforeFirstYield?: () => void,
): FileSystemDirectoryHandle {
    const entries = Object.entries(tree).map(([entryName, value]) => {
        const handle = value === 'file'
            ? createFile(entryName)
            : createDirectory(entryName, value);

        return [entryName, handle] as [string, FileSystemHandle];
    });
    if (reverse) entries.reverse();

    return {
        kind: 'directory',
        name,
        async *entries() {
            let first = true;
            for (const entry of entries) {
                if (first) {
                    first = false;
                    beforeFirstYield?.();
                }
                yield entry;
            }
        },
    } as FileSystemDirectoryHandle;
}

function createFile(name: string): FileSystemFileHandle {
    return { kind: 'file', name } as FileSystemFileHandle;
}
