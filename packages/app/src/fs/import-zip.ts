import { createArchiveDirectory } from './archive-directory.js';

export const ZIP_LIMITS = { compressed: 50 * 1024 * 1024, expanded: 100 * 1024 * 1024,
    entries: 2_000, depth: 20, pathLength: 1024 } as const;

interface Entry { path: string; directory: boolean; method: number; crc: number; size: number; start: number; end: number }
const decoder = new TextDecoder('utf-8', { fatal: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
});

function crcUpdate(crc: number, bytes: Uint8Array): number {
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
    return crc;
}

function zipPath(path: string): { path: string; directory: boolean } {
    const directory = path.endsWith('/');
    const clean = (directory ? path.slice(0, -1) : path).normalize('NFC');
    const parts = clean.split('/');
    if (!clean || clean.length > ZIP_LIMITS.pathLength || parts.length > ZIP_LIMITS.depth
        || /[\\:]/.test(clean)
        || [...clean].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
        || parts.some((part) => !part || part === '.' || part === '..')) {
        throw new Error('ZIP contains an unsafe or unsupported path.');
    }
    return { path: clean, directory };
}

/** Classic ZIP central directory (PKWARE APPNOTE); fail closed on unsupported archive features. */
function entries(bytes: Uint8Array<ArrayBuffer>): Entry[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (offset: number) => view.getUint16(offset, true);
    const u32 = (offset: number) => view.getUint32(offset, true);
    let end = -1;
    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
        if (u32(offset) === 0x06054b50 && offset + 22 + u16(offset + 20) === bytes.length) { end = offset; break; }
    }
    if (end < 0) throw new Error('Not a complete ZIP archive.');
    const count = u16(end + 10);
    const centralStart = u32(end + 16);
    if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || count === 0xffff
        || centralStart === 0xffffffff || u32(end + 12) === 0xffffffff) {
        throw new Error('Split archives and ZIP64 are not supported.');
    }
    if (!count || count > ZIP_LIMITS.entries) throw new Error('ZIP must contain between 1 and 2,000 entries.');
    if (centralStart + u32(end + 12) !== end) throw new Error('Invalid ZIP directory bounds.');
    const result: Entry[] = [];
    const paths = new Map<string, boolean>();
    const ranges: [number, number][] = [];
    let offset = centralStart;
    let expanded = 0;
    for (let index = 0; index < count; index++) {
        if (offset + 46 > end || u32(offset) !== 0x02014b50) throw new Error('Invalid ZIP directory entry.');
        const flags = u16(offset + 8);
        const method = u16(offset + 10);
        if (flags & ~0x080e || (method !== 0 && method !== 8)) throw new Error('Only unencrypted stored or Deflate ZIP entries are supported.');
        const compressed = u32(offset + 20);
        const size = u32(offset + 24);
        const nameLength = u16(offset + 28);
        const extraLength = u16(offset + 30);
        const next = offset + 46 + nameLength + extraLength + u16(offset + 32);
        const local = u32(offset + 42);
        if (next > end || u16(offset + 34) || [compressed, size, local].includes(0xffffffff)) throw new Error('Invalid or unsupported ZIP64 entry.');
        // Symbolic links and other special Unix file types are never interpreted as package resources.
        const fileType = (u32(offset + 38) >>> 16) & 0xf000;
        if (fileType && fileType !== 0x8000 && fileType !== 0x4000) throw new Error('ZIP symbolic links and special files are not supported.');
        for (let extra = offset + 46 + nameLength; extra < offset + 46 + nameLength + extraLength;) {
            if (extra + 4 > offset + 46 + nameLength + extraLength) throw new Error('Invalid ZIP extra field.');
            if (u16(extra) === 1) throw new Error('ZIP64 entries are not supported.');
            extra += 4 + u16(extra + 2);
            if (extra > offset + 46 + nameLength + extraLength) throw new Error('Invalid ZIP extra field length.');
        }
        const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
        if (!(flags & 0x800) && nameBytes.some((byte) => byte > 127)) throw new Error('ZIP filenames must use UTF-8 or ASCII encoding.');
        const decoded = decoder.decode(nameBytes);
        const path = zipPath(decoded);
        if (paths.has(path.path)) throw new Error('ZIP contains duplicate paths.');
        paths.set(path.path, path.directory);
        expanded += size;
        if (expanded > ZIP_LIMITS.expanded) throw new Error('ZIP expanded size exceeds 100 MiB.');
        if (local + 30 > centralStart || u32(local) !== 0x04034b50
            || u16(local + 6) !== flags || u16(local + 8) !== method) throw new Error('ZIP local header does not match its directory.');
        const start = local + 30 + u16(local + 26) + u16(local + 28);
        if (start + compressed > centralStart || decoder.decode(bytes.subarray(local + 30, local + 30 + u16(local + 26))) !== decoded) {
            throw new Error('Invalid ZIP entry data or filename.');
        }
        if (!(flags & 8) && (u32(local + 14) !== u32(offset + 16) || u32(local + 18) !== compressed || u32(local + 22) !== size)) {
            throw new Error('ZIP entry sizes or checksum metadata disagree.');
        }
        if (path.directory && size !== 0) throw new Error('ZIP directory has file data.');
        ranges.push([local, start + compressed]);
        result.push({ ...path, method, crc: u32(offset + 16), size, start, end: start + compressed });
        offset = next;
    }
    if (offset !== end) throw new Error('ZIP directory length does not match entry count.');
    ranges.sort((a, b) => a[0] - b[0]);
    if (ranges.some((range, i) => i > 0 && range[0] < ranges[i - 1]![1])) throw new Error('ZIP contains overlapping entries.');
    for (const path of paths.keys()) {
        const parts = path.split('/');
        for (let depth = 1; depth < parts.length; depth++) {
            if (paths.get(parts.slice(0, depth).join('/')) === false) throw new Error('ZIP has conflicting file and directory paths.');
        }
    }
    return result;
}

export async function importZip(file: File, signal?: AbortSignal,
    onProgress?: (done: number, total: number) => void): Promise<FileSystemDirectoryHandle> {
    if (file.size > ZIP_LIMITS.compressed) throw new Error('ZIP size exceeds 50 MiB.');
    signal?.throwIfAborted();
    const bytes = new Uint8Array(await file.arrayBuffer());
    signal?.throwIfAborted();
    const archiveEntries = entries(bytes);
    const files = new Map<string, File>();
    for (const [index, entry] of archiveEntries.entries()) {
        signal?.throwIfAborted();
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let size = 0;
        let crc = 0xffffffff;
        const compressed = new Blob([bytes.subarray(entry.start, entry.end)]).stream();
        let stream: ReadableStream<Uint8Array<ArrayBuffer>>;
        try { stream = entry.method === 0 ? compressed : compressed.pipeThrough(new DecompressionStream('deflate-raw')); }
        catch { throw new Error('This browser cannot decompress Deflate ZIP files. Try a current browser or extract the ZIP and open its directory.'); }
        const reader = stream.getReader();
        const cancel = () => { void reader.cancel().catch(() => {}); };
        signal?.addEventListener('abort', cancel, { once: true });
        try {
            while (true) {
                signal?.throwIfAborted();
                const chunk = await reader.read();
                signal?.throwIfAborted();
                if (chunk.done) break;
                size += chunk.value.byteLength;
                if (size > entry.size) throw new Error('ZIP decompressed data exceeds its declared size.');
                crc = crcUpdate(crc, chunk.value);
                chunks.push(chunk.value);
            }
            if (size !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) throw new Error('ZIP entry failed size or CRC-32 verification.');
        } finally {
            signal?.removeEventListener('abort', cancel);
            await reader.cancel().catch(() => {});
            reader.releaseLock();
        }
        if (!entry.directory && !entry.path.split('/').some((part) => part === '__MACOSX' || part === '.DS_Store' || part.startsWith('._'))) {
            files.set(entry.path, new File(chunks, entry.path.split('/').at(-1)!, { lastModified: file.lastModified }));
        }
        onProgress?.(index + 1, archiveEntries.length);
    }
    if (![...files.keys()].some((path) => path.endsWith('.ograf.json'))) throw new Error('ZIP contains no .ograf.json manifests.');
    return createArchiveDirectory(file.name, files);
}
