/** Recursive validation of OGraf Graphics Data Definition schemas. */

import type { GddFieldType, ValidationIssue } from './types.js';
import { gddValueMatchesType, validateGddValue } from './gdd-value-validation.js';
import {
    GDD_FIELD_TYPES,
    GDD_SCHEMA_URL,
    MAX_GDD_DEPTH,
    err,
    warn,
    hasOwn,
    isFiniteNumber,
    isRecord,
} from './validation-utils.js';
import type { JsonObject } from './validation-utils.js';

export function validateGddRoot(value: unknown, path: string): ValidationIssue[] {
    if (!isRecord(value)) {
        return [err('INVALID_GDD', 'GDD schema must be an object.', path, GDD_SCHEMA_URL)];
    }

    const issues = validateGddField(value, path, new WeakSet<object>(), 0);
    if (value['type'] !== 'object') {
        issues.push(err('INVALID_GDD', 'GDD root type must be "object".', `${path}.type`, GDD_SCHEMA_URL));
    }
    if (!isRecord(value['properties'])) {
        issues.push(err('INVALID_GDD', 'GDD root requires a "properties" object.', `${path}.properties`, GDD_SCHEMA_URL));
    }

    return deduplicateIssues(issues);
}

function validateGddField(
    field: JsonObject,
    path: string,
    recursionStack: WeakSet<object>,
    depth: number,
): ValidationIssue[] {
    if (depth > MAX_GDD_DEPTH) {
        return [err('INVALID_GDD', 'GDD schema exceeds the supported nesting depth.', path, GDD_SCHEMA_URL)];
    }
    if (recursionStack.has(field)) {
        return [err('INVALID_GDD', 'GDD schema contains a cyclic object reference.', path, GDD_SCHEMA_URL)];
    }

    recursionStack.add(field);
    const issues: ValidationIssue[] = [];
    try {
        const type = field['type'];
        if (!hasOwn(field, 'type') || type === undefined) {
            issues.push(err('MISSING_FIELD', 'GDD field requires "type".', `${path}.type`, GDD_SCHEMA_URL));
        } else if (typeof type !== 'string' || !GDD_FIELD_TYPES.has(type as GddFieldType)) {
            issues.push(err('INVALID_GDD', 'GDD field has an unsupported "type".', `${path}.type`, GDD_SCHEMA_URL));
        }

        if (hasOwn(field, 'gddType') && field['gddType'] !== undefined && typeof field['gddType'] !== 'string') {
            issues.push(err('INVALID_GDD', 'GDD "gddType" must be a string.', `${path}.gddType`, GDD_SCHEMA_URL));
        }
        if (hasOwn(field, 'gddOptions') && field['gddOptions'] !== undefined && !isRecord(field['gddOptions'])) {
            issues.push(err('INVALID_GDD', 'GDD "gddOptions" must be an object.', `${path}.gddOptions`, GDD_SCHEMA_URL));
        }
        if (hasOwn(field, 'hidden') && field['hidden'] !== undefined && typeof field['hidden'] !== 'boolean') {
            issues.push(err('INVALID_GDD', 'GDD "hidden" must be a boolean.', `${path}.hidden`, GDD_SCHEMA_URL));
        }
        if (hasOwn(field, 'order') && field['order'] !== undefined && !isFiniteNumber(field['order'])) {
            issues.push(err('INVALID_GDD', 'GDD "order" must be a finite number.', `${path}.order`, GDD_SCHEMA_URL));
        }

        if (hasOwn(field, 'enum') && field['enum'] !== undefined) {
            if (!Array.isArray(field['enum'])) {
                issues.push(err('INVALID_GDD', 'GDD "enum" must be an array.', `${path}.enum`, GDD_SCHEMA_URL));
            } else if (field['enum'].length === 0 || hasDuplicateJsonValues(field['enum'])) {
                issues.push(err(
                    'INVALID_GDD',
                    'GDD "enum" must contain at least one unique value.',
                    `${path}.enum`,
                    GDD_SCHEMA_URL,
                ));
            }
        }
        if (hasOwn(field, 'required') && field['required'] !== undefined) {
            const required = field['required'];
            if (
                !Array.isArray(required)
                || required.some((entry) => typeof entry !== 'string')
                || new Set(required).size !== required.length
            ) {
                issues.push(err(
                    'INVALID_GDD',
                    'GDD "required" must be an array of unique strings.',
                    `${path}.required`,
                    GDD_SCHEMA_URL,
                ));
            }
        }

        if (typeof type === 'string' && GDD_FIELD_TYPES.has(type as GddFieldType) && hasOwn(field, 'default')) {
            issues.push(...validateGddDefault(field, `${path}.default`));
        }

        if (type === 'object') {
            if (!isRecord(field['properties'])) {
                issues.push(err(
                    'INVALID_GDD',
                    'Object GDD fields require a "properties" object.',
                    `${path}.properties`,
                    GDD_SCHEMA_URL,
                ));
            } else {
                for (const [name, child] of Object.entries(field['properties'])) {
                    const childPath = `${path}.properties.${name}`;
                    if (name.length === 0) {
                        issues.push(err('INVALID_GDD', 'GDD property names must not be empty.', childPath, GDD_SCHEMA_URL));
                    }
                    if (!isRecord(child)) {
                        issues.push(err('INVALID_GDD', `GDD field "${name}" must be an object.`, childPath, GDD_SCHEMA_URL));
                    } else {
                        issues.push(...validateGddField(child, childPath, recursionStack, depth + 1));
                    }
                }
            }
        }

        if (type === 'array') {
            if (!isRecord(field['items'])) {
                issues.push(err('INVALID_GDD', 'Array GDD fields require an "items" schema.', `${path}.items`, GDD_SCHEMA_URL));
            } else {
                issues.push(...validateGddField(field['items'], `${path}.items`, recursionStack, depth + 1));
            }
        }

        if (typeof field['gddType'] === 'string') {
            issues.push(...validateKnownGddType(field, path));
        }
    } finally {
        recursionStack.delete(field);
    }

    return issues;
}

function validateGddDefault(field: JsonObject, path: string): ValidationIssue[] {
    const value = field['default'];
    const type = field['type'] as GddFieldType;
    if (!gddValueMatchesType(value, type)) {
        return [err('INVALID_GDD', `GDD default value does not match type "${type}".`, path, GDD_SCHEMA_URL)];
    }
    const result = validateGddValue(field, value);
    if (result.status !== 'invalid') return [];
    return result.issues.map((issue) => warn(
        'GDD_DEFAULT_MISMATCH',
        `GDD default: ${issue.message} Correct this default before using it as Graphic data.`,
        `${path}${issue.path.slice(1)}`,
        GDD_SCHEMA_URL,
    ));
}

function hasDuplicateJsonValues(values: readonly unknown[]): boolean {
    const seen = new Set<string>();
    for (const value of values) {
        let serialized: string;
        try {
            serialized = `${typeof value}:${JSON.stringify(value) ?? String(value)}`;
        } catch {
            return true;
        }
        if (seen.has(serialized)) return true;
        seen.add(serialized);
    }
    return false;
}

function validateKnownGddType(field: JsonObject, path: string): ValidationIssue[] {
    const gddType = field['gddType'];
    if (typeof gddType !== 'string') return [];
    const issues: ValidationIssue[] = [];

    if (gddType === 'select') {
        if (!['string', 'number', 'integer'].includes(String(field['type']))) {
            issues.push(err('INVALID_GDD', 'GDD type "select" requires type string, number, or integer.', `${path}.type`, GDD_SCHEMA_URL));
        }
        issues.push(...validateSelectionOptions(field, path, false));
    } else if (gddType === 'select-multiple') {
        if (field['type'] !== 'array') {
            issues.push(err('INVALID_GDD', 'GDD type "select-multiple" requires type "array".', `${path}.type`, GDD_SCHEMA_URL));
        }
        issues.push(...validateSelectionOptions(field, path, true));
    } else if (['single-line', 'multi-line', 'file-path', 'file-path/image-path'].includes(gddType)) {
        if (field['type'] !== 'string') {
            issues.push(err('INVALID_GDD', `GDD type "${gddType}" requires type "string".`, `${path}.type`, GDD_SCHEMA_URL));
        }
        if ((gddType === 'file-path' || gddType === 'file-path/image-path') && isRecord(field['gddOptions'])) {
            const extensions = field['gddOptions']['extensions'];
            if (extensions !== undefined && (!Array.isArray(extensions) || extensions.some((entry) => typeof entry !== 'string'))) {
                issues.push(err(
                    'INVALID_GDD',
                    'File-path GDD "extensions" must be an array of strings.',
                    `${path}.gddOptions.extensions`,
                    GDD_SCHEMA_URL,
                ));
            }
        }
    } else if (gddType === 'color-rrggbb' || gddType === 'color-rrggbbaa') {
        const expected = gddType === 'color-rrggbb' ? '^#[0-9a-f]{6}$' : '^#[0-9a-f]{8}$';
        if (field['type'] !== 'string' || field['pattern'] !== expected) {
            issues.push(err(
                'INVALID_GDD',
                `GDD type "${gddType}" requires type "string" and pattern "${expected}".`,
                path,
                GDD_SCHEMA_URL,
            ));
        }
    } else if (gddType === 'percentage' && field['type'] !== 'number') {
        issues.push(err('INVALID_GDD', 'GDD type "percentage" requires type "number".', `${path}.type`, GDD_SCHEMA_URL));
    } else if (gddType === 'duration-ms' && field['type'] !== 'integer') {
        issues.push(err('INVALID_GDD', 'GDD type "duration-ms" requires type "integer".', `${path}.type`, GDD_SCHEMA_URL));
    }

    return issues;
}

function validateSelectionOptions(field: JsonObject, path: string, multiple: boolean): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const valueField = multiple && isRecord(field['items']) ? field['items'] : field;
    const selectionType = valueField['type'];
    const selectionEnum = valueField['enum'];

    if (multiple && (!isRecord(field['items']) || !['string', 'number', 'integer'].includes(String(selectionType)))) {
        issues.push(err(
            'INVALID_GDD',
            'GDD type "select-multiple" requires items with type string, number, or integer.',
            `${path}.items.type`,
            GDD_SCHEMA_URL,
        ));
    }
    if (!Array.isArray(selectionEnum)) {
        issues.push(err(
            'INVALID_GDD',
            `GDD type "${multiple ? 'select-multiple' : 'select'}" requires an enum array.`,
            multiple ? `${path}.items.enum` : `${path}.enum`,
            GDD_SCHEMA_URL,
        ));
    } else if (['string', 'number', 'integer'].includes(String(selectionType))) {
        for (let index = 0; index < selectionEnum.length; index += 1) {
            if (!selectionValueMatchesType(selectionEnum[index], selectionType)) {
                issues.push(err(
                    'INVALID_GDD',
                    `Selection value does not match type "${String(selectionType)}".`,
                    `${multiple ? `${path}.items` : path}.enum[${index}]`,
                    GDD_SCHEMA_URL,
                ));
            }
        }
    }

    if (!isRecord(field['gddOptions'])) {
        issues.push(err(
            'INVALID_GDD',
            `GDD type "${multiple ? 'select-multiple' : 'select'}" requires "gddOptions".`,
            `${path}.gddOptions`,
            GDD_SCHEMA_URL,
        ));
    } else if (!isRecord(field['gddOptions']['labels'])) {
        issues.push(err('INVALID_GDD', 'Selection "gddOptions.labels" must be an object.', `${path}.gddOptions.labels`, GDD_SCHEMA_URL));
    } else {
        for (const [key, label] of Object.entries(field['gddOptions']['labels'])) {
            if (typeof label !== 'string') {
                issues.push(err('INVALID_GDD', `Selection label "${key}" must be a string.`, `${path}.gddOptions.labels.${key}`, GDD_SCHEMA_URL));
            }
            if (selectionType === 'integer' && !/^[0-9]+$/.test(key)) {
                issues.push(err('INVALID_GDD', `Integer selection label key "${key}" must contain digits only.`, `${path}.gddOptions.labels.${key}`, GDD_SCHEMA_URL));
            } else if (selectionType === 'number' && !/^[0-9,.]+$/.test(key)) {
                issues.push(err('INVALID_GDD', `Number selection label key "${key}" has an invalid format.`, `${path}.gddOptions.labels.${key}`, GDD_SCHEMA_URL));
            }
        }
    }

    return issues;
}

function selectionValueMatchesType(value: unknown, type: unknown): boolean {
    if (type === 'string') return typeof value === 'string';
    if (type === 'number') return isFiniteNumber(value);
    if (type === 'integer') return isFiniteNumber(value) && Number.isInteger(value);
    return false;
}

function deduplicateIssues(issues: ValidationIssue[]): ValidationIssue[] {
    const seen = new Set<string>();
    return issues.filter((entry) => {
        const key = `${entry.code}|${entry.path ?? ''}|${entry.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
