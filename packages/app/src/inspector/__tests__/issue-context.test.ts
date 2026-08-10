import { describe, expect, it } from 'vitest';
import type { ValidationIssue, ValidationResult } from '@streamshapers/ograf-validator-core';
import { classifyInspectorIssue, groupInspectorIssues } from '../issue-context.js';

function issue(code: string, path?: string): ValidationIssue {
    return {
        severity: 'error',
        code,
        message: code,
        ...(path ? { path } : {}),
    };
}

describe('Inspector issue context', () => {
    it.each([
        ['INVALID_STEP_COUNT', 'stepCount', 'capabilities'],
        ['INVALID_RENDER_REQUIREMENT', 'renderRequirements[0].frameRate', 'render'],
        ['INVALID_GDD', 'schema.properties.title', 'data'],
        ['INVALID_CUSTOM_ACTION', 'customActions[0].schema', 'actions'],
        ['MISSING_DEFAULT_ASSET', 'schema.properties.logo.default', 'assets'],
        ['INVALID_THUMBNAIL', 'thumbnails[0].file', 'assets'],
        ['UNKNOWN_FIELD', 'author.extra', 'manifest'],
    ] as const)('maps %s at %s to %s', (code, path, area) => {
        expect(classifyInspectorIssue(issue(code, path))).toBe(area);
    });

    it('keeps only useful Inspector findings', () => {
        const errors = [issue('MISSING_ASSET', 'main')];
        const infos = [
            { ...issue('MISSING_GDD', 'schema'), severity: 'info' as const },
            { ...issue('PACKAGE_FILE_COUNT'), severity: 'info' as const },
        ];
        const result: ValidationResult = {
            valid: false,
            errors,
            warnings: [],
            infos,
            issues: [...errors, ...infos],
        };

        const groups = groupInspectorIssues(result);
        expect(groups.assets).toEqual(errors);
        expect(groups.data).toEqual([infos[0]]);
        expect(Object.values(groups).flat()).not.toContainEqual(infos[1]);
    });
});
