/** Bounded, JSON-safe evidence. Paths mark undefined values replaced by null in the JSON view. */
export type ReportValue =
    | { type: 'json'; value: unknown; undefinedPaths?: (string | number)[][] }
    | { type: 'undefined' }
    | { type: 'unavailable'; reason: string };

const MAX_EVIDENCE_CHARACTERS = 100_000;
const MAX_EVIDENCE_NODES = 20_000;

export function captureReportValue(value: unknown): ReportValue {
    if (value === undefined) return { type: 'undefined' };
    const undefinedPaths: (string | number)[][] = [];
    const ancestors = new WeakSet<object>();
    let nodes = 0;
    let characters = 0;
    const visit = (item: unknown, path: (string | number)[]): unknown => {
        if (++nodes > MAX_EVIDENCE_NODES || path.length > 50) throw new Error('Evidence structure limit reached.');
        if (item === undefined) {
            undefinedPaths.push(path);
            return null;
        }
        if (item === null || typeof item === 'boolean') return item;
        if (typeof item === 'string') {
            characters += item.length;
            if (characters > MAX_EVIDENCE_CHARACTERS) throw new Error('Evidence text limit reached.');
            return item;
        }
        if (typeof item === 'number' && Number.isFinite(item)) return item;
        if (typeof item !== 'object') throw new Error('Value contains non-JSON data.');
        if (ancestors.has(item)) throw new Error('Value contains a circular reference.');
        if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype
            && Object.getPrototypeOf(item) !== null) throw new Error('Value contains a non-JSON object.');
        ancestors.add(item);
        const result = Array.isArray(item)
            ? Array.from(item, (child, index) => visit(child, [...path, index]))
            : Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child, [...path, key])]));
        ancestors.delete(item);
        return result;
    };
    try {
        const captured = visit(value, []);
        const json = JSON.stringify(captured);
        if (json.length > MAX_EVIDENCE_CHARACTERS) throw new Error('Evidence exceeds 100,000 characters.');
        return { type: 'json', value: captured, ...(undefinedPaths.length ? { undefinedPaths } : {}) };
    } catch (error) {
        return { type: 'unavailable', reason: error instanceof Error ? error.message : 'Evidence could not be captured.' };
    }
}
