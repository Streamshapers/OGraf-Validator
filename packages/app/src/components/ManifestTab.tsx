import { manifestPointer, type ManifestLocation } from '../inspector/manifest-location.js';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';

interface Props {
    manifest: unknown;
    location?: ManifestLocation;
}

const LocationContext = createContext<ManifestLocation | undefined>(undefined);

export default function ManifestTab({ manifest, location }: Props) {
    const container = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!location) return;
        const target = container.current?.querySelector<HTMLElement>('[data-manifest-target="true"]');
        target?.scrollIntoView({ block: 'nearest' });
        target?.focus({ preventScroll: true });
    }, [location]);
    return (
        <LocationContext.Provider value={location}>
            {location && <p role="status" className="mb-2 text-xs text-ss-on-surface-variant [overflow-wrap:anywhere]">
                {location.exists ? 'Selected field: ' : 'Field not present; showing parent: '}{location.issuePath}
            </p>}
            <div ref={container} className="overflow-x-auto rounded-sm bg-ss-surface"
                 style={{ border: '1px solid var(--ss-border-subtle)' }}>
                <div className="min-w-max p-3 sm:p-4 font-mono text-xs leading-relaxed">
                    <div data-manifest-target={location?.pointer === '' ? 'true' : undefined} tabIndex={location?.pointer === '' ? -1 : undefined}>
                        <JsonNode value={manifest} depth={0} segments={[]} />
                    </div>
                </div>
            </div>
        </LocationContext.Provider>
    );
}

interface NodeProps {
    value: unknown;
    depth: number;
    segments: string[];
    isLast?: boolean;
}

function JsonNode({ value, depth, segments, isLast = true }: NodeProps) {
    if (value === null) return <span className="text-ss-on-surface-variant">null{!isLast && <Comma />}</span>;
    if (value === undefined) return <span className="text-ss-on-surface-variant">undefined{!isLast && <Comma />}</span>;
    if (typeof value === 'boolean') return <span className="text-ss-secondary">{String(value)}{!isLast && <Comma />}</span>;
    if (typeof value === 'number') return <span className="text-ss-primary">{value}{!isLast && <Comma />}</span>;
    if (typeof value === 'string') return <StringNode value={value} isLast={isLast} />;
    if (Array.isArray(value)) return <ArrayNode value={value} depth={depth} segments={segments} isLast={isLast} />;
    if (typeof value === 'object') return <ObjectNode value={value as Record<string, unknown>} depth={depth} segments={segments} isLast={isLast} />;

    return <span className="text-ss-on-surface-variant">{String(value)}{!isLast && <Comma />}</span>;
}

function StringNode({ value, isLast }: { value: string; isLast: boolean }) {
    const MAX_LEN = 120;
    const display = value.length > MAX_LEN ? value.slice(0, MAX_LEN) + '…' : value;

    return (
        <span className="text-ss-success" title={value.length > MAX_LEN ? value : undefined}>
            "{display}"{!isLast && <Comma />}
        </span>
    );
}

function ObjectNode({ value, depth, segments, isLast }: { value: Record<string, unknown>; depth: number; segments: string[]; isLast: boolean }) {
    const location = useContext(LocationContext);
    const onTargetPath = !!location && segments.every((part, index) => location.segments[index] === part);
    const [expanded, setExpanded] = useState(depth < 2 || onTargetPath);
    const entries = Object.entries(value);

    if (entries.length === 0) return <span className="text-ss-on-surface-variant">{'{}'}{!isLast && <Comma />}</span>;

    if (!expanded) {
        return (
            <span>
                <ToggleButton expanded={false} onClick={() => setExpanded(true)} />
                <span className="text-ss-on-surface-variant">{'{'}</span>
                <span className="text-ss-on-surface-variant/60 cursor-pointer hover:text-ss-on-surface ml-1" onClick={() => setExpanded(true)}>
                    {entries.length} {entries.length === 1 ? 'key' : 'keys'}
                </span>
                <span className="text-ss-on-surface-variant">{'}'}</span>
                {!isLast && <Comma />}
            </span>
        );
    }

    return (
        <span>
            <ToggleButton expanded onClick={() => setExpanded(false)} />
            <span className="text-ss-on-surface-variant">{'{'}</span>
            <div className="pl-4">
                {entries.map(([key, val], i) => (
                    <div key={key} data-manifest-target={location?.pointer === manifestPointer([...segments, key]) ? 'true' : undefined}
                        tabIndex={location?.pointer === manifestPointer([...segments, key]) ? -1 : undefined}
                        className={location?.pointer === manifestPointer([...segments, key]) ? 'bg-ss-primary/15 outline outline-1 outline-ss-primary rounded-sm' : undefined}>
                        <span className="text-ss-on-surface">"{key}"</span>
                        <span className="text-ss-on-surface-variant">: </span>
                        <JsonNode value={val} segments={[...segments, key]} depth={depth + 1} isLast={i === entries.length - 1} />
                    </div>
                ))}
            </div>
            <span className="text-ss-on-surface-variant">{'}'}</span>
            {!isLast && <Comma />}
        </span>
    );
}

function ArrayNode({ value, depth, segments, isLast }: { value: unknown[]; depth: number; segments: string[]; isLast: boolean }) {
    const location = useContext(LocationContext);
    const onTargetPath = !!location && segments.every((part, index) => location.segments[index] === part);
    const [expanded, setExpanded] = useState(depth < 2 || onTargetPath);

    if (value.length === 0) return <span className="text-ss-on-surface-variant">{'[]'}{!isLast && <Comma />}</span>;

    if (!expanded) {
        return (
            <span>
                <ToggleButton expanded={false} onClick={() => setExpanded(true)} />
                <span className="text-ss-on-surface-variant">{'['}</span>
                <span className="text-ss-on-surface-variant/60 cursor-pointer hover:text-ss-on-surface ml-1" onClick={() => setExpanded(true)}>
                    {value.length} {value.length === 1 ? 'item' : 'items'}
                </span>
                <span className="text-ss-on-surface-variant">{']'}</span>
                {!isLast && <Comma />}
            </span>
        );
    }

    return (
        <span>
            <ToggleButton expanded onClick={() => setExpanded(false)} />
            <span className="text-ss-on-surface-variant">{'['}</span>
            <div className="pl-4">
                {value.map((item, i) => (
                    <div key={i} data-manifest-target={location?.pointer === manifestPointer([...segments, String(i)]) ? 'true' : undefined}
                        tabIndex={location?.pointer === manifestPointer([...segments, String(i)]) ? -1 : undefined}
                        className={location?.pointer === manifestPointer([...segments, String(i)]) ? 'bg-ss-primary/15 outline outline-1 outline-ss-primary rounded-sm' : undefined}>
                        <JsonNode value={item} segments={[...segments, String(i)]} depth={depth + 1} isLast={i === value.length - 1} />
                    </div>
                ))}
            </div>
            <span className="text-ss-on-surface-variant">{']'}</span>
            {!isLast && <Comma />}
        </span>
    );
}

function ToggleButton({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className="inline-flex items-center justify-center w-4 h-4 mr-0.5 text-ss-on-surface-variant hover:text-ss-on-surface rounded-sm transition-colors"
            aria-label={expanded ? 'Collapse' : 'Expand'}
        >
            <ChevronRight size={10} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </button>
    );
}

function Comma() {
    return <span className="text-ss-on-surface-variant/50">,</span>;
}
