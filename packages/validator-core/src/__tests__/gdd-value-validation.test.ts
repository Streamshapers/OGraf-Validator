import { describe, expect, it } from 'vitest';
import { validateGddValue } from '../index.js';

describe('validateGddValue', () => {
    it('checks required data without inventing defaults or mutating values', () => {
        const schema = { type: 'object', required: ['name'], properties: {
            name: { type: 'string', default: 'Name' },
        } };
        const value = {};

        expect(validateGddValue(schema, value)).toEqual({ status: 'invalid', issues: [{
            path: '$.name', message: 'Value is missing required property "name".',
        }] });
        expect(value).toEqual({});
        expect(validateGddValue(schema, { name: 'Ada' })).toEqual({ status: 'valid', issues: [] });
    });

    it('checks nested constraints with unambiguous data paths', () => {
        const schema = { type: 'object', properties: {
            'person.name': { type: 'string', minLength: 2 },
            values: { type: 'array', items: { type: 'integer', minimum: 1 }, uniqueItems: true },
        }, additionalProperties: false };
        const result = validateGddValue(schema, { 'person.name': 'x', values: [0, 0], extra: true });

        expect(result.status).toBe('invalid');
        expect(result.issues.map((issue) => issue.path))
            .toEqual(['$["person.name"]', '$.values[1]', '$.values[0]', '$.values[1]', '$.extra']);
    });

    it.each([
        [{ type: 'string', enum: ['x'] }, 'y'],
        [{ type: 'string', pattern: '^x+$', maxLength: 2 }, 'yyy'],
        [{ type: 'number', multipleOf: 0.1, exclusiveMinimum: 0 }, 0.25],
        [{ type: 'integer' }, 1.5],
        [{ type: 'array', minItems: 1, items: { type: 'string' } }, []],
        [{ type: 'array', maxItems: 1, items: { type: 'string' } }, ['a', 'b']],
        [{ type: 'object', patternProperties: { '^score': { type: 'number', minimum: 0 } },
            properties: {} }, { score1: -1 }],
        [{ type: 'object', properties: {}, additionalProperties: { type: 'boolean' } }, { x: 1 }],
    ])('rejects a checked assertion in %j', (schema, value) => {
        expect(validateGddValue(schema, value).status).toBe('invalid');
    });

    it.each(['$ref', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'contains', 'prefixItems',
        'unevaluatedProperties', 'dependentRequired', 'minProperties', 'const'])(
        'does not claim validity when %s has not been evaluated', (keyword) => {
            const result = validateGddValue({ type: 'object', properties: {}, [keyword]: {} }, {});

            expect(result.status).toBe('unsupported');
            expect(result.issues[0]?.message).toContain(keyword);
        },
    );

    it('detects unsupported assertions on schema branches without supplied data', () => {
        const result = validateGddValue({ type: 'object', properties: {
            value: { type: 'string', oneOf: [{ const: 'x' }] },
        } }, {});

        expect(result.status).toBe('unsupported');
        expect(result.issues[0]?.path).toBe('$.value');
    });

    it('allows custom annotation keys and GDD presentation metadata', () => {
        expect(validateGddValue({ type: 'string', label: 'Name', gddType: 'single-line',
            customEditor: { allOf: [] }, v_vendor: true, format: 'email' }, 'hello'))
            .toEqual({ status: 'valid', issues: [] });
    });

    it('prioritizes a definite assertion failure over unsupported features', () => {
        expect(validateGddValue({ type: 'string', allOf: [] }, 1).status).toBe('invalid');
    });

    it('handles malformed schemas and recursion conservatively without throwing', () => {
        const cyclic: Record<string, unknown> = { type: 'object', properties: {} };
        cyclic['properties'] = { child: cyclic };

        expect(validateGddValue(undefined, {}).status).toBe('unsupported');
        expect(validateGddValue({ type: 'string', pattern: '[' }, 'a').status).toBe('unsupported');
        expect(validateGddValue(cyclic, {}).status).toBe('unsupported');
    });

    it.each([
        [{ type: 'string', minLength: '2' }, 'a'],
        [{ type: 'number', multipleOf: 0 }, 1],
        [{ type: 'object', properties: {}, required: true }, {}],
        [{ type: 'array' }, []],
    ])('does not silently accept malformed supported assertions in %j', (schema, value) => {
        expect(validateGddValue(schema, value).status).toBe('unsupported');
    });

    it('compares enum objects structurally and counts Unicode string characters', () => {
        expect(validateGddValue({ type: 'object', properties: {}, enum: [{ a: 1, b: 2 }] },
            { b: 2, a: 1 }).status).toBe('valid');
        expect(validateGddValue({ type: 'string', minLength: 1, maxLength: 1 }, '🎬').status)
            .toBe('valid');
    });
});
