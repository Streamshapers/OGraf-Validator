interface GddFieldRow {
    name: string;
    type: string;
    gddType: string;
    label: string;
    defaultValue: string;
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

    const props = properties as Record<string, unknown>;
    const rows: GddFieldRow[] = Object.entries(props).map(([name, def]) => {
        const field = (typeof def === 'object' && def !== null ? def : {}) as Record<string, unknown>;

        return {
            name,
            type: typeof field['type'] === 'string' ? field['type'] : '—',
            gddType: typeof field['gddType'] === 'string' ? field['gddType'] : '—',
            label: typeof field['label'] === 'string' ? field['label'] : (typeof field['title'] === 'string' ? field['title'] : '—'),
            defaultValue: field['default'] !== undefined ? JSON.stringify(field['default']) : '—',
        };
    });

    if (rows.length === 0) {
        return <EmptyState icon="ℹ" message="GDD schema has no properties defined." />;
    }

    return (
        <div className="overflow-hidden rounded" style={{ border: '1px solid var(--ss-border-subtle)' }}>
            <table className="w-full text-xs">
                <thead>
                    <tr className="bg-ss-surface" style={{ borderBottom: '1px solid var(--ss-border-subtle)' }}>
                        <Th>Field Name</Th>
                        <Th>Type</Th>
                        <Th>Label</Th>
                        <Th>Default</Th>
                        <Th>GDDType</Th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.name} className="hover:bg-ss-surface-highest transition-colors"
                            style={{ borderBottom: '1px solid rgba(64, 72, 80, 0.2)' }}>
                            <td className="px-3 py-2 font-mono text-ss-primary-container">{row.name}</td>
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
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
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
