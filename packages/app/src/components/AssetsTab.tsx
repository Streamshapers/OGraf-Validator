interface Props {
    assets: string[];
    manifest: unknown;
}

export default function AssetsTab({ assets, manifest }: Props) {
    const mainEntry =
        typeof manifest === 'object' && manifest !== null
            ? ((manifest as Record<string, unknown>)['main'] as string | undefined)
            : undefined;

    if (assets.length === 0) {
        return (
            <div className="rounded-md border border-ss-border px-4 py-6 text-center">
                <p className="text-sm text-ss-on-surface-variant">No files found in this package directory.</p>
            </div>
        );
    }

    // Sort: main entry first, then alphabetically
    const sorted = [...assets].sort((a, b) => {
        if (a === mainEntry) return -1;
        if (b === mainEntry) return 1;

        return a.localeCompare(b);
    });

    return (
        <div className="rounded-md border border-ss-border overflow-hidden">
            <div className="px-3 py-2 bg-ss-surface-high border-b border-ss-border flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-ss-on-surface-variant">
                    {assets.length} {assets.length === 1 ? 'file' : 'files'}
                </span>
            </div>
            <ul className="divide-y divide-ss-border/40">
                {sorted.map((file) => (
                    <FileRow key={file} path={file} isMain={file === mainEntry} />
                ))}
            </ul>
        </div>
    );
}

function FileRow({ path, isMain }: { path: string; isMain: boolean }) {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const icon = fileIcon(ext);

    return (
        <li className={`flex items-center gap-3 px-3 py-2 text-sm hover:bg-ss-surface-high/40 transition-colors ${isMain ? 'bg-ss-primary/10' : ''}`}>
            <span className="text-base w-5 text-center flex-shrink-0">{icon}</span>
            <span className={`flex-1 font-mono truncate ${isMain ? 'text-ss-primary-light' : 'text-ss-on-surface'}`} title={path}>
                {path}
            </span>
            {isMain && (
                <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-semibold bg-ss-primary/20 text-ss-primary-light border border-ss-primary/40">
                    main
                </span>
            )}
        </li>
    );
}

function fileIcon(ext: string): string {
    if (['mjs', 'js', 'ts'].includes(ext)) return '⚙';
    if (['html', 'htm'].includes(ext)) return '🌐';
    if (['css'].includes(ext)) return '🎨';
    if (['json'].includes(ext)) return '{ }';
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return '🖼';
    if (['woff', 'woff2', 'ttf', 'otf'].includes(ext)) return '🔤';
    if (['mp4', 'webm', 'mov'].includes(ext)) return '🎬';
    if (['mp3', 'wav', 'ogg'].includes(ext)) return '🔊';

    return '📄';
}
