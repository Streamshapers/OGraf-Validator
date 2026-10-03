import { expect, it, vi } from 'vitest';
import { fingerprintPackage, reportEnvironment } from '../report-context.js';

function filesystem(files: Record<string, string>) {
    return {
        listFiles: async () => Object.keys(files),
        getFileSize: async (path: string) => new TextEncoder().encode(files[path]!).byteLength,
        readArrayBuffer: async (path: string) => new TextEncoder().encode(files[path]!).buffer,
    };
}

it('hashes bytes and relative names deterministically regardless of directory enumeration order', async () => {
    const first = await fingerprintPackage(filesystem({ 'a.mjs': 'é', 'sub/b': '2' }));
    expect(first).toEqual(await fingerprintPackage(filesystem({ 'sub/b': '2', 'a.mjs': 'é' })));
    expect(first).toMatchObject({ status: 'available', algorithm: 'SHA-256', fileCount: 2, totalBytes: 3 });
    expect(first).not.toEqual(await fingerprintPackage(filesystem({ 'renamed.mjs': 'é', 'sub/b': '2' })));
    expect(first).not.toEqual(await fingerprintPackage(filesystem({ 'a.mjs': 'e', 'sub/b': '2' })));
    expect(first).not.toEqual(await fingerprintPackage(filesystem({ 'a.mjs': 'é' })));
});

it('reports failure and cancellation without manufacturing a fingerprint', async () => {
    const fs = filesystem({ 'main.mjs': 'source' });
    const controller = new AbortController();
    controller.abort();
    expect(await fingerprintPackage(fs, controller.signal)).toMatchObject({ status: 'unavailable' });
    fs.readArrayBuffer = vi.fn().mockRejectedValue(new Error('File changed'));
    expect(await fingerprintPackage(fs)).toEqual({ status: 'unavailable', reason: 'File changed' });
});

it('checks size limits before loading large files', async () => {
    const readArrayBuffer = vi.fn();
    expect(await fingerprintPackage({ ...filesystem({ 'large': '' }),
        getFileSize: async () => 101 * 1024 * 1024, readArrayBuffer,
    })).toMatchObject({ status: 'unavailable' });
    expect(readArrayBuffer).not.toHaveBeenCalled();
});

it('reports actual build versions and the pinned full EBU commit', () => {
    expect(reportEnvironment()).toMatchObject({ appVersion: '0.3.0', coreVersion: '0.3.0',
        specCommit: '8a74757bc4919fd898db1f562b14ad18fe22bc77' });
});

it('does not let an unreadable pending resource block runtime execution or cancellation', async () => {
    vi.useFakeTimers();
    try {
        const pending = fingerprintPackage({ ...filesystem({ slow: '' }),
            readArrayBuffer: () => new Promise(() => {}),
        });
        await vi.advanceTimersByTimeAsync(5_000);
        expect(await pending).toEqual({ status: 'unavailable', reason: 'Fingerprint capture exceeded five seconds.' });
        const controller = new AbortController();
        const cancelled = fingerprintPackage({ ...filesystem({ slow: '' }),
            listFiles: () => new Promise(() => {}),
        }, controller.signal);
        controller.abort();
        expect(await cancelled).toMatchObject({ status: 'unavailable' });
    } finally { vi.useRealTimers(); }
});
