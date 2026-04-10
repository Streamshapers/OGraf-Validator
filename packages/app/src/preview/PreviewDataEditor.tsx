import { useEffect, useState } from 'react';
import type { GddField, GddSchema } from '@streamshapers/ograf-validator-core';

interface Props {
    schema: GddSchema | undefined;
    value: Record<string, unknown>;
    onChange: (next: Record<string, unknown>) => void;
    onReset: () => void;
}

export default function PreviewDataEditor({ schema, value, onChange, onReset }: Props) {
    const hasSchema = !!(schema && schema.properties && Object.keys(schema.properties).length > 0);

    return (
        <section className="rounded-md border border-ss-border overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-ss-dark-1 border-b border-ss-border">
                <span className="text-xs font-semibold uppercase tracking-wide text-ss-text-2">Data</span>
                <button
                    onClick={onReset}
                    className="text-xs text-ss-text-2 hover:text-ss-text-1 transition-colors"
                >
                    Reset to defaults
                </button>
            </div>
            <div className="p-3 space-y-3 bg-ss-dark-2/40">
                {hasSchema ? (
                    <GddForm
                        properties={schema!.properties}
                        value={value}
                        onChange={onChange}
                    />
                ) : (
                    <p className="text-xs text-ss-text-2 italic">
                        No GDD schema defined — edit the raw JSON below.
                    </p>
                )}
                <RawJsonEditor value={value} onChange={onChange} />
            </div>
        </section>
    );
}

// ─── GDD form ────────────────────────────────────────────────────────────────

interface GddFormProps {
    properties: Record<string, GddField>;
    value: Record<string, unknown>;
    onChange: (next: Record<string, unknown>) => void;
}

function GddForm({ properties, value, onChange }: GddFormProps) {
    const entries = Object.entries(properties);

    return (
        <div className="flex flex-col gap-2.5">
            {entries.map(([key, field]) => (
                <GddFormField
                    key={key}
                    name={key}
                    field={field}
                    value={value[key]}
                    onChange={(next) => onChange({ ...value, [key]: next })}
                />
            ))}
        </div>
    );
}

interface FieldProps {
    name: string;
    field: GddField;
    value: unknown;
    onChange: (next: unknown) => void;
}

function GddFormField({ name, field, value, onChange }: FieldProps) {
    const label = field.label ?? field.title ?? name;
    const component = determineComponent(field, value, onChange);

    return (
        <div className="flex flex-col gap-1">
            <label className="text-xs text-ss-text-2 font-mono flex items-baseline gap-2">
                <span className="text-ss-text-1">{label}</span>
                <span className="text-ss-text-2/60 text-[10px]">{fieldHint(field)}</span>
            </label>
            {component}
            {field.description && (
                <p className="text-[10px] text-ss-text-2/60">{field.description}</p>
            )}
        </div>
    );
}

/**
 * Graceful degradation per OGraf GDD guidance:
 * 1. Match specific gddType patterns (longest first)
 * 2. Fall back to basic JSON Schema type
 * 3. Fall back to text input
 */
function determineComponent(
    field: GddField,
    value: unknown,
    onChange: (next: unknown) => void,
): React.ReactNode {
    const gddType = (field.gddType ?? '').toLowerCase();

    // Enum / dropdown (validValues or enum)
    if (Array.isArray(field.validValues) && field.validValues.length > 0) {
        return <DropdownInput field={field} value={value} onChange={onChange} />;
    }
    if (gddType.includes('dropdown') || (Array.isArray(field.enum) && field.enum.length > 0)) {
        return <DropdownInput field={field} value={value} onChange={onChange} />;
    }

    // Specific gddType patterns (longest/most-specific first)
    if (gddType.includes('file-path/image-path')) return <TextInput value={value} onChange={onChange} placeholder="image path" />;
    if (gddType.includes('file-path'))            return <TextInput value={value} onChange={onChange} placeholder="file path" />;
    if (gddType.includes('rrggbb') || gddType.includes('color')) {
        return <ColorInput value={value} onChange={onChange} />;
    }
    if (gddType.includes('multi-line'))  return <TextAreaInput value={value} onChange={onChange} />;
    if (gddType.includes('single-line')) return <TextInput value={value} onChange={onChange} />;
    if (gddType.includes('date'))        return <BasicInput type="date" value={value} onChange={onChange} />;
    if (gddType.includes('url'))         return <BasicInput type="url" value={value} onChange={onChange} />;
    if (gddType.includes('email'))       return <BasicInput type="email" value={value} onChange={onChange} />;
    if (gddType.includes('number') || gddType.includes('integer')) {
        return <NumberInput field={field} value={value} onChange={onChange} />;
    }
    if (gddType.includes('checkbox') || gddType.includes('boolean')) {
        return <BooleanInput value={value} onChange={onChange} />;
    }

    // Fall back to basic JSON Schema types
    const type = Array.isArray(field.type) ? field.type[0] : field.type;
    switch (type) {
        case 'boolean':
            return <BooleanInput value={value} onChange={onChange} />;
        case 'number':
        case 'integer':
            return <NumberInput field={field} value={value} onChange={onChange} />;
        case 'array':
            return <ArrayInput field={field} value={value} onChange={onChange} />;
        case 'object':
            return <ObjectInput field={field} value={value} onChange={onChange} />;
        case 'null':
            return <span className="text-xs text-ss-text-2 italic">null</span>;
        case 'string':
        default:
            return <TextInput value={value} onChange={onChange} />;
    }
}

function fieldHint(field: GddField): string {
    const parts: string[] = [];
    if (field.gddType) parts.push(field.gddType);
    else if (field.type) parts.push(String(field.type));

    return parts.join(' · ');
}

// ─── Input primitives ────────────────────────────────────────────────────────

const INPUT_CLS =
    'w-full px-2 py-1 rounded text-xs bg-ss-dark-2 border border-ss-border text-ss-text-1 ' +
    'focus:outline-none focus:border-ss-primary transition-colors font-mono';

function TextInput({
    value,
    onChange,
    placeholder,
}: {
    value: unknown;
    onChange: (next: unknown) => void;
    placeholder?: string;
}) {
    return (
        <input
            type="text"
            className={INPUT_CLS}
            value={typeof value === 'string' ? value : value == null ? '' : String(value)}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
        />
    );
}

function TextAreaInput({
    value,
    onChange,
}: {
    value: unknown;
    onChange: (next: unknown) => void;
}) {
    return (
        <textarea
            rows={3}
            className={`${INPUT_CLS} resize-y`}
            value={typeof value === 'string' ? value : value == null ? '' : String(value)}
            onChange={(e) => onChange(e.target.value)}
        />
    );
}

function BasicInput({
    type,
    value,
    onChange,
}: {
    type: 'date' | 'url' | 'email';
    value: unknown;
    onChange: (next: unknown) => void;
}) {
    return (
        <input
            type={type}
            className={INPUT_CLS}
            value={typeof value === 'string' ? value : value == null ? '' : String(value)}
            onChange={(e) => onChange(e.target.value)}
        />
    );
}

function NumberInput({
    field,
    value,
    onChange,
}: {
    field: GddField;
    value: unknown;
    onChange: (next: unknown) => void;
}) {
    const isInteger = field.type === 'integer' || (field.gddType ?? '').toLowerCase().includes('integer');

    return (
        <input
            type="number"
            step={isInteger ? 1 : 'any'}
            className={INPUT_CLS}
            value={typeof value === 'number' ? value : value == null ? '' : String(value)}
            onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') {
                    onChange(undefined);

                    return;
                }
                const n = isInteger ? parseInt(raw, 10) : parseFloat(raw);
                onChange(Number.isNaN(n) ? undefined : n);
            }}
        />
    );
}

function BooleanInput({
    value,
    onChange,
}: {
    value: unknown;
    onChange: (next: unknown) => void;
}) {
    return (
        <label className="inline-flex items-center gap-2 text-xs text-ss-text-1">
            <input
                type="checkbox"
                checked={value === true}
                onChange={(e) => onChange(e.target.checked)}
                className="accent-ss-primary"
            />
            <span className="text-ss-text-2">{value === true ? 'true' : 'false'}</span>
        </label>
    );
}

function ColorInput({
    value,
    onChange,
}: {
    value: unknown;
    onChange: (next: unknown) => void;
}) {
    const str = typeof value === 'string' ? value : '#000000';
    const hex = /^#[0-9a-f]{6}$/i.test(str) ? str : `#${str.replace(/^#/, '').padEnd(6, '0').slice(0, 6)}`;

    return (
        <div className="flex items-center gap-2">
            <input
                type="color"
                value={hex}
                onChange={(e) => onChange(e.target.value)}
                className="h-7 w-10 rounded border border-ss-border bg-ss-dark-2 cursor-pointer"
            />
            <input
                type="text"
                className={`${INPUT_CLS} flex-1`}
                value={str}
                onChange={(e) => onChange(e.target.value)}
            />
        </div>
    );
}

function DropdownInput({
    field,
    value,
    onChange,
}: {
    field: GddField;
    value: unknown;
    onChange: (next: unknown) => void;
}) {
    const options: { value: unknown; label: string }[] = [];
    if (Array.isArray(field.validValues)) {
        for (const v of field.validValues) options.push({ value: v.value, label: v.label });
    } else if (Array.isArray(field.enum)) {
        for (const v of field.enum) options.push({ value: v, label: String(v) });
    }

    const selectedIdx = options.findIndex((o) => JSON.stringify(o.value) === JSON.stringify(value));

    return (
        <select
            className={INPUT_CLS}
            value={selectedIdx >= 0 ? String(selectedIdx) : ''}
            onChange={(e) => {
                const idx = parseInt(e.target.value, 10);
                if (!Number.isNaN(idx) && options[idx]) onChange(options[idx].value);
            }}
        >
            <option value="" disabled>(select…)</option>
            {options.map((opt, i) => (
                <option key={i} value={String(i)}>{opt.label}</option>
            ))}
        </select>
    );
}

function ObjectInput({
    field,
    value,
    onChange,
}: {
    field: GddField;
    value: unknown;
    onChange: (next: unknown) => void;
}) {
    const current = (typeof value === 'object' && value !== null && !Array.isArray(value))
        ? (value as Record<string, unknown>)
        : {};

    if (!field.properties || Object.keys(field.properties).length === 0) {
        return <RawJsonEditor value={current} onChange={onChange} />;
    }

    return (
        <fieldset className="border border-ss-border/60 rounded p-2 space-y-2">
            <GddForm
                properties={field.properties}
                value={current}
                onChange={(next) => onChange(next)}
            />
        </fieldset>
    );
}

function ArrayInput({
    field,
    value,
    onChange,
}: {
    field: GddField;
    value: unknown;
    onChange: (next: unknown) => void;
}) {
    const items = Array.isArray(value) ? value : [];

    if (!field.items) {
        return <RawJsonEditor value={items} onChange={onChange} />;
    }

    const itemSchema = field.items;

    return (
        <div className="space-y-2">
            {items.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2">
                    <div className="flex-1 border border-ss-border/60 rounded p-2">
                        <GddFormField
                            name={`[${idx}]`}
                            field={itemSchema}
                            value={item}
                            onChange={(next) => {
                                const copy = [...items];
                                copy[idx] = next;
                                onChange(copy);
                            }}
                        />
                    </div>
                    <button
                        onClick={() => onChange(items.filter((_, i) => i !== idx))}
                        className="text-xs text-ss-error hover:text-ss-error/70 px-1.5 py-0.5"
                        title="Remove"
                    >
                        ×
                    </button>
                </div>
            ))}
            <button
                onClick={() => onChange([...items, itemSchema.default ?? null])}
                className="text-xs text-ss-primary hover:text-ss-primary-dark"
            >
                + Add item
            </button>
        </div>
    );
}

// ─── Raw JSON editor (bottom escape hatch + fallback) ───────────────────────

function RawJsonEditor({
    value,
    onChange,
}: {
    value: unknown;
    onChange: (next: Record<string, unknown>) => void;
}) {
    const [text, setText] = useState(() => safeStringify(value));
    const [error, setError] = useState<string | null>(null);

    // Re-sync when external value changes (e.g. form edit)
    useEffect(() => {
        setText(safeStringify(value));
        setError(null);
    }, [value]);

    const handleChange = (next: string) => {
        setText(next);
        try {
            const parsed = JSON.parse(next);
            if (typeof parsed === 'object' && parsed !== null) {
                onChange(parsed as Record<string, unknown>);
                setError(null);
            } else {
                setError('JSON must be an object or array.');
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    return (
        <details className="text-xs">
            <summary className="cursor-pointer text-ss-text-2 hover:text-ss-text-1 select-none">
                Raw JSON
            </summary>
            <div className="mt-2 space-y-1">
                <textarea
                    rows={6}
                    value={text}
                    onChange={(e) => handleChange(e.target.value)}
                    className={`${INPUT_CLS} resize-y`}
                    spellCheck={false}
                />
                {error && <p className="text-ss-error text-[10px]">{error}</p>}
            </div>
        </details>
    );
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return '';
    }
}
