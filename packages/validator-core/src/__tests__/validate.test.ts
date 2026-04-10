import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { validateManifest, validatePackage } from '../validate.js';
import type { VirtualFS, ValidationResult } from '../types.js';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const FIXTURES_DIR = resolve(__dirname, '../../../../fixtures');

function loadFixture(name: string): unknown {
    // Support both manifest.ograf.json and any *.ograf.json in the fixture dir
    const candidates = ['manifest.ograf.json'];
    for (const filename of candidates) {
        const path = join(FIXTURES_DIR, name, filename);
        if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8'));
    }
    throw new Error(`No *.ograf.json found in fixture "${name}"`);
}

function nodeFs(baseDir: string): VirtualFS {
    return {
        async readFile(path: string): Promise<string> {
            return readFileSync(join(baseDir, path), 'utf-8');
        },
        async fileExists(path: string): Promise<boolean> {
            return existsSync(join(baseDir, path));
        },
        async listFiles(): Promise<string[]> {
            return [];
        },
    };
}

// ─── Result helpers ───────────────────────────────────────────────────────────

function expectValid(result: ValidationResult) {
    if (!result.valid) console.error('Unexpected errors:', result.errors);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
}

function expectInvalid(result: ValidationResult) {
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
}

function hasCode(result: ValidationResult, code: string): boolean {
    return result.issues.some((i) => i.code === code);
}

// ─── Minimal valid manifest factory ──────────────────────────────────────────

function validManifest(overrides: Record<string, unknown> = {}): unknown {
    return {
        $schema: 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json',
        id: 'com.example.test',
        name: 'Test Graphic',
        main: 'graphic.mjs',
        supportsRealTime: true,
        supportsNonRealTime: false,
        ...overrides,
    };
}

// ─── validateManifest: valid fixtures ────────────────────────────────────────

describe('validateManifest – valid fixtures', () => {
    it('accepts valid-basic manifest', () => {
        expectValid(validateManifest(loadFixture('valid-basic')));
    });

    it('accepts valid-realtime manifest', () => {
        expectValid(validateManifest(loadFixture('valid-realtime')));
    });
});

// ─── validateManifest: invalid fixture ───────────────────────────────────────

describe('validateManifest – invalid fixture', () => {
    it('rejects invalid-missing-fields manifest', () => {
        expectInvalid(validateManifest(loadFixture('invalid-missing-fields')));
    });

    it('reports MISSING_FIELD for missing $schema', () => {
        expect(hasCode(validateManifest(loadFixture('invalid-missing-fields')), 'MISSING_FIELD')).toBe(true);
    });

    it('reports INVALID_ID for empty id', () => {
        expect(hasCode(validateManifest(loadFixture('invalid-missing-fields')), 'INVALID_ID')).toBe(true);
    });

    it('reports INVALID_TYPE for name that is not a string', () => {
        expect(hasCode(validateManifest(loadFixture('invalid-missing-fields')), 'INVALID_TYPE')).toBe(true);
    });

    it('reports INVALID_MAIN for empty main', () => {
        expect(hasCode(validateManifest(loadFixture('invalid-missing-fields')), 'INVALID_MAIN')).toBe(true);
    });

    it('reports NO_RUNTIME_SUPPORT when both flags are false', () => {
        expect(hasCode(validateManifest(loadFixture('invalid-missing-fields')), 'NO_RUNTIME_SUPPORT')).toBe(true);
    });

    it('reports INVALID_VERSION_FORMAT info for non-semver version', () => {
        expect(hasCode(validateManifest(loadFixture('invalid-missing-fields')), 'INVALID_VERSION_FORMAT')).toBe(true);
    });

    it('reports INVALID_GDD for schema that is not an object', () => {
        expect(hasCode(validateManifest(loadFixture('invalid-missing-fields')), 'INVALID_GDD')).toBe(true);
    });
});

// ─── validateManifest: edge cases ────────────────────────────────────────────

describe('validateManifest – edge cases', () => {
    it('rejects null', () => expectInvalid(validateManifest(null)));
    it('rejects string', () => expectInvalid(validateManifest('not-an-object')));
    it('rejects array', () => expectInvalid(validateManifest([])));
    it('rejects empty object', () => expectInvalid(validateManifest({})));

    it('accepts manifest without optional version', () => {
        expectValid(validateManifest(validManifest()));
    });

    it('emits MISSING_GDD info when schema is absent', () => {
        const result = validateManifest(validManifest());
        expect(hasCode(result, 'MISSING_GDD')).toBe(true);
    });

    it('errors INVALID_ID when id contains a forward slash', () => {
        const result = validateManifest(validManifest({ id: 'com/example' }));
        expect(hasCode(result, 'INVALID_ID')).toBe(true);
        expectInvalid(result);
    });

    it('accepts id with spaces or unicode (spec allows anything except "/")', () => {
        const result = validateManifest(validManifest({ id: 'my graphic! 🎬' }));
        expect(hasCode(result, 'INVALID_ID')).toBe(false);
        expectValid(result);
    });

    it('emits INVALID_VERSION_FORMAT info for non-semver version', () => {
        const result = validateManifest(validManifest({ version: 'v1' }));
        expect(hasCode(result, 'INVALID_VERSION_FORMAT')).toBe(true);
        // Still valid – semver is a best practice, not a spec requirement
        expectValid(result);
    });

    it('warns NO_RUNTIME_SUPPORT when both support flags are false', () => {
        const result = validateManifest(validManifest({ supportsRealTime: false, supportsNonRealTime: false }));
        expect(hasCode(result, 'NO_RUNTIME_SUPPORT')).toBe(true);
        // Should still be valid (warning only)
        expectValid(result);
    });

    it('reports MISSING_FIELD for each missing required field individually', () => {
        const result = validateManifest({});
        const missingFields = result.issues.filter((i) => i.code === 'MISSING_FIELD').map((i) => i.path);
        expect(missingFields).toContain('$schema');
        expect(missingFields).toContain('id');
        expect(missingFields).toContain('name');
        expect(missingFields).toContain('main');
        expect(missingFields).toContain('supportsRealTime');
        expect(missingFields).toContain('supportsNonRealTime');
    });

    it('reports INVALID_TYPE for boolean field given a string', () => {
        const result = validateManifest(validManifest({ supportsRealTime: 'yes' }));
        expect(hasCode(result, 'INVALID_TYPE')).toBe(true);
    });

    it('warns INVALID_SCHEMA_REF when $schema is not the official URL', () => {
        const result = validateManifest(validManifest({ $schema: 'https://example.com/other.json' }));
        expect(hasCode(result, 'INVALID_SCHEMA_REF')).toBe(true);
    });

    it('accepts the exact official $schema URL without warning', () => {
        const result = validateManifest(validManifest());
        expect(hasCode(result, 'INVALID_SCHEMA_REF')).toBe(false);
    });
});

// ─── Optional fields ──────────────────────────────────────────────────────────

describe('validateManifest – optional fields', () => {
    it('validates author object with string fields', () => {
        const result = validateManifest(validManifest({
            author: { name: 'Alice', email: 'a@example.com', url: 'https://example.com' },
        }));
        expectValid(result);
    });

    it('errors when author.name is not a string', () => {
        const result = validateManifest(validManifest({ author: { name: 123 } }));
        expect(hasCode(result, 'INVALID_TYPE')).toBe(true);
        expectInvalid(result);
    });

    it('errors when author is not an object', () => {
        const result = validateManifest(validManifest({ author: 'Alice' }));
        expect(hasCode(result, 'INVALID_AUTHOR')).toBe(true);
    });

    it('errors when description is not a string', () => {
        const result = validateManifest(validManifest({ description: 42 }));
        expect(hasCode(result, 'INVALID_TYPE')).toBe(true);
    });

    it('accepts valid customActions array', () => {
        const result = validateManifest(validManifest({
            customActions: [{ id: 'highlight', name: 'Highlight' }],
        }));
        expectValid(result);
    });

    it('errors when customActions is not an array', () => {
        const result = validateManifest(validManifest({ customActions: {} }));
        expect(hasCode(result, 'INVALID_CUSTOM_ACTIONS')).toBe(true);
    });

    it('errors when a customAction is missing id or name', () => {
        const result = validateManifest(validManifest({
            customActions: [{ name: 'No id' }, { id: 'noname' }],
        }));
        expect(hasCode(result, 'INVALID_CUSTOM_ACTION')).toBe(true);
    });

    it('errors on duplicate customAction ids', () => {
        const result = validateManifest(validManifest({
            customActions: [
                { id: 'dup', name: 'One' },
                { id: 'dup', name: 'Two' },
            ],
        }));
        expect(hasCode(result, 'DUPLICATE_CUSTOM_ACTION_ID')).toBe(true);
    });

    it('accepts valid stepCount values', () => {
        expectValid(validateManifest(validManifest({ stepCount: -1 })));
        expectValid(validateManifest(validManifest({ stepCount: 0 })));
        expectValid(validateManifest(validManifest({ stepCount: 5 })));
    });

    it('errors when stepCount is not an integer', () => {
        const result = validateManifest(validManifest({ stepCount: 1.5 }));
        expect(hasCode(result, 'INVALID_TYPE')).toBe(true);
    });

    it('errors when stepCount < -1', () => {
        const result = validateManifest(validManifest({ stepCount: -5 }));
        expect(hasCode(result, 'INVALID_STEP_COUNT')).toBe(true);
    });

    it('errors when renderRequirements is not an array', () => {
        const result = validateManifest(validManifest({ renderRequirements: {} }));
        expect(hasCode(result, 'INVALID_RENDER_REQUIREMENTS')).toBe(true);
    });

    it('accepts a basic renderRequirements array', () => {
        expectValid(validateManifest(validManifest({
            renderRequirements: [{ resolution: { width: { exact: 1920 }, height: { exact: 1080 } } }],
        })));
    });
});

// ─── GDD schema validation ────────────────────────────────────────────────────

describe('validateManifest – GDD schema', () => {
    it('validates GDD schema type must be object', () => {
        const result = validateManifest(validManifest({ schema: { type: 'array', properties: {} } }));
        expect(hasCode(result, 'INVALID_GDD_TYPE')).toBe(true);
    });

    it('requires GDD schema to have properties', () => {
        const result = validateManifest(validManifest({ schema: { type: 'object' } }));
        expect(hasCode(result, 'MISSING_GDD_PROPERTIES')).toBe(true);
    });

    it('emits MISSING_GDD_TYPE info for fields without gddType', () => {
        const result = validateManifest(validManifest({
            schema: { type: 'object', properties: { headline: { type: 'string' } } },
        }));
        expect(hasCode(result, 'MISSING_GDD_TYPE')).toBe(true);
    });

    it('accepts valid GDD schema with gddType on all fields', () => {
        const result = validateManifest(validManifest({
            schema: { type: 'object', properties: { headline: { type: 'string', gddType: 'single-line' } } },
        }));
        expect(hasCode(result, 'MISSING_GDD_TYPE')).toBe(false);
        expect(hasCode(result, 'INVALID_GDD')).toBe(false);
    });
});

// ─── validatePackage: asset checks ───────────────────────────────────────────

describe('validatePackage – asset checks', () => {
    it('valid-basic: main file exists', async () => {
        const manifest = loadFixture('valid-basic');
        const result = await validatePackage(manifest, nodeFs(join(FIXTURES_DIR, 'valid-basic')));
        expectValid(result);
    });

    it('valid-realtime: main file exists', async () => {
        const manifest = loadFixture('valid-realtime');
        const result = await validatePackage(manifest, nodeFs(join(FIXTURES_DIR, 'valid-realtime')));
        expectValid(result);
    });

    it('reports MISSING_ASSET when main points to non-existent file', async () => {
        const manifest = validManifest({ main: 'does-not-exist.mjs' });
        const result = await validatePackage(manifest, nodeFs(join(FIXTURES_DIR, 'valid-basic')));
        expect(hasCode(result, 'MISSING_ASSET')).toBe(true);
    });
});

// ─── ValidationResult structure ───────────────────────────────────────────────

describe('ValidationResult structure', () => {
    it('errors array only contains severity=error issues', () => {
        const result = validateManifest(loadFixture('invalid-missing-fields'));
        expect(result.errors.every((i) => i.severity === 'error')).toBe(true);
    });

    it('warnings array only contains severity=warning issues', () => {
        const result = validateManifest(loadFixture('invalid-missing-fields'));
        expect(result.warnings.every((i) => i.severity === 'warning')).toBe(true);
    });

    it('every issue has code, message and severity', () => {
        const result = validateManifest(loadFixture('invalid-missing-fields'));
        for (const issue of result.issues) {
            expect(issue.code).toBeTruthy();
            expect(issue.message).toBeTruthy();
            expect(['error', 'warning', 'info']).toContain(issue.severity);
        }
    });
});
