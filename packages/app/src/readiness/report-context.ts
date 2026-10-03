import type { BrowserFS } from '../fs/browser-fs.js';

declare const __APP_VERSION__: string;
declare const __CORE_VERSION__: string;
declare const __SPEC_COMMIT__: string;

export interface ReportEnvironment {
    appVersion: string;
    coreVersion: string;
    specCommit: string;
    browser: string;
    language: string;
}

export function reportEnvironment(): ReportEnvironment {
    return {
        appVersion: __APP_VERSION__, coreVersion: __CORE_VERSION__, specCommit: __SPEC_COMMIT__,
        browser: typeof navigator === 'undefined' ? 'unavailable' : navigator.userAgent,
        language: typeof navigator === 'undefined' ? 'unavailable' : navigator.language,
    };
}

export type PackageFingerprint =
    | { status: 'available'; algorithm: 'SHA-256'; digest: string; fileCount: number; totalBytes: number }
    | { status: 'unavailable'; reason: string };

export interface RuntimeReportContext {
    environment: ReturnType<typeof reportEnvironment>;
    manifestFilename: string;
    entryPoint: string;
    startedAt: string;
    finishedAt?: string;
    packageBefore: PackageFingerprint;
    packageAfter?: PackageFingerprint;
    packageComparison?: 'unchanged' | 'changed' | 'unavailable';
}

/** Hash sorted [relative path, byte length, SHA-256] tuples, never absolute paths or file contents. */
export async function fingerprintPackage(
    fs: Pick<BrowserFS, 'listFiles' | 'readArrayBuffer' | 'getFileSize'>,
    signal?: AbortSignal,
): Promise<PackageFingerprint> {
    const controller = new AbortController();
    const abort = () => controller.abort(new Error('Fingerprint capture was cancelled.'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => controller.abort(new Error('Fingerprint capture exceeded five seconds.')), 5_000);
    const interrupted = new Promise<never>((_resolve, reject) => {
        if (controller.signal.aborted) reject(controller.signal.reason);
        else controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
    });
    const calculate = async (): Promise<PackageFingerprint> => {
        controller.signal.throwIfAborted();
        const paths = (await fs.listFiles()).sort();
        if (paths.length > 2_000) throw new Error('Package exceeds the 2,000-file fingerprint limit.');
        let totalBytes = 0;
        const files: [string, number, string][] = [];
        for (const path of paths) {
            controller.signal.throwIfAborted();
            const size = await fs.getFileSize(path);
            if (totalBytes + size > 100 * 1024 * 1024) {
                throw new Error('Package exceeds the 100 MiB fingerprint limit.');
            }
            const bytes = await fs.readArrayBuffer(path);
            totalBytes += bytes.byteLength;
            if (totalBytes > 100 * 1024 * 1024) throw new Error('Package grew beyond the fingerprint limit.');
            files.push([path, bytes.byteLength, await sha256(bytes)]);
        }
        controller.signal.throwIfAborted();
        return { status: 'available', algorithm: 'SHA-256', fileCount: files.length, totalBytes,
            digest: await sha256(new TextEncoder().encode(JSON.stringify(files)).buffer) };
    };
    try {
        return await Promise.race([calculate(), interrupted]);
    } catch (error) {
        return { status: 'unavailable', reason: error instanceof Error ? error.message : 'Package could not be read.' };
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
