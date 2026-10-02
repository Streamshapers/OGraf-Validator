/** Only official specification links are rendered from diagnostic metadata. */
export function safeSpecReference(value?: string): string | undefined {
    if (!value) return undefined;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password) return undefined;
        if (
            url.hostname === 'ograf.ebu.io'
            || url.hostname === 'json-schema.org'
            || (url.hostname === 'github.com' && url.pathname.startsWith('/ebu/ograf/'))
        ) return url.href;
    } catch {
        // A missing or malformed reference must not hide the diagnostic itself.
    }

    return undefined;
}
