/**
 * Shared internal helpers and pinned OGraf specification references.
 */

import type {
    GddFieldType,
    ValidationIssue,
    ValidationIssueCode,
    ValidationResult,
    ValidationSeverity,
} from './types.js';

export type JsonObject = Record<string, unknown>;

const SPEC_BASE_URL = 'https://ograf.ebu.io/v1/specification/docs/Specification.html';
export const MANIFEST_SPEC_REF = `${SPEC_BASE_URL}#manifest-model`;
export const ACTION_DURATION_SPEC_REF = `${SPEC_BASE_URL}#action-durations`;
export const CUSTOM_ACTION_SPEC_REF = `${SPEC_BASE_URL}#custom-actions`;
export const RENDER_REQUIREMENT_SPEC_REF = `${SPEC_BASE_URL}#renderrequirements`;
export const GRAPHIC_REQUIREMENTS_SPEC_REF = `${SPEC_BASE_URL}#requirements-for-a-graphic`;
export const GDD_SCHEMA_URL = 'https://ograf.ebu.io/v1/specification/json-schemas/gdd/object.json';
export const OFFICIAL_SCHEMA_URL = 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json';

export const VALID_MAIN_EXTENSIONS = new Set(['.js', '.mjs']);
export const VALID_THUMBNAIL_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
export const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024;
export const MAX_GDD_DEPTH = 100;

export const MANIFEST_FIELDS = new Set([
    '$schema',
    'id',
    'version',
    'name',
    'description',
    'author',
    'main',
    'customActions',
    'actionDurations',
    'supportsRealTime',
    'supportsNonRealTime',
    'schema',
    'stepCount',
    'renderRequirements',
    'thumbnails',
]);

export const GDD_FIELD_TYPES = new Set<GddFieldType>([
    'boolean',
    'string',
    'number',
    'integer',
    'array',
    'object',
]);

export function isRecord(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasOwn(object: JsonObject, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(object, key);
}

export function isMissing(object: JsonObject, key: string): boolean {
    return !hasOwn(object, key) || object[key] === undefined || object[key] === null;
}

export function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function issue(
    severity: ValidationSeverity,
    code: ValidationIssueCode,
    message: string,
    path: string | undefined,
    specRef = OFFICIAL_SCHEMA_URL,
): ValidationIssue {
    const base = { severity, code, message, specRef };

    return path === undefined ? base : { ...base, path };
}

export function err(
    code: ValidationIssueCode,
    message: string,
    path?: string,
    specRef?: string,
): ValidationIssue {
    return issue('error', code, message, path, specRef);
}

export function warn(
    code: ValidationIssueCode,
    message: string,
    path?: string,
    specRef?: string,
): ValidationIssue {
    return issue('warning', code, message, path, specRef);
}

export function info(
    code: ValidationIssueCode,
    message: string,
    path?: string,
    specRef?: string,
): ValidationIssue {
    return issue('info', code, message, path, specRef);
}

export function buildResult(issues: ValidationIssue[]): ValidationResult {
    const errors = issues.filter((entry) => entry.severity === 'error');
    const warnings = issues.filter((entry) => entry.severity === 'warning');
    const infos = issues.filter((entry) => entry.severity === 'info');

    return { valid: errors.length === 0, issues, errors, warnings, infos };
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function validateUnknownFields(
    object: JsonObject,
    allowed: ReadonlySet<string>,
    path: string,
    specRef: string,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const key of Object.keys(object)) {
        if (!allowed.has(key) && !key.startsWith('v_')) {
            const issuePath = path.length > 0 ? `${path}.${key}` : key;
            issues.push(err(
                'UNKNOWN_FIELD',
                `Unknown field "${key}". Vendor-specific fields must use the "v_" prefix.`,
                issuePath,
                specRef,
            ));
        }
    }

    return issues;
}

export function validateRequiredFields(
    object: JsonObject,
    fields: readonly string[],
    basePath = '',
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const field of fields) {
        if (isMissing(object, field)) {
            const path = basePath.length > 0 ? `${basePath}.${field}` : field;
            issues.push(err('MISSING_FIELD', `Required field "${field}" is missing.`, path));
        }
    }

    return issues;
}

export function fileExtension(path: string): string {
    const pathWithoutQuery = path.split(/[?#]/, 1)[0] ?? path;
    const lastSegment = pathWithoutQuery.split(/[\\/]/).pop() ?? '';
    const dotIndex = lastSegment.lastIndexOf('.');
    return dotIndex < 0 ? '' : lastSegment.slice(dotIndex).toLowerCase();
}
