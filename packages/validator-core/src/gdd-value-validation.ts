/** A bounded, dependency-free checker for values supplied to OGraf GDD schemas. */

import type { GddFieldType, GddValueIssue, GddValueValidationResult } from './types.js';
import { GDD_FIELD_TYPES, MAX_GDD_DEPTH, hasOwn, isFiniteNumber, isRecord } from './validation-utils.js';
import type { JsonObject } from './validation-utils.js';

// Unknown extension keys are annotations. Only recognized, unevaluated assertions
// prevent a positive result; this checker does not claim full JSON Schema support.
const UNSUPPORTED_ASSERTIONS = new Set([
    '$ref', '$dynamicRef', '$recursiveRef', 'const', 'allOf', 'anyOf', 'oneOf', 'not',
    'if', 'then', 'else', 'contains', 'minContains', 'maxContains', 'prefixItems',
    'additionalItems', 'unevaluatedItems', 'unevaluatedProperties', 'propertyNames',
    'dependentRequired', 'dependentSchemas', 'dependencies', 'minProperties', 'maxProperties',
]);

/**
 * Check data without applying defaults, coercing values, or resolving references.
 * Validate the enclosing manifest first; this is not a GDD meta-schema validator.
 */
export function validateGddValue(schema: unknown, value: unknown): GddValueValidationResult {
    try {
        const unsupported = inspectSupportedSchema(schema, '$', new WeakSet<object>(), 0);
        const issues = isRecord(schema)
            ? validateValueAgainstSchema(value, schema, '$', new WeakSet<object>(), 0)
            : [];
        if (issues.length > 0) return { status: 'invalid', issues };
        if (unsupported.length > 0) return { status: 'unsupported', issues: unsupported };
        return { status: 'valid', issues: [] };
    } catch {
        return { status: 'unsupported', issues: [
            valueIssue('Schema or value could not be inspected safely.', '$'),
        ] };
    }
}

function valueIssue(message: string, path: string): GddValueIssue {
    return { path, message };
}

function inspectSupportedSchema(
    value: unknown,
    path: string,
    stack: WeakSet<object>,
    depth: number,
): GddValueIssue[] {
    if (!isRecord(value)) return [valueIssue('A GDD schema object is required.', path)];
    if (depth > MAX_GDD_DEPTH || stack.has(value)) {
        return [valueIssue('Schema exceeds supported depth or contains a cycle.', path)];
    }
    const issues: GddValueIssue[] = [];
    const type = value['type'];
    if (typeof type !== 'string' || !GDD_FIELD_TYPES.has(type as GddFieldType)) {
        issues.push(valueIssue('Schema requires a supported GDD type.', path));
    }
    issues.push(...inspectAssertionTypes(value, path));
    for (const keyword of Object.keys(value)) {
        if (UNSUPPORTED_ASSERTIONS.has(keyword)) {
            issues.push(valueIssue(`Assertion "${keyword}" is not supported by this data check.`, path));
        }
    }
    if (typeof value['pattern'] === 'string') {
        try { new RegExp(value['pattern'], 'u'); }
        catch { issues.push(valueIssue('Schema contains an unsupported regular expression.', path)); }
    }
    stack.add(value);
    try {
        for (const keyword of ['properties', 'patternProperties']) {
            const properties = value[keyword];
            if (!isRecord(properties)) continue;
            for (const [property, child] of Object.entries(properties)) {
                const childPath = keyword === 'properties' ? appendValuePropertyPath(path, property) : path;
                if (keyword === 'patternProperties') {
                    try { new RegExp(property, 'u'); }
                    catch { issues.push(valueIssue('Schema contains an unsupported property pattern.', path)); }
                }
                issues.push(...inspectSupportedSchema(child, childPath, stack, depth + 1));
            }
        }
        if (value['items'] !== undefined) {
            issues.push(...inspectSupportedSchema(value['items'], path, stack, depth + 1));
        }
        if (isRecord(value['additionalProperties'])) {
            issues.push(...inspectSupportedSchema(value['additionalProperties'], path, stack, depth + 1));
        }
    } finally {
        stack.delete(value);
    }
    return issues;
}

function inspectAssertionTypes(schema: JsonObject, path: string): GddValueIssue[] {
    const issues: GddValueIssue[] = [];
    const check = (keyword: string, valid: boolean): void => {
        if (hasOwn(schema, keyword) && !valid) {
            issues.push(valueIssue(`Assertion "${keyword}" has an unsupported schema value.`, path));
        }
    };
    for (const keyword of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']) {
        check(keyword, isFiniteNumber(schema[keyword]));
    }
    check('multipleOf', isFiniteNumber(schema['multipleOf']) && schema['multipleOf'] > 0);
    for (const keyword of ['minLength', 'maxLength', 'minItems', 'maxItems']) {
        check(keyword, isNonNegativeInteger(schema[keyword]));
    }
    check('pattern', typeof schema['pattern'] === 'string');
    check('enum', Array.isArray(schema['enum']));
    check('uniqueItems', typeof schema['uniqueItems'] === 'boolean');
    const required = schema['required'];
    check('required', Array.isArray(required) && required.every((entry) => typeof entry === 'string'));
    for (const keyword of ['properties', 'patternProperties', 'items']) {
        check(keyword, isRecord(schema[keyword]));
    }
    check('additionalProperties', typeof schema['additionalProperties'] === 'boolean'
        || isRecord(schema['additionalProperties']));
    if (schema['type'] === 'array' && !hasOwn(schema, 'items')) {
        issues.push(valueIssue('Array GDD schema requires an items schema.', path));
    }
    if (schema['type'] === 'object' && !hasOwn(schema, 'properties')) {
        issues.push(valueIssue('Object GDD schema requires properties.', path));
    }
    return issues;
}

export function gddValueMatchesType(value: unknown, type: GddFieldType): boolean {
    switch (type) {
        case 'boolean': return typeof value === 'boolean';
        case 'string': return typeof value === 'string';
        case 'number': return isFiniteNumber(value);
        case 'integer': return isFiniteNumber(value) && Number.isInteger(value);
        case 'array': return Array.isArray(value);
        case 'object': return isRecord(value);
    }
}

function validateValueAgainstSchema(
    value: unknown,
    schema: JsonObject,
    path: string,
    recursionStack: WeakSet<object>,
    depth: number,
): GddValueIssue[] {
    if (depth > MAX_GDD_DEPTH) {
        // Schema inspection reports the limit as unsupported, not invalid data.
        return [];
    }

    const type = schema['type'];
    if (typeof type !== 'string' || !GDD_FIELD_TYPES.has(type as GddFieldType)) return [];
    if (!gddValueMatchesType(value, type as GddFieldType)) {
        return [valueIssue(`Value does not match type "${type}".`,
            path,
        )];
    }

    const issues: GddValueIssue[] = [];
    const enumValues = schema['enum'];
    if (
        Array.isArray(enumValues)
        && !enumValues.some((candidate) => jsonValuesEqual(candidate, value))
    ) {
        issues.push(valueIssue('Value is not one of the declared enum values.',
            path,
        ));
    }

    if (typeof value === 'string') {
        issues.push(...validateStringValue(value, schema, path));
        return issues;
    }
    if (isFiniteNumber(value)) {
        issues.push(...validateNumberValue(value, schema, path));
        return issues;
    }
    if (typeof value !== 'object' || value === null) return issues;
    if (recursionStack.has(value)) {
        issues.push(valueIssue('Value contains a cyclic reference.', path));
        return issues;
    }

    recursionStack.add(value);
    try {
        if (Array.isArray(value)) {
            issues.push(...validateArrayValue(value, schema, path, recursionStack, depth));
        } else if (isRecord(value)) {
            issues.push(...validateObjectValue(value, schema, path, recursionStack, depth));
        }
    } finally {
        recursionStack.delete(value);
    }

    return issues;
}

function validateStringValue(value: string, schema: JsonObject, path: string): GddValueIssue[] {
    const issues: GddValueIssue[] = [];
    const length = Array.from(value).length;
    const minLength = schema['minLength'];
    const maxLength = schema['maxLength'];
    if (isNonNegativeInteger(minLength) && length < minLength) {
        issues.push(valueIssue(`String value must contain at least ${minLength} character(s).`,
            path,
        ));
    }
    if (isNonNegativeInteger(maxLength) && length > maxLength) {
        issues.push(valueIssue(`String value must contain at most ${maxLength} character(s).`,
            path,
        ));
    }

    const pattern = schema['pattern'];
    if (typeof pattern === 'string') {
        try {
            if (!new RegExp(pattern, 'u').test(value)) {
                issues.push(valueIssue('String value does not match the declared pattern.',
                    path,
                ));
            }
        } catch {
            // The pinned JSON schema reports invalid regular expressions.
        }
    }

    return issues;
}

function validateNumberValue(value: number, schema: JsonObject, path: string): GddValueIssue[] {
    const issues: GddValueIssue[] = [];
    const minimum = schema['minimum'];
    const maximum = schema['maximum'];
    const exclusiveMinimum = schema['exclusiveMinimum'];
    const exclusiveMaximum = schema['exclusiveMaximum'];
    const multipleOf = schema['multipleOf'];

    if (isFiniteNumber(minimum) && value < minimum) {
        issues.push(valueIssue(`Number value must be at least ${minimum}.`, path));
    }
    if (isFiniteNumber(maximum) && value > maximum) {
        issues.push(valueIssue(`Number value must be at most ${maximum}.`, path));
    }
    if (isFiniteNumber(exclusiveMinimum) && value <= exclusiveMinimum) {
        issues.push(valueIssue(`Number value must be greater than ${exclusiveMinimum}.`,
            path,
        ));
    }
    if (isFiniteNumber(exclusiveMaximum) && value >= exclusiveMaximum) {
        issues.push(valueIssue(`Number value must be less than ${exclusiveMaximum}.`,
            path,
        ));
    }
    if (isFiniteNumber(multipleOf) && multipleOf > 0 && !isNumberMultipleOf(value, multipleOf)) {
        issues.push(valueIssue(`Number value must be a multiple of ${multipleOf}.`,
            path,
        ));
    }

    return issues;
}

function validateObjectValue(
    value: JsonObject,
    schema: JsonObject,
    path: string,
    recursionStack: WeakSet<object>,
    depth: number,
): GddValueIssue[] {
    const issues: GddValueIssue[] = [];
    const properties = isRecord(schema['properties']) ? schema['properties'] : {};
    const required = Array.isArray(schema['required'])
        ? schema['required'].filter((entry): entry is string => typeof entry === 'string')
        : [];

    for (const property of required) {
        if (!hasOwn(value, property)) {
            issues.push(valueIssue(`Value is missing required property "${property}".`,
                appendValuePropertyPath(path, property),
            ));
        }
    }

    const patternProperties = readPatternProperties(schema['patternProperties']);
    for (const [property, propertyValue] of Object.entries(value)) {
        const propertyPath = appendValuePropertyPath(path, property);
        let matched = false;
        if (hasOwn(properties, property)) {
            matched = true;
            const propertySchema = properties[property];
            if (isRecord(propertySchema)) {
                issues.push(...validateValueAgainstSchema(
                    propertyValue,
                    propertySchema,
                    propertyPath,
                    recursionStack,
                    depth + 1,
                ));
            }
        }

        for (const patternProperty of patternProperties) {
            if (!patternProperty.pattern.test(property)) continue;
            matched = true;
            issues.push(...validateValueAgainstSchema(
                propertyValue,
                patternProperty.schema,
                propertyPath,
                recursionStack,
                depth + 1,
            ));
        }

        if (matched) continue;
        const additionalProperties = schema['additionalProperties'];
        if (additionalProperties === false) {
            issues.push(valueIssue(`Value contains undeclared property "${property}".`,
                propertyPath,
            ));
        } else if (isRecord(additionalProperties)) {
            issues.push(...validateValueAgainstSchema(
                propertyValue,
                additionalProperties,
                propertyPath,
                recursionStack,
                depth + 1,
            ));
        }
    }

    return issues;
}

function validateArrayValue(
    value: unknown[],
    schema: JsonObject,
    path: string,
    recursionStack: WeakSet<object>,
    depth: number,
): GddValueIssue[] {
    const issues: GddValueIssue[] = [];
    const minItems = schema['minItems'];
    const maxItems = schema['maxItems'];
    if (isNonNegativeInteger(minItems) && value.length < minItems) {
        issues.push(valueIssue(`Array value must contain at least ${minItems} item(s).`,
            path,
        ));
    }
    if (isNonNegativeInteger(maxItems) && value.length > maxItems) {
        issues.push(valueIssue(`Array value must contain at most ${maxItems} item(s).`,
            path,
        ));
    }

    if (schema['uniqueItems'] === true) {
        for (let index = 0; index < value.length; index += 1) {
            const duplicate = value.slice(0, index).some((candidate) => jsonValuesEqual(candidate, value[index]));
            if (duplicate) {
                issues.push(valueIssue('Array value items must be unique.',
                    `${path}[${index}]`,
                ));
            }
        }
    }

    const items = schema['items'];
    if (isRecord(items)) {
        value.forEach((item, index) => {
            issues.push(...validateValueAgainstSchema(
                item,
                items,
                `${path}[${index}]`,
                recursionStack,
                depth + 1,
            ));
        });
    }

    return issues;
}

interface PatternProperty {
    pattern: RegExp;
    schema: JsonObject;
}

function readPatternProperties(value: unknown): PatternProperty[] {
    if (!isRecord(value)) return [];
    const result: PatternProperty[] = [];
    for (const [pattern, schema] of Object.entries(value)) {
        if (!isRecord(schema)) continue;
        try {
            result.push({ pattern: new RegExp(pattern, 'u'), schema });
        } catch {
            // The pinned JSON schema reports invalid regular expressions.
        }
    }
    return result;
}

function appendValuePropertyPath(path: string, property: string): string {
    return /^[A-Za-z_$][A-Za-z\d_$]*$/u.test(property)
        ? `${path}.${property}`
        : `${path}[${JSON.stringify(property)}]`;
}

function isNonNegativeInteger(value: unknown): value is number {
    return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function isNumberMultipleOf(value: number, divisor: number): boolean {
    const quotient = value / divisor;
    if (!Number.isFinite(quotient)) return false;
    const nearestInteger = Math.round(quotient);
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(quotient)) * 8;
    return Math.abs(quotient - nearestInteger) <= tolerance;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
    return jsonValuesEqualInternal(left, right, new WeakMap<object, WeakSet<object>>());
}

function jsonValuesEqualInternal(
    left: unknown,
    right: unknown,
    seen: WeakMap<object, WeakSet<object>>,
): boolean {
    if (left === right) return true;
    if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;

    const seenRights = seen.get(left);
    if (seenRights?.has(right)) return true;
    if (seenRights) seenRights.add(right);
    else seen.set(left, new WeakSet([right]));

    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length
            && left.every((entry, index) => jsonValuesEqualInternal(entry, right[index], seen));
    }
    if (!isRecord(left) || !isRecord(right)) return false;

    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key) => hasOwn(right, key) && jsonValuesEqualInternal(left[key], right[key], seen));
}
