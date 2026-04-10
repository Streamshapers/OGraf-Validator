/**
 * Core manifest validation logic for ograf v1.
 * Spec: https://ograf.ebu.io/v1/specification/docs/Specification.html
 */

import type {
    OgrafManifest,
    GddField,
    ValidationIssue,
    ValidationResult,
    VirtualFS,
} from './types.js';

const SPEC_URL = 'https://ograf.ebu.io/v1/specification/docs/Specification.html';
const OFFICIAL_SCHEMA_URL = 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json';

function issue(
    severity: ValidationIssue['severity'],
    code: string,
    message: string,
    path?: string,
): ValidationIssue {
    const base = { severity, code, message, specRef: SPEC_URL };

    return path !== undefined ? { ...base, path } : base;
}

function err(code: string, message: string, path?: string): ValidationIssue {
    return issue('error', code, message, path);
}

function warn(code: string, message: string, path?: string): ValidationIssue {
    return issue('warning', code, message, path);
}

function info(code: string, message: string, path?: string): ValidationIssue {
    return issue('info', code, message, path);
}

function buildResult(issues: ValidationIssue[]): ValidationResult {
    const errors = issues.filter((i) => i.severity === 'error');
    const warnings = issues.filter((i) => i.severity === 'warning');
    const infos = issues.filter((i) => i.severity === 'info');

    return { valid: errors.length === 0, issues, errors, warnings, infos };
}

// ─── Manifest-level validation ────────────────────────────────────────────────

function validateManifestFields(manifest: unknown): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
        issues.push(err('INVALID_MANIFEST', 'Manifest must be a JSON object.'));

        return issues;
    }

    const m = manifest as Record<string, unknown>;

    // Required fields
    const requiredFields: Array<keyof OgrafManifest> = [
        '$schema',
        'id',
        'name',
        'main',
        'supportsRealTime',
        'supportsNonRealTime',
    ];
    for (const field of requiredFields) {
        if (!(field in m) || m[field] === undefined || m[field] === null) {
            issues.push(err('MISSING_FIELD', `Required field "${field}" is missing.`, field));
        }
    }

    // $schema – must be the exact official URL
    if (typeof m['$schema'] === 'string') {
        if (m['$schema'] !== OFFICIAL_SCHEMA_URL) {
            issues.push(
                warn(
                    'INVALID_SCHEMA_REF',
                    `The "$schema" field should be exactly "${OFFICIAL_SCHEMA_URL}".`,
                    '$schema',
                ),
            );
        }
    } else if ('$schema' in m && m['$schema'] !== null && m['$schema'] !== undefined) {
        issues.push(err('INVALID_TYPE', 'The "$schema" field must be a string.', '$schema'));
    }

    // id – must be non-empty and must not contain "/"
    if (typeof m['id'] === 'string') {
        if (m['id'].trim() === '') {
            issues.push(err('INVALID_ID', 'The "id" field must not be empty.', 'id'));
        } else if (m['id'].includes('/')) {
            issues.push(err('INVALID_ID', 'The "id" field must not contain forward slashes ("/").', 'id'));
        }
    } else if ('id' in m) {
        issues.push(err('INVALID_TYPE', 'The "id" field must be a string.', 'id'));
    }

    // name – non-empty string
    if (typeof m['name'] === 'string') {
        if (m['name'].trim() === '') {
            issues.push(err('INVALID_NAME', 'The "name" field must not be empty.', 'name'));
        }
    } else if ('name' in m) {
        issues.push(err('INVALID_TYPE', 'The "name" field must be a string.', 'name'));
    }

    // main – non-empty string
    if (typeof m['main'] === 'string') {
        if (m['main'].trim() === '') {
            issues.push(err('INVALID_MAIN', 'The "main" field must not be empty.', 'main'));
        }
    } else if ('main' in m) {
        issues.push(err('INVALID_TYPE', 'The "main" field must be a string.', 'main'));
    }

    // supportsRealTime – boolean
    if ('supportsRealTime' in m && m['supportsRealTime'] !== null && m['supportsRealTime'] !== undefined) {
        if (typeof m['supportsRealTime'] !== 'boolean') {
            issues.push(err('INVALID_TYPE', 'The "supportsRealTime" field must be a boolean.', 'supportsRealTime'));
        }
    }

    // supportsNonRealTime – boolean
    if ('supportsNonRealTime' in m && m['supportsNonRealTime'] !== null && m['supportsNonRealTime'] !== undefined) {
        if (typeof m['supportsNonRealTime'] !== 'boolean') {
            issues.push(err('INVALID_TYPE', 'The "supportsNonRealTime" field must be a boolean.', 'supportsNonRealTime'));
        }
    }

    // Warn if both support flags are false (graphic would be unusable)
    if (m['supportsRealTime'] === false && m['supportsNonRealTime'] === false) {
        issues.push(warn(
            'NO_RUNTIME_SUPPORT',
            'Both "supportsRealTime" and "supportsNonRealTime" are false – the graphic cannot be rendered.',
            'supportsRealTime',
        ));
    }

    // version – optional string (no format enforced by spec, but semver is a common best practice)
    if (typeof m['version'] === 'string') {
        if (!/^\d+\.\d+\.\d+/.test(m['version'])) {
            issues.push(info(
                'INVALID_VERSION_FORMAT',
                `The "version" field "${m['version']}" does not follow semantic versioning (e.g. 1.0.0). This is a best practice, not a spec requirement.`,
                'version',
            ));
        }
    } else if ('version' in m && m['version'] !== null && m['version'] !== undefined) {
        issues.push(err('INVALID_TYPE', 'The "version" field must be a string.', 'version'));
    }

    // description – optional string
    if ('description' in m && m['description'] !== null && m['description'] !== undefined) {
        if (typeof m['description'] !== 'string') {
            issues.push(err('INVALID_TYPE', 'The "description" field must be a string.', 'description'));
        }
    }

    // author – optional object { name?, email?, url? } all strings
    if ('author' in m && m['author'] !== null && m['author'] !== undefined) {
        issues.push(...validateAuthor(m['author']));
    }

    // customActions – optional array of action objects
    if ('customActions' in m && m['customActions'] !== null && m['customActions'] !== undefined) {
        issues.push(...validateCustomActions(m['customActions']));
    }

    // stepCount – optional integer
    if ('stepCount' in m && m['stepCount'] !== null && m['stepCount'] !== undefined) {
        if (typeof m['stepCount'] !== 'number' || !Number.isInteger(m['stepCount'])) {
            issues.push(err('INVALID_TYPE', 'The "stepCount" field must be an integer.', 'stepCount'));
        } else if (m['stepCount'] < -1) {
            issues.push(err(
                'INVALID_STEP_COUNT',
                'The "stepCount" field must be -1 (dynamic), 0 (none), or a positive integer.',
                'stepCount',
            ));
        }
    }

    // renderRequirements – optional array of requirement objects
    if ('renderRequirements' in m && m['renderRequirements'] !== null && m['renderRequirements'] !== undefined) {
        issues.push(...validateRenderRequirements(m['renderRequirements']));
    }

    // schema (GDD – optional)
    if ('schema' in m && m['schema'] !== undefined && m['schema'] !== null) {
        issues.push(...validateGdd(m['schema'], 'schema'));
    } else {
        issues.push(info(
            'MISSING_GDD',
            'No GDD "schema" defined. Adding a schema enables data validation and UI tooling support.',
            'schema',
        ));
    }

    return issues;
}

// ─── Author validation ───────────────────────────────────────────────────────

function validateAuthor(author: unknown): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (typeof author !== 'object' || author === null || Array.isArray(author)) {
        issues.push(err('INVALID_AUTHOR', 'The "author" field must be an object.', 'author'));

        return issues;
    }

    const a = author as Record<string, unknown>;

    for (const field of ['name', 'email', 'url'] as const) {
        if (field in a && a[field] !== null && a[field] !== undefined) {
            if (typeof a[field] !== 'string') {
                issues.push(err(
                    'INVALID_TYPE',
                    `The "author.${field}" field must be a string.`,
                    `author.${field}`,
                ));
            }
        }
    }

    return issues;
}

// ─── Custom actions validation ───────────────────────────────────────────────

function validateCustomActions(actions: unknown): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!Array.isArray(actions)) {
        issues.push(err(
            'INVALID_CUSTOM_ACTIONS',
            'The "customActions" field must be an array.',
            'customActions',
        ));

        return issues;
    }

    const seenIds = new Set<string>();

    actions.forEach((action, idx) => {
        const path = `customActions[${idx}]`;

        if (typeof action !== 'object' || action === null || Array.isArray(action)) {
            issues.push(err(
                'INVALID_CUSTOM_ACTION',
                `Custom action at index ${idx} must be an object.`,
                path,
            ));

            return;
        }

        const a = action as Record<string, unknown>;

        if (typeof a['id'] !== 'string' || a['id'].trim() === '') {
            issues.push(err(
                'INVALID_CUSTOM_ACTION',
                `Custom action at index ${idx} is missing a valid "id".`,
                `${path}.id`,
            ));
        } else if (seenIds.has(a['id'])) {
            issues.push(err(
                'DUPLICATE_CUSTOM_ACTION_ID',
                `Duplicate customAction id "${a['id']}".`,
                `${path}.id`,
            ));
        } else {
            seenIds.add(a['id']);
        }

        if (typeof a['name'] !== 'string' || a['name'].trim() === '') {
            issues.push(err(
                'INVALID_CUSTOM_ACTION',
                `Custom action at index ${idx} is missing a valid "name".`,
                `${path}.name`,
            ));
        }

        if ('description' in a && a['description'] !== null && a['description'] !== undefined) {
            if (typeof a['description'] !== 'string') {
                issues.push(err(
                    'INVALID_TYPE',
                    `Custom action "description" must be a string.`,
                    `${path}.description`,
                ));
            }
        }

        if ('schema' in a && a['schema'] !== null && a['schema'] !== undefined) {
            issues.push(...validateGdd(a['schema'], `${path}.schema`));
        }
    });

    return issues;
}

// ─── Render requirements validation ──────────────────────────────────────────

function validateRenderRequirements(reqs: unknown): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!Array.isArray(reqs)) {
        issues.push(err(
            'INVALID_RENDER_REQUIREMENTS',
            'The "renderRequirements" field must be an array.',
            'renderRequirements',
        ));

        return issues;
    }

    reqs.forEach((req, idx) => {
        const path = `renderRequirements[${idx}]`;
        if (typeof req !== 'object' || req === null || Array.isArray(req)) {
            issues.push(err(
                'INVALID_RENDER_REQUIREMENTS',
                `Render requirement at index ${idx} must be an object.`,
                path,
            ));
        }
    });

    return issues;
}

// ─── GDD validation ───────────────────────────────────────────────────────────

function validateGdd(gdd: unknown, path: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (typeof gdd !== 'object' || gdd === null || Array.isArray(gdd)) {
        issues.push(err('INVALID_GDD', 'The "schema" (GDD) must be an object.', path));

        return issues;
    }

    const g = gdd as Record<string, unknown>;

    if (g['type'] !== 'object') {
        issues.push(err('INVALID_GDD_TYPE', 'GDD "schema.type" must be "object".', `${path}.type`));
    }

    if (!('properties' in g) || typeof g['properties'] !== 'object' || g['properties'] === null) {
        issues.push(err(
            'MISSING_GDD_PROPERTIES',
            'GDD "schema" must have a "properties" object.',
            `${path}.properties`,
        ));

        return issues;
    }

    const properties = g['properties'] as Record<string, unknown>;
    for (const [fieldName, fieldDef] of Object.entries(properties)) {
        issues.push(...validateGddField(fieldDef, `${path}.properties.${fieldName}`, fieldName));
    }

    return issues;
}

function validateGddField(field: unknown, path: string, fieldName: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (typeof field !== 'object' || field === null || Array.isArray(field)) {
        issues.push(err('INVALID_GDD_FIELD', `GDD field "${fieldName}" must be an object.`, path));

        return issues;
    }

    const f = field as GddField;

    if (!f.gddType) {
        issues.push(info(
            'MISSING_GDD_TYPE',
            `GDD field "${fieldName}" has no "gddType". Adding this helps UI tools render the correct input widget.`,
            `${path}.gddType`,
        ));
    }

    return issues;
}

// ─── Asset validation ─────────────────────────────────────────────────────────

async function validateAssets(manifest: OgrafManifest, fs: VirtualFS): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    if (manifest.main) {
        const exists = await fs.fileExists(manifest.main);
        if (!exists) {
            issues.push(err('MISSING_ASSET', `Main entry point not found: "${manifest.main}"`, 'main'));
        }
    }

    return issues;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function validateManifest(manifest: unknown): ValidationResult {
    return buildResult(validateManifestFields(manifest));
}

export async function validatePackage(manifest: unknown, fs: VirtualFS): Promise<ValidationResult> {
    const manifestResult = validateManifest(manifest);
    const assetIssues: ValidationIssue[] = [];

    if (
        manifestResult.valid &&
        typeof manifest === 'object' &&
        manifest !== null
    ) {
        assetIssues.push(...(await validateAssets(manifest as OgrafManifest, fs)));
    }

    return buildResult([...manifestResult.issues, ...assetIssues]);
}
