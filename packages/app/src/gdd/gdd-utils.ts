import type { GddField } from '@streamshapers/ograf-validator-core';

export type KnownGddType =
    | 'single-line'
    | 'multi-line'
    | 'file-path'
    | 'file-path/image-path'
    | 'select'
    | 'select-multiple'
    | 'color-rrggbb'
    | 'color-rrggbbaa'
    | 'percentage'
    | 'duration-ms';

export interface SelectOption {
    value: string | number;
    label: string;
}

export interface OrderedGddTreeEntry {
    path: string;
    field: GddField;
    depth: number;
}

/**
 * Sort GDD properties according to the normative `order` rule while preserving
 * source order for ties and for properties without an explicit order.
 */
export function orderedGddEntries<T>(
    properties: Record<string, T>,
): [string, T][] {
    return Object.entries(properties)
        .map(([name, field], index) => ({
            name,
            field,
            index,
            order: readOrder((field as { order?: unknown }).order),
        }))
        .sort((a, b) => {
            if (a.order !== undefined && b.order !== undefined) {
                return a.order - b.order || a.index - b.index;
            }
            if (a.order !== undefined) return -1;
            if (b.order !== undefined) return 1;
            return a.index - b.index;
        })
        .map(({ name, field }) => [name, field]);
}

/** Flatten nested object/array properties while applying `order` per level. */
export function orderedGddTreeEntries(
    properties: Record<string, GddField>,
): OrderedGddTreeEntry[] {
    const result: OrderedGddTreeEntry[] = [];
    const stack = new WeakSet<object>();

    const visit = (current: Record<string, GddField>, prefix: string, depth: number): void => {
        if (stack.has(current)) return;
        stack.add(current);
        try {
            for (const [name, field] of orderedGddEntries(current)) {
                const path = prefix ? `${prefix}.${name}` : name;
                result.push({ path, field, depth });
                if (field.properties) visit(field.properties, path, depth + 1);
                if (field.items?.properties) visit(field.items.properties, `${path}[]`, depth + 1);
            }
        } finally {
            stack.delete(current);
        }
    };

    visit(properties, '', 0);
    return result;
}

/** Match only public, known GDD type names. Private types fall back to JSON Schema. */
export function getKnownGddType(field: GddField): KnownGddType | undefined {
    switch (field.gddType) {
        case 'single-line':
            return 'single-line';
        case 'multi-line':
            return 'multi-line';
        case 'file-path':
            return 'file-path';
        case 'file-path/image-path':
            return 'file-path/image-path';
        case 'select':
            return 'select';
        case 'select-multiple':
            return 'select-multiple';
        case 'color-rrggbb':
            return 'color-rrggbb';
        case 'color-rrggbbaa':
            return 'color-rrggbbaa';
        case 'percentage':
            return 'percentage';
        case 'duration-ms':
            return 'duration-ms';
        default:
            return undefined;
    }
}

export function getSelectMultipleOptions(field: GddField): SelectOption[] {
    if (getKnownGddType(field) !== 'select-multiple') return [];

    const values = field.items?.enum;
    if (!Array.isArray(values)) return [];

    const labels = (field as GddField & {
        gddOptions?: { labels?: Record<string, string> };
    }).gddOptions?.labels;

    return values.flatMap((value) => {
        if (typeof value !== 'string' && typeof value !== 'number') return [];
        const label = labels?.[String(value)];

        return [{ value, label: typeof label === 'string' ? label : String(value) }];
    });
}

function readOrder(order: unknown): number | undefined {
    return typeof order === 'number' && Number.isFinite(order) ? order : undefined;
}
