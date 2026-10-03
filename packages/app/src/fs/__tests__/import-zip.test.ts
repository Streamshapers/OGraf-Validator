import { expect, it } from 'vitest';
import { importZip } from '../import-zip.js';
import { BrowserFS } from '../browser-fs.js';
import { scanPackages } from '../../scanner/scan-packages.js';
import { isArchiveDirectory } from '../archive-directory.js';
import { zipFixture, type ZipFixtureEntry } from '../../__tests__/zip-fixture.js';

const manifest = { name: 'manifest.ograf.json', content: '{}' };
const archive = (entries: ZipFixtureEntry[]) => new File([zipFixture(entries)], 'graphics.zip', { lastModified: 1234 });

it('opens stored and deflated entries, nested packages, shared files and UTF-8 names', async () => {
    const directory = await importZip(archive([
        { ...manifest, name: 'Bundle/a.ograf.json', stored: true },
        { ...manifest, name: 'Bundle/b.ograf.json' },
        { name: 'Bundle/shared/café.mjs', content: 'export const value = "123456789";' },
        { name: '__MACOSX/._fake.ograf.json', content: 'ignored' },
    ]));
    expect(isArchiveDirectory(directory)).toBe(true);
    expect((await scanPackages(directory)).map((entry) => entry.manifestFilename)).toEqual(['a.ograf.json', 'b.ograf.json']);
    const fs = new BrowserFS(directory);
    expect(await fs.readFile('Bundle/shared/café.mjs')).toContain('123456789');
    expect(await fs.listFiles()).toHaveLength(3);
    expect(await fs.getFileSize('Bundle/a.ograf.json')).toBe(2);
    await expect(directory.getFileHandle('new', { create: true })).rejects.toThrow('read-only');
    expect(await fs.fileExists('../escape')).toBe(false);
});

for (const path of ['../escape', '/absolute', 'C:/file', 'folder\\file', 'a/../b', 'a//b', 'a/./b', 'a\0b']) {
    it(`rejects unsafe path ${JSON.stringify(path)}`, async () => {
        await expect(importZip(archive([manifest, { name: path, content: '' }]))).rejects.toThrow('path');
    });
}

it('rejects duplicates, normalization collisions, file/directory conflicts, links and encryption', async () => {
    for (const entries of [
        [manifest, manifest],
        [manifest, { name: 'café', content: '' }, { name: 'cafe\u0301', content: '' }],
        [manifest, { name: 'a', content: '' }, { name: 'a/file', content: '' }],
        [{ ...manifest, attributes: (0xa1ff << 16) >>> 0 }],
        [{ ...manifest, flags: 0x801 }],
    ]) await expect(importZip(archive(entries))).rejects.toThrow();
});

it('enforces declared and actual expansion limits before retaining output', async () => {
    await expect(importZip(archive([{ ...manifest, declaredSize: 101 * 1024 * 1024 }]))).rejects.toThrow('100 MiB');
    await expect(importZip(archive([{ ...manifest, content: 'A'.repeat(200_000), declaredSize: 2 }]))).rejects.toThrow('declared size');
});

it('rejects damaged, truncated, CRC-mismatched and unsupported ZIP64 archives', async () => {
    const bytes = zipFixture([{ ...manifest, stored: true }]);
    const corrupt = bytes.slice();
    const dataOffset = 30 + new TextEncoder().encode(manifest.name).length;
    corrupt[dataOffset] = corrupt[dataOffset]! ^ 1;
    await expect(importZip(new File([corrupt], 'bad.zip'))).rejects.toThrow('CRC-32');
    await expect(importZip(new File([bytes.slice(0, -1)], 'bad.zip'))).rejects.toThrow();
    const zip64 = bytes.slice();
    new DataView(zip64.buffer).setUint32(zip64.length - 6, 0xffffffff, true);
    await expect(importZip(new File([zip64], 'bad.zip'))).rejects.toThrow('ZIP64');
});

it('rejects packages without manifests and supports cancellation', async () => {
    await expect(importZip(archive([{ name: 'readme.txt', content: 'hi' }]))).rejects.toThrow('no .ograf.json');
    const controller = new AbortController();
    controller.abort();
    await expect(importZip(archive([manifest]), controller.signal)).rejects.toThrow();
});

it('rejects invalid central counts, unsupported methods and overlapping local records', async () => {
    const original = zipFixture([manifest, { name: 'second.ograf.json', content: '{}' }]);
    const base = new DataView(original.buffer);
    const central = base.getUint32(original.length - 6, true);
    for (const mutate of [
        (view: DataView) => view.setUint16(original.length - 12, 2_001, true),
        (view: DataView) => view.setUint16(central + 10, 99, true),
        (view: DataView) => view.setUint32(central + 46 + new TextEncoder().encode(manifest.name).length + 42, 0, true),
    ]) {
        const bytes = original.slice();
        mutate(new DataView(bytes.buffer));
        await expect(importZip(new File([bytes], 'bad.zip'))).rejects.toThrow();
    }
});

it('verifies the checksum against a known stored CRC-32 vector', async () => {
    const file = archive([{ ...manifest, content: '123456789', stored: true }]);
    const bytes = await file.arrayBuffer();
    expect(new DataView(bytes).getUint32(14, true)).toBe(0xcbf43926);
    expect(await new BrowserFS(await importZip(file)).readFile(manifest.name)).toBe('123456789');
});

it('stops between entries when cancelled and rejects oversized archives before reading them', async () => {
    const controller = new AbortController();
    await expect(importZip(archive([manifest, { name: 'second.ograf.json', content: '{}' }]), controller.signal,
        () => controller.abort())).rejects.toThrow();
    const file = archive([manifest]);
    Object.defineProperty(file, 'size', { value: 51 * 1024 * 1024 });
    Object.defineProperty(file, 'arrayBuffer', { value: () => { throw new Error('Must not read'); } });
    await expect(importZip(file)).rejects.toThrow('50 MiB');
});
