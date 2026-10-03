import { expect, it } from 'vitest';
import { locateManifestIssue } from '../manifest-location.js';

it('resolves nested array fields and preserves null as an existing value', () => {
    const manifest = { customActions: [{ schema: null }] };
    expect(locateManifestIssue(manifest, 'customActions[0].schema')).toMatchObject({
        pointer: '/customActions/0/schema', segments: ['customActions', '0', 'schema'], exists: true, value: null,
    });
});

it('locates the parent for missing fields without treating filesystem paths as manifest fields', () => {
    expect(locateManifestIssue({ author: {} }, 'author.name')).toMatchObject({ pointer: '/author', exists: false });
    expect(locateManifestIssue({}, 'main')).toMatchObject({ pointer: '', exists: false });
    expect(locateManifestIssue({ main: 'graphic.mjs' }, 'graphic.mjs')).toBeUndefined();
    expect(locateManifestIssue({ main: 'graphic.mjs' }, 'main.mjs')).toBeUndefined();
});

it('uses actual keys with pointer escaping and refuses ambiguous diagnostic paths', () => {
    expect(locateManifestIssue({ schema: { 'a/b~c': 2 } }, 'schema.a/b~c')?.pointer).toBe('/schema/a~1b~0c');
    expect(locateManifestIssue({ schema: { 'a.b': 1 } }, 'schema.a.b')?.pointer).toBe('/schema/a.b');
    for (const a of [{ b: 2 }, {}]) {
        expect(locateManifestIssue({ schema: { 'a.b': 1, a } }, 'schema.a.b')).toBeUndefined();
    }
});

it('does not follow prototype fields or navigate after reaching traversal limits', () => {
    expect(locateManifestIssue({}, '__proto__')).toBeUndefined();
    const cyclic: Record<string, unknown> = { name: 'Graphic' };
    cyclic['self'] = cyclic;
    expect(locateManifestIssue(cyclic, 'name')).toBeUndefined();
});
