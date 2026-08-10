/**
 * Public validator API for the EBU OGraf v1 schema pinned at
 * d42afcedf9348e05e35b2009b04fb9552785e35b.
 */

import type { ValidationIssue, ValidationResult, VirtualFS } from './types.js';
import { validateAssets } from './package-validation.js';
import { validateManifestFields } from './manifest-validation.js';
import {
    GRAPHIC_REQUIREMENTS_SPEC_REF,
    MANIFEST_SPEC_REF,
    buildResult,
    err,
    errorMessage,
    isRecord,
} from './validation-utils.js';

export function validateManifest(manifest: unknown): ValidationResult {
    try {
        return buildResult(validateManifestFields(manifest));
    } catch (error) {
        return buildResult([err(
            'INVALID_MANIFEST',
            `Manifest could not be inspected safely: ${errorMessage(error)}`,
            undefined,
            MANIFEST_SPEC_REF,
        )]);
    }
}

export async function validatePackage(
    manifest: unknown,
    fs: VirtualFS,
    manifestFilename?: string,
): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    if (
        manifestFilename !== undefined
        && (typeof manifestFilename !== 'string' || !manifestFilename.endsWith('.ograf.json'))
    ) {
        issues.push(err(
            'INVALID_MANIFEST_FILENAME',
            `Manifest filename "${String(manifestFilename)}" must end with ".ograf.json".`,
            typeof manifestFilename === 'string' ? manifestFilename : undefined,
            MANIFEST_SPEC_REF,
        ));
    }

    issues.push(...validateManifest(manifest).issues);
    try {
        if (isRecord(manifest)) {
            issues.push(...await validateAssets(manifest, fs));
        }
    } catch (error) {
        issues.push(err(
            'FILE_ACCESS_ERROR',
            `Package files could not be inspected safely: ${errorMessage(error)}`,
            undefined,
            GRAPHIC_REQUIREMENTS_SPEC_REF,
        ));
    }

    return buildResult(issues);
}
