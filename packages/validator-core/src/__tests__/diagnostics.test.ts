import { describe, expect, it } from 'vitest';
import { validateManifest } from '../index.js';

function manifest(overrides: Record<string, unknown> = {}): unknown {
    return {
        $schema: 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json',
        id: 'test',
        name: 'Test',
        main: 'graphic.mjs',
        supportsRealTime: true,
        supportsNonRealTime: false,
        ...overrides,
    };
}

describe('actionable manifest diagnostics', () => {
    it.each(['playAction', 'updateAction', 'stopAction', 'customAction'])(
        'reports only the relevant %s duration branch', (type) => {
            const result = validateManifest(manifest({
                customActions: [{ id: 'flash', name: 'Flash' }],
                actionDurations: [{
                    type,
                    duration: -2,
                    ...(type === 'playAction' ? { steps: [{ step: 0, duration: 100 }] } : {}),
                    ...(type === 'customAction' ? { customActionId: 'flash' } : {}),
                }],
            }));

            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatchObject({
                code: 'INVALID_ACTION_DURATION', path: 'actionDurations[0].duration',
            });
            expect(result.errors[0]?.message).toContain('integer greater than or equal to -1');
        },
    );

    it('keeps a real missing custom action id and does not invent sibling fields', () => {
        const result = validateManifest(manifest({
            actionDurations: [{ type: 'customAction', duration: 100 }],
        }));

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({
            code: 'MISSING_FIELD', path: 'actionDurations[0].customActionId',
        });
    });

    it.each([undefined, 'typo'])('explains an absent or unknown discriminator %s', (type) => {
        const result = validateManifest(manifest({ actionDurations: [{ type, duration: 100 }] }));

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]?.path).toBe('actionDurations[0].type');
        expect(result.errors[0]?.message).not.toMatch(/oneOf|constant|customActionId/);
    });

    it('omits nullable and conditional wrapper noise around custom-action GDD errors', () => {
        const result = validateManifest(manifest({ customActions: [{
            id: 'flash', name: 'Flash', schema: {
                type: 'object', properties: {
                    value: { type: 'boolean', gddType: 'select', enum: [true],
                        gddOptions: { labels: { true: 'True' } } },
                },
            },
        }] }));

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]?.message).toContain('string, number, or integer');
        expect(result.errors[0]?.path).toBe('customActions[0].schema.properties.value.type');
    });

    it('preserves the useful vendor-prefix and schema-URL corrections', () => {
        const result = validateManifest(manifest({ $schema: 'wrong', editor: true }));

        expect(result.errors.find((issue) => issue.code === 'UNKNOWN_FIELD')?.message)
            .toContain('"v_" prefix');
        expect(result.errors.find((issue) => issue.code === 'INVALID_SCHEMA_REF')?.message)
            .toContain('https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json');
    });

    it.each(['id', 'name', 'main', '$schema', 'supportsRealTime'])(
        'diagnoses a present null %s as a type error, not a missing field', (field) => {
            const result = validateManifest(manifest({ [field]: null }));

            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatchObject({ code: 'INVALID_TYPE', path: field });
        },
    );

    it('does not mistake null author names and durations for absence', () => {
        const result = validateManifest(manifest({
            author: { name: null },
            actionDurations: [{ type: 'playAction', duration: null }],
        }));

        expect(result.errors).toHaveLength(2);
        expect(result.errors.every((issue) => !issue.code.startsWith('MISSING'))).toBe(true);
    });

    it('reports a present null GDD type without irrelevant meta-schema union branches', () => {
        const result = validateManifest(manifest({ schema: {
            type: 'object', properties: { x: { type: null } },
        } }));

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({
            code: 'INVALID_GDD', path: 'schema.properties.x.type',
            message: 'GDD field has an unsupported "type".',
        });
    });

    it('does not count a null step as a fallback duration', () => {
        const result = validateManifest(manifest({ actionDurations: [{
            type: 'playAction', duration: 100,
            steps: [{ duration: 100 }, { step: null, duration: 200 }],
        }] }));

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({
            code: 'INVALID_ACTION_DURATION', path: 'actionDurations[0].steps[1].step',
            message: 'Step must be a non-negative integer.',
        });
    });

    it.each([4, false, 'invalid', []].map((schema) => ({ schema })))(
        'explains both valid alternatives for a malformed nullable custom schema $schema', ({ schema }) => {
            const result = validateManifest(manifest({
                customActions: [{ id: 'flash', name: 'Flash', schema }],
            }));

            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatchObject({
                code: 'INVALID_GDD', path: 'customActions[0].schema',
                message: 'Custom action GDD schema must be an object or null.',
            });
        },
    );

    it('reports an unconventional main extension as compatibility advice', () => {
        const result = validateManifest(manifest({ main: 'graphic' }));

        expect(result.valid).toBe(true);
        expect(result.warnings).toContainEqual(expect.objectContaining({
            code: 'UNUSUAL_MAIN_EXTENSION', path: 'main',
        }));
    });

    it('distinguishes default recommendations from EBU-required default types', () => {
        const result = validateManifest(manifest({ schema: { type: 'object', properties: {
            count: { type: 'integer', minimum: 1, default: 0 },
            typed: { type: 'integer', default: 'wrong' },
        } } }));

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({
            code: 'INVALID_GDD', path: 'schema.properties.typed.default',
        });
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toMatchObject({
            code: 'GDD_DEFAULT_MISMATCH', path: 'schema.properties.count.default',
        });
    });
});
