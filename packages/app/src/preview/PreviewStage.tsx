import type { CSSProperties, RefObject } from 'react';
import type { PreviewBackground, PreviewPhase } from './preview-types.js';

interface Props {
    containerRef: RefObject<HTMLDivElement | null>;
    background: PreviewBackground;
    width: number;
    height: number;
}

export default function PreviewStage({ containerRef, background, width, height }: Props) {
    return (
        <div className="flex flex-col items-stretch overflow-auto p-4 gap-2">
            {/* Canvas: respects configured aspect ratio, scales to container width */}
            <div
                className="relative w-full overflow-hidden rounded-sm"
                style={{
                    aspectRatio: `${width} / ${height}`,
                    ...backgroundStyle(background),
                }}
            >
                <div ref={containerRef} className="absolute inset-0" />
            </div>
        </div>
    );
}

function backgroundStyle(bg: PreviewBackground): CSSProperties {
    switch (bg.type) {
        case 'checker':
            return {
                background:
                    'repeating-conic-gradient(#2a2a2a 0% 25%, #1a1a1a 0% 50%) 0 0 / 20px 20px',
            };
        case 'color':
            return { backgroundColor: bg.value };
        case 'image':
            return {
                backgroundImage: `url(${bg.dataUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
            };
    }
}

export function StatusBadge({ phase, error }: { phase: PreviewPhase; error: string | null }) {
    const config: Record<PreviewPhase, { label: string; cls: string }> = {
        idle:      { label: 'IDLE',       cls: 'text-ss-on-surface-variant bg-ss-surface/80' },
        importing: { label: 'IMPORTING…', cls: 'text-ss-primary bg-ss-surface/80 animate-pulse' },
        loading:   { label: 'LOADING…',   cls: 'text-ss-primary bg-ss-surface/80 animate-pulse' },
        loaded:    { label: 'LOADED',     cls: 'text-ss-success bg-ss-surface/80' },
        playing:   { label: '● PLAYING',  cls: 'text-ss-success bg-ss-success/15' },
        stopped:   { label: 'STOPPED',    cls: 'text-ss-on-surface bg-ss-surface/80' },
        disposed:  { label: 'DISPOSED',   cls: 'text-ss-on-surface-variant bg-ss-surface/80' },
        error:     { label: 'ERROR',      cls: 'text-ss-error bg-ss-error/15' },
    };
    const { label, cls } = config[phase];

    return (
        <span className={`inline-flex items-center gap-1 px-2 py-px rounded-sm text-[10px] font-semibold font-mono tracking-wide backdrop-blur-xs ${cls}`}
              style={{ border: '1px solid var(--ss-border-subtle)' }}>
            {label}
            {phase === 'error' && error && (
                <span className="ml-1 font-normal text-ss-error/80">{error}</span>
            )}
        </span>
    );
}
