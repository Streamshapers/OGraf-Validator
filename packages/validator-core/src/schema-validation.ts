/** Maps the generated Ajv 2020-12 validator output to the public issue model. */

import validatePinnedManifest from './generated/ograf-manifest-validator.js';
import type { ValidationIssue, ValidationIssueCode } from './types.js';
import {
    ACTION_DURATION_SPEC_REF,
    GDD_SCHEMA_URL,
    MANIFEST_SPEC_REF,
    OFFICIAL_SCHEMA_URL,
    RENDER_REQUIREMENT_SPEC_REF,
    err,
    isRecord,
} from './validation-utils.js';

interface StandaloneSchemaError {
    instancePath: string;
    keyword: string;
    message?: string;
    params: Record<string, unknown>;
    schemaPath: string;
}

interface StandaloneValidator {
    (value: unknown): boolean;
    errors?: StandaloneSchemaError[] | null;
}

const validator = validatePinnedManifest as StandaloneValidator;

export function validateAgainstPinnedSchema(value: unknown): ValidationIssue[] {
    if (cannotSafelyTraverse(value)) return [];

    try {
        if (validator(value)) return [];
        return normalizeSchemaErrors(validator.errors ?? [], value).map(mapSchemaError);
    } catch {
        // Hand-written validation reports the context-specific issue. Skipping
        // Ajv here keeps arbitrary object graphs from escaping as exceptions.
        return [];
    }
}

// These branch indices follow the pinned, generated schema. Snapshot regression
// tests cover every discriminant so schema upgrades cannot silently change them.
const ACTION_DURATION_BRANCHES = ['playAction', 'updateAction', 'stopAction', 'customAction'];

function normalizeSchemaErrors(
    errors: StandaloneSchemaError[],
    manifest: unknown,
): StandaloneSchemaError[] {
    const relevant: StandaloneSchemaError[] = [];
    for (const error of errors) {
        const actionIndex = /^\/actionDurations\/(\d+)(?:\/|$)/u.exec(error.instancePath)?.[1];
        if (actionIndex !== undefined && isRecord(manifest) && Array.isArray(manifest['actionDurations'])) {
            const action = manifest['actionDurations'][Number(actionIndex)] as unknown;
            const branch = /^#\/properties\/actionDurations\/items\/oneOf\/(\d+)(?:\/|$)/u
                .exec(error.schemaPath)?.[1];
            const selected = isRecord(action) ? ACTION_DURATION_BRANCHES.indexOf(String(action['type'])) : 0;
            if (branch !== undefined && Number(branch) !== selected) continue;
            if (selected === -1 && error.keyword === 'oneOf') {
                const missing = isRecord(action) && action['type'] === undefined;
                relevant.push({
                    ...error,
                    instancePath: `/actionDurations/${actionIndex}${missing ? '' : '/type'}`,
                    keyword: missing ? 'required' : 'enum',
                    params: missing ? { missingProperty: 'type' } : { allowedValues: ACTION_DURATION_BRANCHES },
                    message: missing ? 'must have required property \'type\'' : 'has an unsupported action type',
                });
                continue;
            }
        }

        const customSchema = /^\/customActions\/(\d+)\/schema(?:\/|$)/u.exec(error.instancePath);
        if (customSchema && isRecord(manifest) && Array.isArray(manifest['customActions'])) {
            const action = manifest['customActions'][Number(customSchema[1])] as unknown;
            if (isRecord(action)) {
                const schema = action['schema'];
                if (isRecord(schema) && /\/properties\/schema\/oneOf\/1(?:\/|$)/u.test(error.schemaPath)) {
                    continue;
                }
            }
        }
        relevant.push(error);
    }

    // Ajv emits summary failures after leaf failures for conditional and union
    // schemas. Keep a fallback summary only if it is the sole explanation.
    const summaries = new Set(['if', 'oneOf', 'anyOf']);
    return relevant.filter((error) => {
        if ((error.keyword === 'const' || error.keyword === 'enum')
            && relevant.some((candidate) => candidate.keyword === 'type'
                && candidate.instancePath === error.instancePath)) return false;
        return !summaries.has(error.keyword) || !relevant.some((candidate) =>
            !summaries.has(candidate.keyword)
            && (candidate.instancePath === error.instancePath
                || candidate.instancePath.startsWith(`${error.instancePath}/`)));
    });
}

function mapSchemaError(error: StandaloneSchemaError): ValidationIssue {
    let path = pointerToPath(error.instancePath);
    if (error.keyword === 'required' && typeof error.params['missingProperty'] === 'string') {
        path = appendPath(path, error.params['missingProperty']);
    } else if (error.keyword === 'additionalProperties' && typeof error.params['additionalProperty'] === 'string') {
        path = appendPath(path, error.params['additionalProperty']);
    } else if (error.keyword === 'propertyNames' && typeof error.params['propertyName'] === 'string') {
        path = appendPath(path, error.params['propertyName']);
    }

    const code = issueCode(error, path);
    const location = path.length === 0 ? 'manifest' : path;
    return err(
        code,
        `Pinned OGraf schema rejected ${location}: ${schemaErrorDescription(error)}.`,
        path.length === 0 ? undefined : path,
        specReference(code),
    );
}

function schemaErrorDescription(error: StandaloneSchemaError): string {
    if (error.keyword === 'const') return `must equal ${JSON.stringify(error.params['allowedValue'])}`;
    if (error.keyword === 'enum' && Array.isArray(error.params['allowedValues'])) {
        return `must be one of ${error.params['allowedValues'].map((value) => JSON.stringify(value)).join(', ')}`;
    }
    return error.message ?? error.keyword;
}

function issueCode(error: StandaloneSchemaError, path: string): ValidationIssueCode {
    if (error.keyword === 'required') return 'MISSING_FIELD';
    if (error.keyword === 'additionalProperties' || error.keyword === 'propertyNames') return 'UNKNOWN_FIELD';
    if (path === '$schema' && error.keyword === 'const') return 'INVALID_SCHEMA_REF';
    if (path === 'stepCount' && error.keyword === 'minimum') return 'INVALID_STEP_COUNT';
    if (isGddPath(path)) return 'INVALID_GDD';
    if (path === 'actionDurations' || path.startsWith('actionDurations[')) return 'INVALID_ACTION_DURATION';
    if (path === 'thumbnails' || path.startsWith('thumbnails[')) return 'INVALID_THUMBNAIL';
    if (path === 'renderRequirements' || path.startsWith('renderRequirements[')) return 'INVALID_RENDER_REQUIREMENT';
    if (path === 'customActions') return 'INVALID_CUSTOM_ACTIONS';
    if (path.startsWith('customActions[')) return 'INVALID_CUSTOM_ACTION';
    return path.length === 0 ? 'INVALID_MANIFEST' : 'INVALID_TYPE';
}

function isGddPath(path: string): boolean {
    return path === 'schema'
        || path.startsWith('schema.')
        || /^customActions\[\d+\]\.schema(?:\.|$)/u.test(path);
}

function specReference(code: ValidationIssueCode): string {
    if (code === 'INVALID_GDD') return GDD_SCHEMA_URL;
    if (code === 'INVALID_ACTION_DURATION') return ACTION_DURATION_SPEC_REF;
    if (code === 'INVALID_RENDER_REQUIREMENT') return RENDER_REQUIREMENT_SPEC_REF;
    if (code === 'INVALID_TYPE' || code === 'MISSING_FIELD' || code === 'UNKNOWN_FIELD') return OFFICIAL_SCHEMA_URL;
    return MANIFEST_SPEC_REF;
}

function pointerToPath(pointer: string): string {
    if (pointer.length === 0) return '';
    const segments = pointer
        .split('/')
        .slice(1)
        .map((segment) => segment.replace(/~1/gu, '/').replace(/~0/gu, '~'));
    let result = '';
    for (const segment of segments) {
        result = appendPath(result, segment);
    }
    return result;
}

function appendPath(base: string, segment: string): string {
    if (/^\d+$/u.test(segment)) return `${base}[${segment}]`;
    return base.length === 0 ? segment : `${base}.${segment}`;
}

function cannotSafelyTraverse(value: unknown): boolean {
    const stack = new WeakSet<object>();
    const visited = new WeakSet<object>();

    function inspect(current: unknown, depth: number): boolean {
        if (typeof current !== 'object' || current === null) return false;
        if (depth > 150) return true;
        if (stack.has(current)) return true;
        if (visited.has(current)) return false;
        stack.add(current);
        try {
            const children = Array.isArray(current) ? current : Object.values(current);
            for (const child of children) {
                if (inspect(child, depth + 1)) return true;
            }
        } finally {
            stack.delete(current);
            visited.add(current);
        }
        return false;
    }

    return inspect(value, 0);
}
