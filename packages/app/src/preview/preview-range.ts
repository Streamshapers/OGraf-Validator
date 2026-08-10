export interface ByteRange {
    start: number;
    end: number;
}

/** Parse one RFC 9110 byte range. Multipart ranges are intentionally rejected. */
export function parseSingleByteRange(header: string, size: number): ByteRange | null {
    if (!Number.isSafeInteger(size) || size < 0 || !header.startsWith('bytes=') || header.includes(',')) {
        return null;
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match || (match[1] === '' && match[2] === '') || size === 0) return null;

    const startText = match[1];
    const endText = match[2];
    if (startText === undefined || endText === undefined) return null;

    if (startText === '') {
        const suffixLength = Number(endText);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
        return { start: Math.max(0, size - suffixLength), end: size - 1 };
    }

    const start = Number(startText);
    const requestedEnd = endText === '' ? size - 1 : Number(endText);
    if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(requestedEnd) ||
        start < 0 ||
        start >= size ||
        requestedEnd < start
    ) return null;

    return { start, end: Math.min(requestedEnd, size - 1) };
}
