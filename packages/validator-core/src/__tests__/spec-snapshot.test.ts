import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateManifest, validatePackage } from '../index.js';
import type {
    GddSchema,
    OgrafActionDuration,
    OgrafEngineRequirement,
    OgrafThumbnail,
    ValidationIssueCode,
    ValidationResult,
    VirtualFS,
} from '../index.js';

const OFFICIAL_SCHEMA_URL = 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json';
const SPEC_ROOT = resolve(__dirname, '../../spec');
const SNAPSHOT_DIRECTORIES = readdirSync(SPEC_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('ebu-ograf-v1-'));
if (SNAPSHOT_DIRECTORIES.length !== 1 || SNAPSHOT_DIRECTORIES[0] === undefined) {
    throw new Error('Expected exactly one vendored EBU OGraf v1 snapshot.');
}
const SNAPSHOT_ROOT = resolve(SPEC_ROOT, SNAPSHOT_DIRECTORIES[0].name);
const SNAPSHOT_METADATA = JSON.parse(readFileSync(
    resolve(SNAPSHOT_ROOT, 'SNAPSHOT.json'),
    'utf8',
)) as { commit: string; sourceDate: string };

function manifest(overrides: Record<string, unknown> = {}): unknown {
    return {
        $schema: OFFICIAL_SCHEMA_URL,
        id: 'com.example.test',
        name: 'Test Graphic',
        main: 'graphic.mjs',
        supportsRealTime: true,
        supportsNonRealTime: false,
        ...overrides,
    };
}

function hasCode(result: ValidationResult, code: ValidationIssueCode): boolean {
    return result.issues.some((entry) => entry.code === code);
}

function issueAt(result: ValidationResult, code: ValidationIssueCode, path: string) {
    return result.issues.find((entry) => entry.code === code && entry.path === path);
}

function memoryFs(
    files: Record<string, string | number>,
    overrides: Partial<VirtualFS> = {},
): VirtualFS {
    return {
        async readFile(path: string): Promise<string> {
            const value = files[path];
            if (value === undefined) throw new Error(`Missing ${path}`);
            return typeof value === 'string' ? value : '';
        },
        async fileExists(path: string): Promise<boolean> {
            return path in files;
        },
        async listFiles(): Promise<string[]> {
            return Object.keys(files);
        },
        async getFileSize(path: string): Promise<number> {
            const value = files[path];
            if (value === undefined) throw new Error(`Missing ${path}`);
            return typeof value === 'number' ? value : value.length;
        },
        ...overrides,
    };
}

describe(`vendored EBU ${SNAPSHOT_METADATA.commit.slice(0, 8)} snapshot`, () => {
    it('pins the full upstream commit and the new schema fields', () => {
        const snapshot = readFileSync(resolve(SNAPSHOT_ROOT, 'SNAPSHOT.md'), 'utf8');
        const schema = JSON.parse(readFileSync(
            resolve(SNAPSHOT_ROOT, 'json-schemas/graphics/schema.json'),
            'utf8',
        )) as { properties: Record<string, unknown> };

        expect(snapshot).toContain(SNAPSHOT_METADATA.commit);
        expect(snapshot).toContain(SNAPSHOT_METADATA.sourceDate);
        expect(schema.properties).toHaveProperty('actionDurations');
        expect(schema.properties).toHaveProperty('thumbnails');
        expect(schema.properties).toHaveProperty('renderRequirements');
    });

    it('pins hidden, order, select, and select-multiple GDD definitions', () => {
        const objectSchema = JSON.parse(readFileSync(
            resolve(SNAPSHOT_ROOT, 'json-schemas/gdd/object.json'),
            'utf8',
        )) as { properties: Record<string, unknown> };
        const gddTypes = readFileSync(resolve(SNAPSHOT_ROOT, 'json-schemas/gdd/gdd-types.json'), 'utf8');

        expect(objectSchema.properties).toHaveProperty('hidden');
        expect(objectSchema.properties).toHaveProperty('order');
        expect(gddTypes).toContain('"select"');
        expect(gddTypes).toContain('"select-multiple"');
    });

    it.each([
        'examples/l3rd-name/l3rd.ograf.json',
        'examples/ograf-logo/logo.ograf.json',
        'examples/renderer-test/manifest.ograf.json',
    ])('accepts the upstream example manifest %s', (relativePath) => {
        const upstreamManifest = JSON.parse(readFileSync(resolve(SNAPSHOT_ROOT, relativePath), 'utf8')) as unknown;
        const result = validateManifest(upstreamManifest);

        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
    });

    it('reports the upstream minimal example default that contradicts its color pattern', () => {
        const upstreamManifest = JSON.parse(readFileSync(
            resolve(SNAPSHOT_ROOT, 'examples/minimal/minimal.ograf.json'),
            'utf8',
        )) as unknown;
        const result = validateManifest(upstreamManifest);

        expect(issueAt(result, 'INVALID_GDD', 'schema.properties.message.default')).toBeDefined();
        expect(result.valid).toBe(false);
    });
});

describe('normative severities', () => {
    it('treats an incorrect schema reference as an error', () => {
        const result = validateManifest(manifest({ $schema: 'https://example.com/schema.json' }));
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(expect.objectContaining({ code: 'INVALID_SCHEMA_REF' }));
    });

    it('treats no supported render mode as an error', () => {
        const result = validateManifest(manifest({ supportsRealTime: false, supportsNonRealTime: false }));
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(expect.objectContaining({ code: 'NO_RUNTIME_SUPPORT' }));
    });

    it('treats unknown non-vendor fields as errors but permits v_ fields', () => {
        const invalid = validateManifest(manifest({ unexpected: true }));
        const valid = validateManifest(manifest({ v_streamshapers: { editor: true } }));

        expect(invalid.errors).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_FIELD', path: 'unexpected' }));
        expect(hasCode(valid, 'UNKNOWN_FIELD')).toBe(false);
        expect(valid.valid).toBe(true);
    });

    it('does not impose semver or gddType recommendations', () => {
        const result = validateManifest(manifest({
            version: 'final_final_2',
            schema: { type: 'object', properties: { title: { type: 'string' } } },
        }));

        expect(result.valid).toBe(true);
        expect(result.issues.some((entry) => entry.code === 'INVALID_VERSION_FORMAT')).toBe(false);
        expect(result.issues.some((entry) => entry.code === 'MISSING_GDD_TYPE')).toBe(false);
    });

    it('keeps a missing GDD informational', () => {
        const result = validateManifest(manifest());
        expect(result.valid).toBe(true);
        expect(result.infos).toContainEqual(expect.objectContaining({ code: 'MISSING_GDD' }));
    });
});

describe('actionDurations', () => {
    it('accepts every action duration variant and typed public values', () => {
        const durations: OgrafActionDuration[] = [
            { type: 'playAction', duration: 500, steps: [{ step: 0, duration: 300 }, { duration: 450 }] },
            { type: 'updateAction', duration: 100 },
            { type: 'stopAction', duration: -1 },
            { type: 'customAction', customActionId: 'flash', duration: 250 },
        ];
        const result = validateManifest(manifest({
            customActions: [{ id: 'flash', name: 'Flash' }],
            actionDurations: durations,
        }));

        expect(result.valid).toBe(true);
    });

    it('validates duration shape and minimum recursively', () => {
        const result = validateManifest(manifest({
            actionDurations: [{ type: 'playAction', duration: -2, steps: [{ step: -1, duration: 1.5 }] }],
        }));

        expect(issueAt(result, 'INVALID_ACTION_DURATION', 'actionDurations[0].duration')).toBeDefined();
        expect(issueAt(result, 'INVALID_ACTION_DURATION', 'actionDurations[0].steps[0].step')).toBeDefined();
        expect(issueAt(result, 'INVALID_ACTION_DURATION', 'actionDurations[0].steps[0].duration')).toBeDefined();
    });

    it('rejects duplicate built-in and custom action duration entries', () => {
        const result = validateManifest(manifest({
            customActions: [{ id: 'flash', name: 'Flash' }],
            actionDurations: [
                { type: 'stopAction', duration: 10 },
                { type: 'stopAction', duration: 20 },
                { type: 'customAction', customActionId: 'flash', duration: 10 },
                { type: 'customAction', customActionId: 'flash', duration: 20 },
            ],
        }));

        expect(result.issues.filter((entry) => entry.code === 'DUPLICATE_ACTION_DURATION')).toHaveLength(2);
    });

    it('rejects duplicate explicit and fallback step durations', () => {
        const result = validateManifest(manifest({
            actionDurations: [{
                type: 'playAction',
                duration: 100,
                steps: [
                    { step: 0, duration: 10 },
                    { step: 0, duration: 20 },
                    { duration: 30 },
                    { duration: 40 },
                ],
            }],
        }));

        expect(result.issues.filter((entry) => entry.code === 'DUPLICATE_ACTION_DURATION')).toHaveLength(2);
    });

    it('rejects custom duration references not declared in customActions', () => {
        const result = validateManifest(manifest({
            customActions: [{ id: 'known', name: 'Known' }],
            actionDurations: [{ type: 'customAction', customActionId: 'missing', duration: 10 }],
        }));

        expect(issueAt(result, 'UNKNOWN_CUSTOM_ACTION_DURATION', 'actionDurations[0].customActionId')).toBeDefined();
    });

    it('enforces per-variant additional properties while allowing v_ fields', () => {
        const invalid = validateManifest(manifest({
            actionDurations: [{ type: 'stopAction', duration: 10, steps: [] }],
        }));
        const valid = validateManifest(manifest({
            actionDurations: [{ type: 'stopAction', duration: 10, v_timing: 'measured' }],
        }));

        expect(issueAt(invalid, 'UNKNOWN_FIELD', 'actionDurations[0].steps')).toBeDefined();
        expect(valid.valid).toBe(true);
    });
});

describe('thumbnails', () => {
    it('accepts all specified image formats and typed thumbnail values', () => {
        const thumbnails: OgrafThumbnail[] = [
            { file: 'preview.png', resolution: { width: 1920, height: 1080 } },
            { file: 'preview.jpg' },
            { file: 'preview.gif' },
            { file: 'preview.webp', v_role: 'poster' },
        ];
        expect(validateManifest(manifest({ thumbnails })).valid).toBe(true);
    });

    it('rejects unsupported formats and incomplete or invalid resolutions', () => {
        const result = validateManifest(manifest({
            thumbnails: [
                { file: 'preview.svg' },
                { file: 'preview.png', resolution: { width: 0 } },
            ],
        }));

        expect(issueAt(result, 'INVALID_THUMBNAIL', 'thumbnails[0].file')).toBeDefined();
        expect(issueAt(result, 'INVALID_THUMBNAIL', 'thumbnails[1].resolution.width')).toBeDefined();
        expect(issueAt(result, 'MISSING_FIELD', 'thumbnails[1].resolution.height')).toBeDefined();
    });

    it('reports missing package-relative thumbnail assets', async () => {
        const result = await validatePackage(
            manifest({ thumbnails: [{ file: 'missing.png' }] }),
            memoryFs({ 'manifest.ograf.json': '{}', 'graphic.mjs': '' }),
        );

        expect(issueAt(result, 'MISSING_THUMBNAIL_ASSET', 'thumbnails[0].file')).toBeDefined();
    });

    it('does not ask VirtualFS to resolve absolute thumbnail URLs', async () => {
        const checked: string[] = [];
        const fs = memoryFs(
            { 'manifest.ograf.json': '{}', 'graphic.mjs': '' },
            { async fileExists(path: string) { checked.push(path); return path === 'graphic.mjs'; } },
        );
        const result = await validatePackage(
            manifest({ thumbnails: [{ file: 'https://cdn.example.com/preview.webp' }] }),
            fs,
        );

        expect(result.valid).toBe(true);
        expect(checked).toEqual(['graphic.mjs']);
    });
});

describe('renderRequirements.engine', () => {
    it('accepts engine version requirements and typed public values', () => {
        const engine: OgrafEngineRequirement[] = [
            { type: 'CEF', version: { min: '139' } },
            { type: 'Gecko', version: { min: '120.0.5' }, v_vendorHint: true },
        ];
        const result = validateManifest(manifest({ renderRequirements: [{ engine }] }));
        expect(result.valid).toBe(true);
    });

    it('requires engine type, version, and version.min', () => {
        const result = validateManifest(manifest({
            renderRequirements: [{ engine: [{ version: {} }, { type: 'CEF' }] }],
        }));

        expect(issueAt(result, 'MISSING_FIELD', 'renderRequirements[0].engine[0].type')).toBeDefined();
        expect(issueAt(result, 'MISSING_FIELD', 'renderRequirements[0].engine[0].version.min')).toBeDefined();
        expect(issueAt(result, 'MISSING_FIELD', 'renderRequirements[0].engine[1].version')).toBeDefined();
    });

    it('validates render requirement unknown fields and numeric constraints', () => {
        const result = validateManifest(manifest({
            renderRequirements: [{ typo: true, frameRate: { min: 60, max: 25 } }],
        }));

        expect(issueAt(result, 'UNKNOWN_FIELD', 'renderRequirements[0].typo')).toBeDefined();
        expect(issueAt(result, 'INVALID_RENDER_REQUIREMENT', 'renderRequirements[0].frameRate')).toBeDefined();
    });

    it('allows only v_-prefixed extensions in nested render and thumbnail objects', () => {
        const invalid = validateManifest(manifest({
            renderRequirements: [{
                resolution: { width: { exact: 1920 }, mystery: true },
                engine: [{ type: 'CEF', version: { min: '139', mystery: true }, mystery: true }],
            }],
            thumbnails: [{
                file: 'thumb.png',
                resolution: { width: 320, height: 180, mystery: true },
            }],
        }));
        expect(issueAt(invalid, 'UNKNOWN_FIELD', 'renderRequirements[0].resolution.mystery')).toBeDefined();
        expect(issueAt(invalid, 'UNKNOWN_FIELD', 'renderRequirements[0].engine[0].mystery')).toBeDefined();
        expect(issueAt(invalid, 'UNKNOWN_FIELD', 'renderRequirements[0].engine[0].version.mystery')).toBeDefined();
        expect(issueAt(invalid, 'UNKNOWN_FIELD', 'thumbnails[0].resolution.mystery')).toBeDefined();

        const valid = validateManifest(manifest({
            renderRequirements: [{
                resolution: { width: { exact: 1920 }, v_layout: true },
                engine: [{ type: 'CEF', version: { min: '139', v_build: true }, v_vendor: true }],
            }],
            thumbnails: [{
                file: 'thumb.png',
                resolution: { width: 320, height: 180, v_crop: true },
            }],
        }));
        expect(hasCode(valid, 'UNKNOWN_FIELD')).toBe(false);
        expect(valid.valid).toBe(true);
    });
});

describe('recursive GDD validation', () => {
    it('accepts hidden and order recursively', () => {
        const schema: GddSchema = {
            type: 'object',
            properties: {
                group: {
                    type: 'object',
                    order: 1,
                    properties: {
                        internal: { type: 'string', hidden: true, order: 2 },
                    },
                },
            },
        };
        expect(validateManifest(manifest({ schema })).valid).toBe(true);
    });

    it('rejects invalid hidden, order, nested fields, and defaults with exact paths', () => {
        const result = validateManifest(manifest({
            schema: {
                type: 'object',
                properties: {
                    group: {
                        type: 'object',
                        hidden: 'yes',
                        order: Number.POSITIVE_INFINITY,
                        properties: {
                            title: { type: 'string', default: 42 },
                            broken: null,
                        },
                    },
                },
            },
        }));

        expect(issueAt(result, 'INVALID_GDD', 'schema.properties.group.hidden')).toBeDefined();
        expect(issueAt(result, 'INVALID_GDD', 'schema.properties.group.order')).toBeDefined();
        expect(issueAt(result, 'INVALID_GDD', 'schema.properties.group.properties.title.default')).toBeDefined();
        expect(issueAt(result, 'INVALID_GDD', 'schema.properties.group.properties.broken')).toBeDefined();
    });

    it('rejects arrays used as properties objects', () => {
        const result = validateManifest(manifest({ schema: { type: 'object', properties: [] } }));
        expect(result.valid).toBe(false);
        expect(issueAt(result, 'INVALID_GDD', 'schema.properties')).toBeDefined();
    });

    it('accepts recursively schema-conformant GDD defaults', () => {
        const result = validateManifest(manifest({
            schema: {
                type: 'object',
                properties: {
                    config: {
                        type: 'object',
                        default: {
                            title: 'AB',
                            ratio: 0.3,
                            count: 4,
                            tags: ['aa', 'bb'],
                            patterned: { 'x-one': 1 },
                        },
                        required: ['title', 'ratio', 'count', 'tags', 'patterned'],
                        additionalProperties: false,
                        properties: {
                            title: {
                                type: 'string',
                                enum: ['AB', 'CD'],
                                pattern: '^[A-Z]+$',
                                minLength: 2,
                                maxLength: 4,
                            },
                            ratio: {
                                type: 'number',
                                minimum: 0,
                                exclusiveMaximum: 1,
                                multipleOf: 0.1,
                            },
                            count: {
                                type: 'integer',
                                minimum: 0,
                                maximum: 10,
                                multipleOf: 2,
                            },
                            tags: {
                                type: 'array',
                                minItems: 1,
                                maxItems: 3,
                                uniqueItems: true,
                                items: { type: 'string', pattern: '^[a-z]{2}$' },
                            },
                            patterned: {
                                type: 'object',
                                properties: {},
                                patternProperties: { '^x-': { type: 'integer', minimum: 1 } },
                                additionalProperties: false,
                            },
                        },
                    },
                },
            },
        }));

        expect(result.errors).toEqual([]);
    });

    it('validates GDD defaults against enum and string constraints', () => {
        const result = validateManifest(manifest({
            schema: {
                type: 'object',
                properties: {
                    enumValue: { type: 'string', enum: ['one', 'two'], default: 'three' },
                    tooShort: { type: 'string', minLength: 2, pattern: '^[A-Z]+$', default: 'a' },
                    tooLong: { type: 'string', maxLength: 2, default: 'abc' },
                },
            },
        }));

        expect(issueAt(result, 'INVALID_GDD', 'schema.properties.enumValue.default')).toBeDefined();
        expect(issueAt(result, 'INVALID_GDD', 'schema.properties.tooShort.default')).toBeDefined();
        expect(issueAt(result, 'INVALID_GDD', 'schema.properties.tooLong.default')).toBeDefined();
    });

    it('validates numeric GDD defaults against integer, bounds, and multipleOf', () => {
        const result = validateManifest(manifest({
            schema: {
                type: 'object',
                properties: {
                    integer: { type: 'integer', default: 1.5 },
                    minimum: { type: 'number', minimum: 0, default: -1 },
                    maximum: { type: 'number', maximum: 10, default: 11 },
                    exclusiveMinimum: { type: 'number', exclusiveMinimum: 0, default: 0 },
                    exclusiveMaximum: { type: 'number', exclusiveMaximum: 10, default: 10 },
                    multipleOf: { type: 'number', multipleOf: 0.1, default: 0.25 },
                },
            },
        }));

        for (const field of [
            'integer',
            'minimum',
            'maximum',
            'exclusiveMinimum',
            'exclusiveMaximum',
            'multipleOf',
        ]) {
            expect(issueAt(result, 'INVALID_GDD', `schema.properties.${field}.default`)).toBeDefined();
        }
    });

    it('validates object and array GDD defaults recursively', () => {
        const result = validateManifest(manifest({
            schema: {
                type: 'object',
                properties: {
                    settings: {
                        type: 'object',
                        default: { name: 42, extra: true },
                        required: ['name', 'missing'],
                        additionalProperties: false,
                        properties: { name: { type: 'string' } },
                    },
                    dictionary: {
                        type: 'object',
                        default: { score: 1 },
                        properties: {},
                        additionalProperties: { type: 'integer', minimum: 2 },
                    },
                    tooShort: {
                        type: 'array',
                        default: [],
                        minItems: 1,
                        items: { type: 'integer' },
                    },
                    tooLong: {
                        type: 'array',
                        default: [1, 1, 4],
                        maxItems: 2,
                        uniqueItems: true,
                        items: { type: 'integer', maximum: 2 },
                    },
                    wrongItems: {
                        type: 'array',
                        default: ['x'],
                        items: { type: 'integer' },
                    },
                },
            },
        }));

        for (const path of [
            'schema.properties.settings.default.name',
            'schema.properties.settings.default.missing',
            'schema.properties.settings.default.extra',
            'schema.properties.dictionary.default.score',
            'schema.properties.tooShort.default',
            'schema.properties.tooLong.default',
            'schema.properties.tooLong.default[1]',
            'schema.properties.tooLong.default[2]',
            'schema.properties.wrongItems.default[0]',
        ]) {
            expect(issueAt(result, 'INVALID_GDD', path)).toBeDefined();
        }
    });

    it('accepts select and select-multiple definitions', () => {
        const result = validateManifest(manifest({
            schema: {
                type: 'object',
                properties: {
                    size: {
                        type: 'integer',
                        enum: [1, 2],
                        gddType: 'select',
                        gddOptions: { labels: { '1': 'Small', '2': 'Large' } },
                    },
                    teams: {
                        type: 'array',
                        items: { type: 'string', enum: ['home', 'away'] },
                        gddType: 'select-multiple',
                        gddOptions: { labels: { home: 'Home', away: 'Away' } },
                    },
                },
            },
        }));

        expect(result.valid).toBe(true);
    });

    it('rejects incomplete select definitions and type-mismatched values', () => {
        const result = validateManifest(manifest({
            schema: {
                type: 'object',
                properties: {
                    size: { type: 'integer', enum: [1, '2'], gddType: 'select', gddOptions: {} },
                    teams: {
                        type: 'array',
                        items: { type: 'boolean', enum: [true] },
                        gddType: 'select-multiple',
                        gddOptions: { labels: {} },
                    },
                },
            },
        }));

        expect(issueAt(result, 'INVALID_GDD', 'schema.properties.size.enum[1]')).toBeDefined();
        expect(issueAt(result, 'INVALID_GDD', 'schema.properties.size.gddOptions.labels')).toBeDefined();
        expect(issueAt(result, 'INVALID_GDD', 'schema.properties.teams.items.type')).toBeDefined();
    });

    it('rejects duplicate enum values, empty property names, and invalid numeric label keys', () => {
        const result = validateManifest(manifest({
            schema: {
                type: 'object',
                properties: {
                    '': { type: 'string' },
                    size: {
                        type: 'integer',
                        enum: [1, 1],
                        gddType: 'select',
                        gddOptions: { labels: { '-1': 'Negative' } },
                    },
                },
            },
        }));

        expect(issueAt(result, 'INVALID_GDD', 'schema.properties.')).toBeDefined();
        expect(issueAt(result, 'INVALID_GDD', 'schema.properties.size.enum')).toBeDefined();
        expect(issueAt(result, 'INVALID_GDD', 'schema.properties.size.gddOptions.labels.-1')).toBeDefined();
    });

    it('validates nested custom-action GDD schemas', () => {
        const result = validateManifest(manifest({
            customActions: [{
                id: 'flash',
                name: 'Flash',
                schema: {
                    type: 'object',
                    properties: { strength: { type: 'integer', default: 1.5 } },
                },
            }],
        }));

        expect(issueAt(result, 'INVALID_GDD', 'customActions[0].schema.properties.strength.default')).toBeDefined();
    });

    it('returns an issue instead of recursing forever on cyclic unknown input', () => {
        const cyclic: Record<string, unknown> = { type: 'object', properties: {} };
        (cyclic.properties as Record<string, unknown>).self = cyclic;
        const result = validateManifest(manifest({ schema: cyclic }));

        expect(result.valid).toBe(false);
        expect(hasCode(result, 'INVALID_GDD')).toBe(true);
    });
});

describe('robust unknown and VirtualFS handling', () => {
    it('never throws for revoked proxy input', async () => {
        const revocable = Proxy.revocable<Record<string, unknown>>({}, {});
        revocable.revoke();

        const result = await validatePackage(
            revocable.proxy,
            memoryFs({}),
        );

        expect(result.valid).toBe(false);
        expect(hasCode(result, 'INVALID_MANIFEST')).toBe(true);
        expect(hasCode(result, 'FILE_ACCESS_ERROR')).toBe(true);
    });

    it('never throws for an invalid main type', async () => {
        const result = await validatePackage(
            manifest({ main: 42 }),
            memoryFs({ 'manifest.ograf.json': '{}' }, { async fileExists() { return true; } }),
        );

        expect(result.valid).toBe(false);
        expect(issueAt(result, 'INVALID_TYPE', 'main')).toBeDefined();
    });

    it('never throws for null nested GDD fields', async () => {
        const result = await validatePackage(
            manifest({ schema: { type: 'object', properties: { broken: null } } }),
            memoryFs({ 'manifest.ograf.json': '{}', 'graphic.mjs': '' }),
        );

        expect(result.valid).toBe(false);
        expect(issueAt(result, 'INVALID_GDD', 'schema.properties.broken')).toBeDefined();
    });

    it('maps fileExists failures to FILE_ACCESS_ERROR', async () => {
        const result = await validatePackage(
            manifest(),
            memoryFs({}, { async fileExists() { throw new Error('denied'); } }),
        );

        expect(issueAt(result, 'FILE_ACCESS_ERROR', 'main')).toBeDefined();
    });

    it('maps malformed fileExists return values to FILE_ACCESS_ERROR', async () => {
        const fs = memoryFs({ 'graphic.mjs': '' });
        fs.fileExists = async () => 'yes' as unknown as boolean;
        const result = await validatePackage(manifest(), fs);

        expect(issueAt(result, 'FILE_ACCESS_ERROR', 'main')).toBeDefined();
    });

    it('maps listFiles and getFileSize failures without rejecting the promise', async () => {
        const listFailure = await validatePackage(
            manifest(),
            memoryFs({ 'graphic.mjs': '' }, { async listFiles() { throw new Error('list denied'); } }),
        );
        const sizeFailure = await validatePackage(
            manifest(),
            memoryFs(
                { 'manifest.ograf.json': '{}', 'graphic.mjs': '' },
                { async getFileSize() { throw new Error('stat denied'); } },
            ),
        );

        expect(hasCode(listFailure, 'FILE_ACCESS_ERROR')).toBe(true);
        expect(sizeFailure.issues.filter((entry) => entry.code === 'FILE_ACCESS_ERROR')).toHaveLength(2);
    });

    it('rejects extensionless main files as normative JavaScript violations', async () => {
        const result = await validatePackage(
            manifest({ main: 'graphic' }),
            memoryFs({ 'manifest.ograf.json': '{}', graphic: '' }),
        );

        expect(issueAt(result, 'UNUSUAL_MAIN_EXTENSION', 'main')).toBeDefined();
        expect(result.valid).toBe(false);
    });

    it('checks file-path defaults in nested custom action schemas', async () => {
        const result = await validatePackage(
            manifest({
                customActions: [{
                    id: 'flash',
                    name: 'Flash',
                    schema: {
                        type: 'object',
                        properties: {
                            image: { type: 'string', gddType: 'file-path/image-path', default: 'missing.png' },
                        },
                    },
                }],
            }),
            memoryFs({ 'manifest.ograf.json': '{}', 'graphic.mjs': '' }),
        );

        expect(issueAt(
            result,
            'MISSING_DEFAULT_ASSET',
            'customActions[0].schema.properties.image.default',
        )).toBeDefined();
    });
});
