import { useState, useEffect } from 'react';
import { FileCode2, FileImage, FileType2, FileVideo, FileAudio, FileJson, File, Star } from 'lucide-react';
import ManifestTab from './ManifestTab.js';
import ManifestDiffPanel from './ManifestDiffPanel.js';
import GddTab from './GddTab.js';
import AssetsTab from './AssetsTab.js';

interface Props {
    manifest: unknown;
    previousManifest?: unknown;
    assets: string[];
    dirHandle: FileSystemDirectoryHandle;
}

export default function InspectTab({ manifest, previousManifest, assets, dirHandle }: Props) {
    return (
        <div className="flex h-full">
            {/* Column 1: Manifest JSON + Diff */}
            <div className="flex flex-col min-w-0 flex-1"
                 style={{ borderRight: '1px solid var(--ss-border-subtle)' }}>
                <ColumnHeader title="Manifest.json" />
                <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">
                    <ManifestTab manifest={manifest} />
                    {previousManifest !== undefined && previousManifest !== null && (
                        <ManifestDiffPanel previous={previousManifest} current={manifest} />
                    )}
                </div>
            </div>

            {/* Column 2: GDD Structure */}
            <div className="flex flex-col min-w-0 flex-[1.2]"
                 style={{ borderRight: '1px solid var(--ss-border-subtle)' }}>
                <ColumnHeader title="Properties" />
                <div className="flex-1 overflow-y-auto p-3">
                    <GddTab manifest={manifest} />
                </div>
            </div>

            {/* Column 3: Asset Library */}
            <div className="flex flex-col min-w-0 flex-1">
                <ColumnHeader title="Assets" />
                <div className="flex-1 overflow-y-auto p-3">
                    <AssetLibrary assets={assets} manifest={manifest} dirHandle={dirHandle} />
                </div>
            </div>
        </div>
    );
}

function ColumnHeader({ title, children }: { title: string; children?: React.ReactNode }) {
    return (
        <div className="flex-shrink-0 flex items-center justify-between px-3 h-10 bg-ss-surface"
             style={{ borderBottom: '1px solid var(--ss-border-subtle)' }}>
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ss-on-surface-variant">
                {title}
            </span>
            {children}
        </div>
    );
}

// ─── Asset Library with image preview ────────────────────────────────────────

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

function AssetLibrary({ assets, manifest, dirHandle }: { assets: string[]; manifest: unknown; dirHandle: FileSystemDirectoryHandle }) {
    const [previewAsset, setPreviewAsset] = useState<string | null>(null);

    const mainEntry =
        typeof manifest === 'object' && manifest !== null
            ? ((manifest as Record<string, unknown>)['main'] as string | undefined)
            : undefined;

    if (assets.length === 0) {
        return (
            <p className="text-xs text-ss-on-surface-variant py-4 text-center">
                No files found in this package directory.
            </p>
        );
    }

    const sorted = [...assets].sort((a, b) => {
        if (a === mainEntry) return -1;
        if (b === mainEntry) return 1;
        return a.localeCompare(b);
    });

    return (
        <div className="flex flex-col divide-y divide-ss-outline-variant/20">
            {sorted.map((file) => {
                const ext = file.split('.').pop()?.toLowerCase() ?? '';
                const isImage = IMAGE_EXTS.includes(ext);
                const isMain = file === mainEntry;
                const isPreviewing = previewAsset === file;
                const name = file.split('/').pop() ?? file;

                return (
                    <div key={file}>
                        <button
                            onClick={() => isImage ? setPreviewAsset(isPreviewing ? null : file) : undefined}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors
                                ${isPreviewing ? 'bg-ss-surface-high' : 'hover:bg-ss-surface-high/50'}
                                ${isImage ? 'cursor-pointer' : 'cursor-default'}
                            `}
                        >
                            {/* Large icon box */}
                            <div className="flex-shrink-0 w-9 h-9 rounded flex items-center justify-center text-ss-on-surface-variant">
                                <FileIcon ext={ext} size={18} />
                            </div>

                            {/* Name + size */}
                            <div className="flex-1 min-w-0">
                                <div className={`font-mono text-xs truncate ${isMain ? 'text-ss-primary-container' : 'text-ss-on-surface'}`}
                                     title={file}>
                                    {name}
                                </div>
                                <AssetSize file={file} dirHandle={dirHandle} />
                            </div>

                            {/* Ext badge + main star */}
                            <div className="flex-shrink-0 flex flex-col items-end gap-1">
                                <span className="px-1.5 py-px rounded text-[9px] font-bold tracking-widest uppercase font-mono bg-ss-surface-highest text-ss-on-surface-variant/60">
                                    {ext}
                                </span>
                                {isMain && <Star size={9} className="text-ss-primary-container" />}
                            </div>
                        </button>

                        {/* Inline image preview */}
                        {isPreviewing && (
                            <div className="mx-3 mb-2 rounded overflow-hidden"
                                 style={{ border: '1px solid var(--ss-border-subtle)' }}>
                                <div className="relative bg-[repeating-conic-gradient(#2a2a2a_0%_25%,#1a1a1a_0%_50%)] bg-[length:16px_16px]">
                                    <AssetImage file={file} name={name} dirHandle={dirHandle} />
                                    <span className="absolute bottom-1.5 right-1.5 text-[9px] font-mono text-white/70 bg-black/40 px-1.5 py-px rounded backdrop-blur-sm">
                                        Preview: {name}
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function AssetSize({ file, dirHandle }: { file: string; dirHandle: FileSystemDirectoryHandle }) {
    const [size, setSize] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            try {
                // file is a relative path like "bg.jpg" or "subdir/font.woff2"
                const parts = file.split('/');
                let dir: FileSystemDirectoryHandle = dirHandle;
                for (const part of parts.slice(0, -1)) {
                    dir = await dir.getDirectoryHandle(part);
                }
                const lastName = parts[parts.length - 1];
                if (!lastName) return;
                const fh = await dir.getFileHandle(lastName);
                const f = await fh.getFile();
                const kb = Math.round(f.size / 1024);
                setSize(kb < 1 ? '< 1 KB' : `${kb.toLocaleString()} KB`);
            } catch { /* file not accessible */ }
        }
        void load();
    }, [file, dirHandle]);

    if (!size) return null;
    return <div className="text-[10px] text-ss-on-surface-variant/60 font-mono mt-0.5">{size}</div>;
}

function AssetImage({ file, name, dirHandle }: { file: string; name: string; dirHandle: FileSystemDirectoryHandle }) {
    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        let url: string | null = null;
        async function load() {
            try {
                const parts = file.split('/');
                let dir: FileSystemDirectoryHandle = dirHandle;
                for (const part of parts.slice(0, -1)) {
                    dir = await dir.getDirectoryHandle(part);
                }
                const lastName = parts[parts.length - 1];
                if (!lastName) return;
                const fh = await dir.getFileHandle(lastName);
                const f = await fh.getFile();
                url = URL.createObjectURL(f);
                setObjectUrl(url);
            } catch {
                setError(true);
            }
        }
        void load();
        return () => { if (url) URL.revokeObjectURL(url); };
    }, [file, dirHandle]);

    if (error) return <div className="text-[10px] text-ss-on-surface-variant/60 text-center py-4">Preview not available</div>;
    if (!objectUrl) return <div className="h-16 flex items-center justify-center text-[10px] text-ss-on-surface-variant/40">Loading…</div>;
    return (
        <img
            src={objectUrl}
            alt={name}
            className="w-full object-contain max-h-52"
        />
    );
}

function extColor(ext: string): string {
    if (['mjs', 'js', 'ts'].includes(ext)) return '#e2b06f';
    if (['html', 'htm', 'css'].includes(ext)) return '#4ba1e2';
    if (['json'].includes(ext)) return '#6abcef';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return '#28af62';
    if (['woff', 'woff2', 'ttf', 'otf'].includes(ext)) return '#f9cc95';
    if (['mp4', 'webm', 'mov', 'mp3', 'wav', 'ogg'].includes(ext)) return '#cc5662';
    return '#888888';
}

function FileIcon({ ext, size = 16 }: { ext: string; size?: number }) {
    if (['mjs', 'js', 'ts'].includes(ext))
        return <FileCode2 size={size} color="#e2b06f" />;
    if (['html', 'htm', 'css'].includes(ext))
        return <FileCode2 size={size} color="#4ba1e2" />;
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext))
        return <FileImage size={size} color="#28af62" />;
    if (['woff', 'woff2', 'ttf', 'otf'].includes(ext))
        return <FileType2 size={size} color="#f9cc95" />;
    if (['mp4', 'webm', 'mov'].includes(ext))
        return <FileVideo size={size} color="#cc5662" />;
    if (['mp3', 'wav', 'ogg'].includes(ext))
        return <FileAudio size={size} color="#cc5662" />;
    if (['json'].includes(ext))
        return <FileJson size={size} color="#6abcef" />;
    return <File size={size} className="text-ss-on-surface-variant" />;
}
