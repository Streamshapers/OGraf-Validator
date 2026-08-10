import type { GddField } from '@streamshapers/ograf-validator-core';
import { orderedGddTreeEntries } from '../gdd/gdd-utils.js';

interface GddFieldRow {
    name: string;
    type: string;
    gddType: string;
    label: string;
    defaultValue: string;
    order?: number;
    hidden: boolean;
    depth: number;
}

interface Props {
    manifest: unknown;
}

export default function GddTab({ manifest }: Props) {
    if (typeof manifest !== 'object' || manifest === null) return null;

    const m = manifest as Record<string, unknown>;
    const schema = m['schema'];

    if (schema === undefined || schema === null) {
        return (
            <EmptyState
                icon="ℹ"
                message="No GDD schema defined."
                hint='Add a "schema" field to your manifest to enable data validation and UI tooling support.'
            />
        );
    }

    if (typeof schema !== 'object' || Array.isArray(schema)) {
        return (
            <EmptyState
                icon="✕"
                message='"schema" is not a valid object.'
                hint='The "schema" field must be a JSON Schema object with type "object" and a "properties" key.'
            />
        );
    }

    const s = schema as Record<string, unknown>;
    const properties = s['properties'];

    if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
        return (
            <EmptyState
                icon="✕"
                message='"schema.properties" is missing or invalid.'
                hint="The GDD schema must have a &quot;properties&quot; object defining the graphic's data fields."
            />
        );
    }

    const props = properties as Record<string, GddField>;
    const rows: GddFieldRow[] = orderedGddTreeEntries(props).map(({ path, field: def, depth }) => {
        const field = (typeof def === 'object' && def !== null ? def : {}) as Record<string, unknown>;
        const order = field['order'];

        return {
            name: path,
            type: typeof field['type'] === 'string' ? field['type'] : '—',
            gddType: typeof field['gddType'] === 'string' ? field['gddType'] : '—',
            label: typeof field['label'] === 'string' ? field['label'] : (typeof field['title'] === 'string' ? field['title'] : '—'),
            defaultValue: field['default'] !== undefined ? JSON.stringify(field['default']) : '—',
            ...(typeof order === 'number' && Number.isFinite(order) ? { order } : {}),
            hidden: field['hidden'] === true,
            depth,
        };
    });

    if (rows.length === 0) {
        return <EmptyState icon="ℹ" message="GDD schema has no properties defined." />;
    }

    return (
        <>
            <div className="hidden xl:block overflow-x-auto rounded" style={{ border: '1px solid var(--ss-border-subtle)' }}>
            <table className="w-full min-w-[900px] text-xs">
                <thead>
                    <tr className="bg-ss-surface" style={{ borderBottom: '1px solid var(--ss-border-subtle)' }}>
                        <Th>Field Name</Th>
                        <Th>Type</Th>
                        <Th>Label</Th>
                        <Th>Default</Th>
                        <Th>GDDType</Th>
                        <Th>Metadata</Th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.name} className="hover:bg-ss-surface-highest transition-colors"
                            style={{ borderBottom: '1px solid rgba(64, 72, 80, 0.2)' }}>
                            <td className="px-3 py-2 font-mono text-ss-primary-container">
                                <span style={{ paddingLeft: `${row.depth * 12}px` }}>{row.name}</span>
                            </td>
                            <td className="px-3 py-2">
                                <TypeBadge type={row.type} />
                            </td>
                            <td className="px-3 py-2 text-ss-on-surface">{row.label}</td>
                            <td className="px-3 py-2 font-mono text-ss-success">{row.defaultValue}</td>
                            <td className="px-3 py-2">
                                {row.gddType !== '—' ? (
                                    <span className="px-1.5 py-0.5 rounded-full text-[10px] border font-mono"
                                          style={{ color: '#6abcef', background: '#6abcef18', borderColor: '#6abcef40' }}>
                                        {row.gddType}
                                    </span>
                                ) : (
                                    <span className="text-ss-on-surface-variant/40">—</span>
                                )}
                            </td>
                            <td className="px-3 py-2">
                                <div className="flex flex-wrap items-center gap-1">
                                    {row.order !== undefined && (
                                        <span className="rounded bg-ss-surface-high px-1.5 py-0.5 font-mono text-[10px] text-ss-on-surface-variant">
                                            order {row.order}
                                        </span>
                                    )}
                                    {row.hidden && (
                                        <span
                                            className="rounded border border-ss-outline-variant/40 bg-ss-surface-high px-1.5 py-0.5 text-[10px] text-ss-on-surface-variant"
                                            title="This field is not used in automatic Graphic labels. You can still edit it."
                                        >
                                            hidden from labels
                                        </span>
                                    )}
                                    {row.order === undefined && !row.hidden && (
                                        <span className="text-ss-on-surface-variant/40">—</span>
                                    )}
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            </div>
            <div className="flex flex-col gap-2 xl:hidden">
                {rows.map((row) => <GddFieldCard key={row.name} row={row} />)}
            </div>
        </>
    );
}

function GddFieldCard({ row }: { row: GddFieldRow }) {
    return (
        <article className="rounded bg-ss-surface px-3 py-3"
                 style={{ border: '1px solid var(--ss-border-subtle)' }}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <div className="min-w-0" style={{ paddingLeft: `${row.depth * 10}px` }}>
                    <code className="block text-xs font-semibold text-ss-primary-container [overflow-wrap:anywhere]">
                        {row.name}
                    </code>
                    {row.label !== '—' && (
                        <p className="mt-1 text-[11px] text-ss-on-surface">{row.label}</p>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                    <TypeBadge type={row.type} />
                    {row.gddType !== '—' && (
                        <span className="rounded-full border px-1.5 py-0.5 font-mono text-[10px] text-ss-primary-container border-ss-primary-container/30 bg-ss-primary-container/10">
                            {row.gddType}
                        </span>
                    )}
                </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="min-w-0">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-ss-on-surface-variant/60">Default</p>
                    <code className="mt-0.5 block text-[11px] text-ss-success [overflow-wrap:anywhere]">{row.defaultValue}</code>
                </div>
                <div className="min-w-0">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-ss-on-surface-variant/60">Metadata</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                        {row.order !== undefined && (
                            <span className="rounded bg-ss-surface-high px-1.5 py-0.5 font-mono text-[10px] text-ss-on-surface-variant">
                                order {row.order}
                            </span>
                        )}
                        {row.hidden && (
                            <span className="rounded border border-ss-outline-variant/40 bg-ss-surface-high px-1.5 py-0.5 text-[10px] text-ss-on-surface-variant">
                                hidden from labels
                            </span>
                        )}
                        {row.order === undefined && !row.hidden && (
                            <span className="text-[10px] text-ss-on-surface-variant/40">No metadata</span>
                        )}
                    </div>
                </div>
            </div>
        </article>
    );
}

function Th({ children }: { children: React.ReactNode }) {
    return (
        <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-ss-on-surface-variant">
            {children}
        </th>
    );
}

const TYPE_COLORS: Record<string, string> = {
    string:  '#4ba1e2',
    boolean: '#28af62',
    number:  '#e2b06f',
    object:  '#6abcef',
    array:   '#f9cc95',
};

function TypeBadge({ type }: { type: string }) {
    const color = TYPE_COLORS[type.toLowerCase()];

    if (color) {
        return (
            <span
                className="px-1.5 py-0.5 rounded-full text-[10px] border font-mono uppercase"
                style={{ color, background: `${color}18`, borderColor: `${color}40` }}
            >
                {type}
            </span>
        );
    }

    return (
        <span className="px-1.5 py-0.5 rounded-full text-[10px] border font-mono uppercase bg-ss-surface-highest text-ss-on-surface-variant border-ss-outline-variant/40">
            {type}
        </span>
    );
}

function EmptyState({ icon, message, hint }: { icon: string; message: string; hint?: string }) {
    return (
        <div className="rounded px-4 py-6 text-center" style={{ border: '1px solid var(--ss-border-subtle)' }}>
            <p className="text-2xl mb-2">{icon}</p>
            <p className="text-xs text-ss-on-surface-variant">{message}</p>
            {hint && <p className="text-[10px] text-ss-on-surface-variant/60 mt-1 max-w-sm mx-auto">{hint}</p>}
        </div>
    );
}
