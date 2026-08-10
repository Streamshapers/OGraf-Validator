export type SchemaDefaultResult =
    | { ok: true; value: unknown }
    | { ok: false; reason: string };

/** Build a custom-action payload using only explicit/default-composable values. */
export function buildSchemaDefaultValue(schema: unknown, path = '$'): SchemaDefaultResult {
    if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
        return { ok: false, reason: `${path} has no usable schema.` };
    }
    const definition = schema as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(definition, 'default')) {
        return { ok: true, value: cloneValue(definition['default']) };
    }

    switch (definition['type']) {
        case 'object': {
            const properties = record(definition['properties']);
            const required = Array.isArray(definition['required'])
                ? definition['required'].filter((key): key is string => typeof key === 'string')
                : [];
            const result: Record<string, unknown> = {};
            for (const [key, childSchema] of Object.entries(properties)) {
                const child = buildSchemaDefaultValue(childSchema, `${path}.${key}`);
                if (child.ok) result[key] = child.value;
                else if (required.includes(key)) return child;
            }
            const unknownRequired = required.find((key) => !Object.prototype.hasOwnProperty.call(properties, key));
            if (unknownRequired) {
                return { ok: false, reason: `${path}.${unknownRequired} is required but has no schema/default.` };
            }
            return { ok: true, value: result };
        }
        case 'array': {
            const minItems = Number.isInteger(definition['minItems']) && (definition['minItems'] as number) > 0
                ? definition['minItems'] as number
                : 0;
            if (minItems === 0) return { ok: true, value: [] };
            const itemSchema = definition['items'];
            const item = buildSchemaDefaultValue(itemSchema, `${path}[0]`);
            if (!item.ok) return item;
            return {
                ok: true,
                value: Array.from({ length: minItems }, () => cloneValue(item.value)),
            };
        }
        case 'string':
        case 'number':
        case 'integer':
        case 'boolean':
            return { ok: false, reason: `${path} has no default value.` };
        default:
            return { ok: false, reason: `${path} has no supported type/default.` };
    }
}

/** Compose explicit defaults recursively for preview/load data. */
export function buildSchemaDefaultsValue(schema: unknown): unknown {
    const result = collectDefaults(schema);
    return result.hasValue ? result.value : undefined;
}

/** Create a type-correct value when the editor adds a new array item. */
export function buildSchemaEditorValue(schema: unknown): unknown {
    const defaults = collectDefaults(schema);
    if (defaults.hasValue) return cloneValue(defaults.value);
    const definition = record(schema);
    switch (definition['type']) {
        case 'string': return '';
        case 'number':
        case 'integer': return 0;
        case 'boolean': return false;
        case 'array': return [];
        case 'object': return {};
        default: return null;
    }
}

type CollectedDefault = { hasValue: true; value: unknown } | { hasValue: false };

function collectDefaults(schema: unknown): CollectedDefault {
    if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return { hasValue: false };
    const definition = schema as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(definition, 'default')) {
        return { hasValue: true, value: cloneValue(definition['default']) };
    }
    if (definition['type'] === 'object') {
        const value: Record<string, unknown> = {};
        for (const [key, childSchema] of Object.entries(record(definition['properties']))) {
            const child = collectDefaults(childSchema);
            if (child.hasValue) value[key] = child.value;
        }
        return { hasValue: true, value };
    }
    if (definition['type'] === 'array') {
        const minItems = Number.isInteger(definition['minItems']) && (definition['minItems'] as number) > 0
            ? definition['minItems'] as number
            : 0;
        if (minItems === 0) return { hasValue: true, value: [] };
        const item = collectDefaults(definition['items']);
        return item.hasValue
            ? { hasValue: true, value: Array.from({ length: minItems }, () => cloneValue(item.value)) }
            : { hasValue: false };
    }
    return { hasValue: false };
}

function cloneValue(value: unknown): unknown {
    if (typeof structuredClone === 'function') return structuredClone(value);
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value)) as unknown;
}

function record(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
