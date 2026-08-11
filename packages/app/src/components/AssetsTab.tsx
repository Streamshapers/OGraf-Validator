import { useEffect, useMemo, useState } from 'react';
import {
    ExternalLink,
    File,
    FileAudio,
    FileCode2,
    FileImage,
    FileJson,
    FileType2,
    FileVideo,
    ImageOff,
    Star,
} from 'lucide-react';
import { readThumbnails, type InspectorThumbnail } from '../inspector/manifest-inspector.js';
import { getLocalFile } from '../inspector/local-files.js';

interface Props {
    assets: string[];
    manifest: unknown;
    dirHandle: FileSystemDirectoryHandle;
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

export default function AssetsTab({ assets, manifest, dirHandle }: Props) {
    const mainEntry = readString(manifest, 'main');
    const thumbnails = useMemo(() => readThumbnails(manifest), [manifest]);
    const thumbnailFiles = useMemo(
        () => new Set(thumbnails.filter((thumbnail) => !thumbnail.external).map((thumbnail) => thumbnail.file)),
        [thumbnails],
    );
    const [previewAsset, setPreviewAsset] = useState<string | null>(null);

    const sorted = useMemo(() => [...assets].sort((a, b) => {
        if (a === mainEntry) return -1;
        if (b === mainEntry) return 1;
        if (thumbnailFiles.has(a) && !thumbnailFiles.has(b)) return -1;
        if (!thumbnailFiles.has(a) && thumbnailFiles.has(b)) return 1;
        return a.localeCompare(b);
    }), [assets, mainEntry, thumbnailFiles]);

    return (
        <div className="flex flex-col gap-4">
            {thumbnails.length > 0 && (
                <ThumbnailGallery thumbnails={thumbnails} dirHandle={dirHandle} />
            )}

            <section>
                <SectionHeading>
                    {assets.length} {assets.length === 1 ? 'file' : 'files'}
                </SectionHeading>
                {assets.length === 0 ? (
                    <p className="py-4 text-center text-xs text-ss-on-surface-variant">
                        No files found in this Graphic directory.
                    </p>
                ) : (
                    <div className="flex flex-col divide-y divide-ss-outline-variant/20">
                        {sorted.map((file) => {
                            const extension = getExtension(file);
                            const isImage = IMAGE_EXTENSIONS.has(extension);
                            const isMain = file === mainEntry;
                            const isThumbnail = thumbnailFiles.has(file);
                            const isPreviewing = previewAsset === file;
                            const name = file.split('/').pop() ?? file;

                            return (
                                <div key={file}>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (isImage) setPreviewAsset(isPreviewing ? null : file);
                                        }}
                                        className={`w-full px-3 py-2.5 flex items-center gap-3 text-left transition-colors ${
                                            isPreviewing ? 'bg-ss-surface-high' : 'hover:bg-ss-surface-high/50'
                                        } ${isImage ? 'cursor-pointer' : 'cursor-default'}`}
                                    >
                                        <span className="w-9 h-9 shrink-0 rounded-sm flex items-center justify-center text-ss-on-surface-variant">
                                            <FileIcon extension={extension} />
                                        </span>
                                        <span className="flex-1 min-w-0">
                                            <span
                                                className={`block truncate font-mono text-xs ${isMain ? 'text-ss-primary-container' : 'text-ss-on-surface'}`}
                                                title={file}
                                            >
                                                {name}
                                            </span>
                                            <AssetSize file={file} dirHandle={dirHandle} />
                                        </span>
                                        <span className="shrink-0 flex flex-col items-end gap-1">
                                            <span className="flex items-center gap-1">
                                                {isThumbnail && <AssetBadge label="thumbnail" />}
                                                {isMain && <AssetBadge label="main" icon={<Star size={8} />} />}
                                            </span>
                                            <span className="px-1.5 py-px rounded-sm bg-ss-surface-highest text-[9px] font-bold tracking-widest uppercase font-mono text-ss-on-surface-variant/60">
                                                {extension || 'file'}
                                            </span>
                                        </span>
                                    </button>

                                    {isPreviewing && (
                                        <div className="mx-3 mb-2 overflow-hidden rounded-sm border border-ss-outline-variant/40">
                                            <div className="relative bg-[repeating-conic-gradient(#2a2a2a_0%_25%,#1a1a1a_0%_50%)] bg-[length:16px_16px]">
                                                <LocalAssetImage file={file} name={name} dirHandle={dirHandle} />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
}

function ThumbnailGallery({
    thumbnails,
    dirHandle,
}: {
    thumbnails: InspectorThumbnail[];
    dirHandle: FileSystemDirectoryHandle;
}) {
    return (
        <section>
            <SectionHeading>Thumbnails</SectionHeading>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {thumbnails.map((thumbnail, index) => (
                    <div
                        key={`${thumbnail.file}-${index}`}
                        className="min-w-0 overflow-hidden rounded-sm border border-ss-outline-variant/40 bg-ss-surface"
                    >
                        <div className="aspect-video flex items-center justify-center overflow-hidden bg-ss-surface-high">
                            {thumbnail.external ? (
                                <ExternalThumbnailPreview thumbnail={thumbnail} />
                            ) : (
                                <LocalAssetImage
                                    file={thumbnail.file}
                                    name={`Thumbnail ${index + 1}`}
                                    dirHandle={dirHandle}
                                    compact
                                />
                            )}
                        </div>
                        <div className="p-2 min-w-0">
                            <p className="truncate font-mono text-[10px] text-ss-on-surface" title={thumbnail.file}>
                                {thumbnail.file}
                            </p>
                            <div className="mt-1 flex items-center justify-between gap-2 text-[9px] text-ss-on-surface-variant">
                                <span>
                                    {thumbnail.resolution
                                        ? `${thumbnail.resolution.width} × ${thumbnail.resolution.height}`
                                        : 'Resolution not declared'}
                                </span>
                                {thumbnail.external && isHttpUrl(thumbnail.file) && (
                                    <a
                                        href={thumbnail.file}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-ss-primary-container hover:underline"
                                    >
                                        Open
                                    </a>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}

function ExternalThumbnailPreview({ thumbnail }: { thumbnail: InspectorThumbnail }) {
    const [loadRequested, setLoadRequested] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const canLoad = isLoadableExternalUrl(thumbnail.file);

    if (loadRequested && !loadFailed) {
        return (
            <img
                src={thumbnail.file}
                alt="External Graphic thumbnail"
                className="h-full w-full object-contain"
                onError={() => setLoadFailed(true)}
            />
        );
    }

    return (
        <div className="px-3 text-center text-ss-on-surface-variant">
            {loadFailed ? <ImageOff size={18} className="mx-auto mb-1" /> : <ExternalLink size={18} className="mx-auto mb-1" />}
            <p className="text-[10px]">
                {loadFailed ? 'Could not load this image' : 'External images are not loaded automatically'}
            </p>
            {canLoad && (
                <button
                    type="button"
                    onClick={() => {
                        setLoadFailed(false);
                        setLoadRequested(true);
                    }}
                    className="mt-1.5 rounded-sm bg-ss-surface-highest px-2 py-1 text-[10px] font-semibold text-ss-on-surface hover:text-ss-primary-container"
                >
                    {loadFailed ? 'Retry' : 'Load preview'}
                </button>
            )}
        </div>
    );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
    return (
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ss-on-surface-variant">
            {children}
        </h3>
    );
}

function AssetBadge({ label, icon }: { label: string; icon?: React.ReactNode }) {
    return (
        <span className="inline-flex items-center gap-1 rounded-sm border border-ss-primary/40 bg-ss-primary/10 px-1.5 py-px text-[9px] font-semibold text-ss-primary-container">
            {icon}{label}
        </span>
    );
}

function AssetSize({ file, dirHandle }: { file: string; dirHandle: FileSystemDirectoryHandle }) {
    const [size, setSize] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setSize(null);
        void getLocalFile(dirHandle, file)
            .then((asset) => {
                if (cancelled) return;
                const kb = Math.round(asset.size / 1024);
                setSize(kb < 1 ? '< 1 KB' : `${kb.toLocaleString()} KB`);
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, [file, dirHandle]);

    if (!size) return null;
    return <span className="block mt-0.5 font-mono text-[10px] text-ss-on-surface-variant/60">{size}</span>;
}

function LocalAssetImage({
    file,
    name,
    dirHandle,
    compact = false,
}: {
    file: string;
    name: string;
    dirHandle: FileSystemDirectoryHandle;
    compact?: boolean;
}) {
    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        let cancelled = false;
        let url: string | null = null;
        setObjectUrl(null);
        setError(false);

        void getLocalFile(dirHandle, file)
            .then((asset) => {
                if (cancelled) return;
                url = URL.createObjectURL(asset);
                setObjectUrl(url);
            })
            .catch(() => {
                if (!cancelled) setError(true);
            });

        return () => {
            cancelled = true;
            if (url) URL.revokeObjectURL(url);
        };
    }, [file, dirHandle]);

    if (error) {
        return (
            <div className="py-4 text-center text-[10px] text-ss-on-surface-variant/60">
                <ImageOff size={16} className="mx-auto mb-1" />
                Preview not available
            </div>
        );
    }
    if (!objectUrl) {
        return <div className="h-full min-h-16 flex items-center justify-center text-[10px] text-ss-on-surface-variant/40">Loading…</div>;
    }

    return (
        <img
            src={objectUrl}
            alt={name}
            className={`w-full object-contain ${compact ? 'h-full' : 'max-h-52'}`}
        />
    );
}

function readString(manifest: unknown, key: string): string | undefined {
    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) return undefined;
    const value = (manifest as Record<string, unknown>)[key];

    return typeof value === 'string' ? value : undefined;
}

function getExtension(path: string): string {
    return path.split('.').pop()?.toLowerCase() ?? '';
}

function isHttpUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
}

function isLoadableExternalUrl(value: string): boolean {
    return isHttpUrl(value) || value.startsWith('/');
}

function FileIcon({ extension }: { extension: string }) {
    if (['mjs', 'js', 'ts'].includes(extension)) return <FileCode2 size={18} className="text-ss-warning" />;
    if (['html', 'htm', 'css'].includes(extension)) return <FileCode2 size={18} className="text-ss-primary-container" />;
    if (IMAGE_EXTENSIONS.has(extension)) return <FileImage size={18} className="text-ss-success" />;
    if (['woff', 'woff2', 'ttf', 'otf'].includes(extension)) return <FileType2 size={18} className="text-ss-secondary" />;
    if (['mp4', 'webm', 'mov'].includes(extension)) return <FileVideo size={18} className="text-ss-error" />;
    if (['mp3', 'wav', 'ogg'].includes(extension)) return <FileAudio size={18} className="text-ss-error" />;
    if (extension === 'json') return <FileJson size={18} className="text-ss-primary-container" />;
    return <File size={18} className="text-ss-on-surface-variant" />;
}
