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
        <div className="rounded-md border border-ss-border overflow-hidden">
            <table className="w-full text-sm">
                <thead>
                    <tr className="bg-ss-dark-1 border-b border-ss-border">
                        <Th>Field</Th>
                        <Th>Type</Th>
                        <Th>gddType</Th>
                        <Th>Label</Th>
                        <Th>Default</Th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-ss-border/40">
                    {rows.map((row) => (
                        <tr key={row.name} className="hover:bg-ss-dark-1/40 transition-colors">
                            <td className="px-3 py-2 font-mono text-ss-primary-light">{row.name}</td>
                            <td className="px-3 py-2 text-ss-text-2">{row.type}</td>
                            <td className="px-3 py-2">
                                {row.gddType !== '—' ? (
                                    <span className="px-1.5 py-0.5 rounded text-xs bg-purple-950 text-purple-300 border border-purple-800 font-mono">
                                        {row.gddType}
                                    </span>
                                ) : (
                                    <span className="text-ss-text-2/50">—</span>
                                )}
                            </td>
                            <td className="px-3 py-2 text-ss-text-1">{row.label}</td>
                            <td className="px-3 py-2 font-mono text-ss-success text-xs">{row.defaultValue}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function Th({ children }: { children: React.ReactNode }) {
    return (
        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ss-text-2">
            {children}
        </th>
    );
}

function EmptyState({ icon, message, hint }: { icon: string; message: string; hint?: string }) {
    return (
        <div className="rounded-md border border-ss-border px-4 py-6 text-center">
            <p className="text-2xl mb-2">{icon}</p>
            <p className="text-sm text-ss-text-2">{message}</p>
            {hint && <p className="text-xs text-ss-text-2/60 mt-1 max-w-sm mx-auto">{hint}</p>}
        </div>
    );
}
