export type SchemaDefaultResult =
    | { ok: true; value: unknown }
    | { ok: false; reason: string };

const MAX_GENERATED_ARRAY_ITEMS = 1_000;
const MAX_GENERATION_NODES = 10_000;
const MAX_GENERATION_DEPTH = 64;

export class SchemaDefaultLimitError extends Error {
    constructor(path: string, limit: string) {
        super(`${path}: default generation exceeds the validator limit of ${limit}. ` +
            'This is a test-system limit, not an OGraf schema restriction.');
        this.name = 'SchemaDefaultLimitError';
    }
}

interface GenerationBudget {
    visited: number;
}

/** Build a custom-action payload using only explicit/default-composable values. */
export function buildSchemaDefaultValue(schema: unknown, path = '$'): SchemaDefaultResult {
    return buildDefaultValue(schema, path, { visited: 0 }, 0);
}

function buildDefaultValue(
    schema: unknown,
    path: string,
    budget: GenerationBudget,
    depth: number,
): SchemaDefaultResult {
    consumeBudget(budget, depth, path);
    if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
        return { ok: false, reason: `${path} has no usable schema.` };
    }
    const definition = schema as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(definition, 'default')) {
        return { ok: true, value: cloneValue(definition['default'], budget, depth, path) };
    }

    switch (definition['type']) {
        case 'object': {
            const properties = record(definition['properties']);
            const required = Array.isArray(definition['required'])
                ? definition['required'].filter((key): key is string => typeof key === 'string')
                : [];
            const result: Record<string, unknown> = {};
            for (const [key, childSchema] of Object.entries(properties)) {
                const child = buildDefaultValue(childSchema, `${path}.${key}`, budget, depth + 1);
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
            checkArraySize(minItems, path);
            const itemSchema = definition['items'];
            const item = buildDefaultValue(itemSchema, `${path}[0]`, budget, depth + 1);
            if (!item.ok) return item;
            return {
                ok: true,
                value: Array.from({ length: minItems }, (_, index) =>
                    cloneValue(item.value, budget, depth + 1, `${path}[${index}]`)),
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
    const result = collectDefaults(schema, { visited: 0 }, 0, '$');
    return result.hasValue ? result.value : undefined;
}

/** Create a type-correct value when the editor adds a new array item. */
export function buildSchemaEditorValue(schema: unknown): unknown {
    try {
        const defaults = collectDefaults(schema, { visited: 0 }, 0, '$');
        if (defaults.hasValue) return defaults.value;
    } catch (error) {
        if (!(error instanceof SchemaDefaultLimitError)) throw error;
        // The editor can still add an empty value for the user to fill manually.
    }
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

function collectDefaults(
    schema: unknown,
    budget: GenerationBudget,
    depth: number,
    path: string,
): CollectedDefault {
    consumeBudget(budget, depth, path);
    if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return { hasValue: false };
    const definition = schema as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(definition, 'default')) {
        return { hasValue: true, value: cloneValue(definition['default'], budget, depth, path) };
    }
    if (definition['type'] === 'object') {
        const value: Record<string, unknown> = {};
        for (const [key, childSchema] of Object.entries(record(definition['properties']))) {
            const child = collectDefaults(childSchema, budget, depth + 1, `${path}.${key}`);
            if (child.hasValue) value[key] = child.value;
        }
        return { hasValue: true, value };
    }
    if (definition['type'] === 'array') {
        const minItems = Number.isInteger(definition['minItems']) && (definition['minItems'] as number) > 0
            ? definition['minItems'] as number
            : 0;
        if (minItems === 0) return { hasValue: true, value: [] };
        checkArraySize(minItems, path);
        const item = collectDefaults(definition['items'], budget, depth + 1, `${path}[0]`);
        return item.hasValue
            ? { hasValue: true, value: Array.from({ length: minItems }, (_, index) =>
                cloneValue(item.value, budget, depth + 1, `${path}[${index}]`)) }
            : { hasValue: false };
    }
    return { hasValue: false };
}

function cloneValue(
    value: unknown,
    budget: GenerationBudget,
    depth: number,
    path: string,
): unknown {
    consumeBudget(budget, depth, path);
    if (Array.isArray(value)) {
        checkArraySize(value.length, path);

        return value.map((item, index) => cloneValue(item, budget, depth + 1, `${path}[${index}]`));
    }
    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [
            key, cloneValue(child, budget, depth + 1, `${path}.${key}`),
        ]));
    }

    return value;
}

function checkArraySize(length: number, path: string): void {
    if (length > MAX_GENERATED_ARRAY_ITEMS) {
        throw new SchemaDefaultLimitError(path, `${MAX_GENERATED_ARRAY_ITEMS} generated array items`);
    }
}

function consumeBudget(budget: GenerationBudget, depth: number, path: string): void {
    if (depth > MAX_GENERATION_DEPTH) {
        throw new SchemaDefaultLimitError(path, `${MAX_GENERATION_DEPTH} nested levels`);
    }
    budget.visited += 1;
    if (budget.visited > MAX_GENERATION_NODES) {
        throw new SchemaDefaultLimitError(path, `${MAX_GENERATION_NODES} inspected/generated values`);
    }
}

function record(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
