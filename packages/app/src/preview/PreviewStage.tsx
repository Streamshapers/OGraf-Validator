import type { CSSProperties, RefObject } from 'react';
import type { PreviewBackground, PreviewPhase } from './preview-types.js';

interface Props {
    containerRef: RefObject<HTMLDivElement>;
    phase: PreviewPhase;
    error: string | null;
    background: PreviewBackground;
}

export default function PreviewStage({ containerRef, phase, error, background }: Props) {
    return (
        <div className="flex flex-col gap-2">
            <StatusBadge phase={phase} error={error} />
            <div
                className="relative rounded-md border border-ss-border overflow-hidden"
                style={{ aspectRatio: '16/9', minHeight: 180 }}
            >
                {/* Background layer — sits behind the graphic */}
                <div className="absolute inset-0" style={backgroundStyle(background)} />
                {/* Graphic layer */}
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
                    'repeating-conic-gradient(#808080 0% 25%, #555555 0% 50%) 0 0 / 20px 20px',
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

function StatusBadge({ phase, error }: { phase: PreviewPhase; error: string | null }) {
    const config: Record<PreviewPhase, { label: string; cls: string }> = {
        idle:      { label: 'Idle',       cls: 'text-ss-text-2' },
        importing: { label: 'Importing…', cls: 'text-ss-primary animate-pulse' },
        loading:   { label: 'Loading…',   cls: 'text-ss-primary animate-pulse' },
        loaded:    { label: 'Loaded',     cls: 'text-ss-success' },
        playing:   { label: 'Playing…',   cls: 'text-ss-success animate-pulse' },
        stopped:   { label: 'Stopped',    cls: 'text-ss-text-1' },
        disposed:  { label: 'Disposed',   cls: 'text-ss-text-2' },
        error:     { label: 'Error',      cls: 'text-ss-error' },
    };
    const { label, cls } = config[phase];

    return (
        <span className={`text-sm font-medium ${cls}`}>
            {label}
            {phase === 'error' && error && (
                <span className="ml-2 font-normal text-ss-error/80 text-xs">{error}</span>
            )}
        </span>
    );
}
