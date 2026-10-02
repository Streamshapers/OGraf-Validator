import { describe, expect, it } from 'vitest';
import {
    buildSchemaDefaultsValue,
    buildSchemaDefaultValue,
    buildSchemaEditorValue,
    SchemaDefaultLimitError,
} from '../schema-defaults.js';
import { buildPreviewData } from '../use-preview-sw.js';

describe('buildSchemaDefaultValue', () => {
    it('recursively builds object payloads from defaults', () => {
        expect(buildSchemaDefaultValue({
            type: 'object',
            required: ['title', 'style'],
            properties: {
                title: { type: 'string', default: 'Hello' },
                style: {
                    type: 'object',
                    required: ['visible'],
                    properties: {
                        visible: { type: 'boolean', default: true },
                        optionalWithoutDefault: { type: 'number' },
                    },
                },
            },
        })).toEqual({
            ok: true,
            value: { title: 'Hello', style: { visible: true } },
        });
    });

    it('explains when a required payload value cannot be derived', () => {
        expect(buildSchemaDefaultValue({
            type: 'object',
            required: ['title'],
            properties: { title: { type: 'string' } },
        })).toMatchObject({ ok: false, reason: expect.stringContaining('$.title') });
    });

    it('accepts empty optional objects/arrays and composes required array items', () => {
        expect(buildSchemaDefaultValue({ type: 'object', properties: {} })).toEqual({ ok: true, value: {} });
        expect(buildSchemaDefaultValue({ type: 'array' })).toEqual({ ok: true, value: [] });
        expect(buildSchemaDefaultValue({ type: 'array', minItems: 1 })).toMatchObject({ ok: false });
        expect(buildSchemaDefaultValue({
            type: 'array',
            minItems: 2,
            items: { type: 'string', default: 'item' },
        })).toEqual({ ok: true, value: ['item', 'item'] });
    });

    it('composes nested preview defaults and editor item fallbacks', () => {
        const schema = {
            type: 'object',
            properties: {
                title: { type: 'string', default: 'Hello' },
                style: {
                    type: 'object',
                    properties: { visible: { type: 'boolean', default: true } },
                },
                rows: {
                    type: 'array',
                    minItems: 1,
                    items: {
                        type: 'object',
                        properties: { label: { type: 'string', default: 'Row' } },
                    },
                },
            },
        };
        expect(buildSchemaDefaultsValue(schema)).toEqual({
            title: 'Hello',
            style: { visible: true },
            rows: [{ label: 'Row' }],
        });
        expect(buildSchemaEditorValue({ type: 'integer' })).toBe(0);
        expect(buildSchemaEditorValue({ type: 'object', properties: { enabled: { type: 'boolean', default: true } } }))
            .toEqual({ enabled: true });
    });

    it.each([buildSchemaDefaultValue, buildSchemaDefaultsValue])(
        'bounds required array generation before attempting impossible allocations', (build) => {
            expect(() => build({
                type: 'array', minItems: 4294967296,
                items: { type: 'string', default: 'item' },
            })).toThrow(SchemaDefaultLimitError);
        },
    );

    it.each([buildSchemaDefaultValue, buildSchemaDefaultsValue])(
        'bounds the aggregate generated tree, not only each individual array', (build) => {
            expect(() => build({
                type: 'array', minItems: 100,
                items: {
                    type: 'array', minItems: 100,
                    items: { type: 'string', default: 'item' },
                },
            })).toThrow('10000 inspected/generated values');
        },
    );

    it('bounds explicit defaults as well as composed defaults', () => {
        expect(() => buildSchemaDefaultsValue({
            type: 'array', default: Array.from({ length: 1001 }, () => 'item'),
        })).toThrow(SchemaDefaultLimitError);
    });

    it('bounds pathological schema recursion', () => {
        const recursive: Record<string, unknown> = { type: 'object' };
        recursive['properties'] = { child: recursive };

        expect(() => buildSchemaDefaultsValue(recursive)).toThrow(SchemaDefaultLimitError);
        expect(() => buildSchemaDefaultValue(recursive)).toThrow(SchemaDefaultLimitError);
    });

    it('keeps manual preview and editor initialization usable when generation is limited', () => {
        const rows = {
            type: 'array', minItems: 4294967296,
            items: { type: 'string', default: 'item' },
        };
        const manifest = { schema: { type: 'object', properties: { rows } } };

        expect(buildPreviewData(manifest)).toEqual({});
        expect(buildSchemaEditorValue(rows)).toEqual([]);
        expect(() => buildPreviewData(manifest, { throwOnGenerationLimit: true }))
            .toThrow('test-system limit, not an OGraf schema restriction');
    });
});
