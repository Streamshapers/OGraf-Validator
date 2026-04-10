import { useState } from 'react';

interface Props {
    manifest: unknown;
}

export default function ManifestTab({ manifest }: Props) {
    return (
        <div className="rounded-md border border-ss-border bg-ss-dark-2 overflow-auto p-4 font-mono text-sm leading-relaxed">
            <JsonNode value={manifest} depth={0} />
        </div>
    );
}

interface NodeProps {
    value: unknown;
    depth: number;
    isLast?: boolean;
}

function JsonNode({ value, depth, isLast = true }: NodeProps) {
    if (value === null) return <span className="text-ss-text-2">null{!isLast && <Comma />}</span>;
    if (value === undefined) return <span className="text-ss-text-2">undefined{!isLast && <Comma />}</span>;
    if (typeof value === 'boolean') return <span className="text-ss-secondary">{String(value)}{!isLast && <Comma />}</span>;
    if (typeof value === 'number') return <span className="text-ss-primary">{value}{!isLast && <Comma />}</span>;
    if (typeof value === 'string') return <StringNode value={value} isLast={isLast} />;
    if (Array.isArray(value)) return <ArrayNode value={value} depth={depth} isLast={isLast} />;
    if (typeof value === 'object') return <ObjectNode value={value as Record<string, unknown>} depth={depth} isLast={isLast} />;

    return <span className="text-ss-text-2">{String(value)}{!isLast && <Comma />}</span>;
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

function ObjectNode({ value, depth, isLast }: { value: Record<string, unknown>; depth: number; isLast: boolean }) {
    const [expanded, setExpanded] = useState(depth < 2);
    const entries = Object.entries(value);

    if (entries.length === 0) return <span className="text-ss-text-2">{'{}'}{!isLast && <Comma />}</span>;

    if (!expanded) {
        return (
            <span>
                <ToggleButton expanded={false} onClick={() => setExpanded(true)} />
                <span className="text-ss-text-2">{'{'}</span>
                <span className="text-ss-text-2/60 cursor-pointer hover:text-ss-text-1 ml-1" onClick={() => setExpanded(true)}>
                    {entries.length} {entries.length === 1 ? 'key' : 'keys'}
                </span>
                <span className="text-ss-text-2">{'}'}</span>
                {!isLast && <Comma />}
            </span>
        );
    }

    return (
        <span>
            <ToggleButton expanded onClick={() => setExpanded(false)} />
            <span className="text-ss-text-2">{'{'}</span>
            <div className="pl-4">
                {entries.map(([key, val], i) => (
                    <div key={key}>
                        <span className="text-ss-text-1">"{key}"</span>
                        <span className="text-ss-text-2">: </span>
                        <JsonNode value={val} depth={depth + 1} isLast={i === entries.length - 1} />
                    </div>
                ))}
            </div>
            <span className="text-ss-text-2">{'}'}</span>
            {!isLast && <Comma />}
        </span>
    );
}

function ArrayNode({ value, depth, isLast }: { value: unknown[]; depth: number; isLast: boolean }) {
    const [expanded, setExpanded] = useState(depth < 2);

    if (value.length === 0) return <span className="text-ss-text-2">{'[]'}{!isLast && <Comma />}</span>;

    if (!expanded) {
        return (
            <span>
                <ToggleButton expanded={false} onClick={() => setExpanded(true)} />
                <span className="text-ss-text-2">{'['}</span>
                <span className="text-ss-text-2/60 cursor-pointer hover:text-ss-text-1 ml-1" onClick={() => setExpanded(true)}>
                    {value.length} {value.length === 1 ? 'item' : 'items'}
                </span>
                <span className="text-ss-text-2">{']'}</span>
                {!isLast && <Comma />}
            </span>
        );
    }

    return (
        <span>
            <ToggleButton expanded onClick={() => setExpanded(false)} />
            <span className="text-ss-text-2">{'['}</span>
            <div className="pl-4">
                {value.map((item, i) => (
                    <div key={i}>
                        <JsonNode value={item} depth={depth + 1} isLast={i === value.length - 1} />
                    </div>
                ))}
            </div>
            <span className="text-ss-text-2">{']'}</span>
            {!isLast && <Comma />}
        </span>
    );
}

function ToggleButton({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className="inline-flex items-center justify-center w-4 h-4 mr-0.5 text-ss-text-2 hover:text-ss-text-1 rounded transition-colors"
            aria-label={expanded ? 'Collapse' : 'Expand'}
        >
            <svg className={`h-2.5 w-2.5 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 6 10">
                <path d="M0 0l6 5-6 5V0z" />
            </svg>
        </button>
    );
}

function Comma() {
    return <span className="text-ss-text-2/50">,</span>;
}
