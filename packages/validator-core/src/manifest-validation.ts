/** Manifest and cross-field validation for the pinned EBU OGraf schema. */

import type { ValidationIssue } from './types.js';
import { validateGddRoot } from './gdd-validation.js';
import { validateAgainstPinnedSchema } from './schema-validation.js';
import {
    ACTION_DURATION_SPEC_REF,
    CUSTOM_ACTION_SPEC_REF,
    GDD_SCHEMA_URL,
    MANIFEST_FIELDS,
    MANIFEST_SPEC_REF,
    OFFICIAL_SCHEMA_URL,
    RENDER_REQUIREMENT_SPEC_REF,
    VALID_MAIN_EXTENSIONS,
    VALID_THUMBNAIL_EXTENSIONS,
    err,
    fileExtension,
    hasOwn,
    info,
    isFiniteNumber,
    isMissing,
    isRecord,
    validateRequiredFields,
    validateUnknownFields,
} from './validation-utils.js';
import type { JsonObject } from './validation-utils.js';

export function validateManifestFields(manifest: unknown): ValidationIssue[] {
    if (!isRecord(manifest)) {
        return [err('INVALID_MANIFEST', 'Manifest must be a JSON object.', undefined, MANIFEST_SPEC_REF)];
    }

    const issues: ValidationIssue[] = [];
    issues.push(...validateAgainstPinnedSchema(manifest));
    issues.push(...validateRequiredFields(manifest, [
        '$schema',
        'id',
        'name',
        'main',
        'supportsRealTime',
        'supportsNonRealTime',
    ]));

    if (!isMissing(manifest, '$schema')) {
        if (typeof manifest['$schema'] !== 'string') {
            issues.push(err('INVALID_TYPE', 'The "$schema" field must be a string.', '$schema'));
        } else if (manifest['$schema'] !== OFFICIAL_SCHEMA_URL) {
            issues.push(err(
                'INVALID_SCHEMA_REF',
                `The "$schema" field must be exactly "${OFFICIAL_SCHEMA_URL}".`,
                '$schema',
                MANIFEST_SPEC_REF,
            ));
        }
    }

    if (!isMissing(manifest, 'id')) {
        if (typeof manifest['id'] !== 'string') {
            issues.push(err('INVALID_TYPE', 'The "id" field must be a string.', 'id'));
        } else if (manifest['id'].trim() === '') {
            issues.push(err('INVALID_ID', 'The "id" field must not be empty.', 'id', MANIFEST_SPEC_REF));
        } else if (manifest['id'].includes('/')) {
            issues.push(err('INVALID_ID', 'The "id" field must not contain forward slashes ("/").', 'id', MANIFEST_SPEC_REF));
        }
    }

    validateNonEmptyManifestString(manifest, 'name', 'INVALID_NAME', issues);
    validateNonEmptyManifestString(manifest, 'main', 'INVALID_MAIN', issues);
    if (typeof manifest['main'] === 'string' && manifest['main'].trim() !== '') {
        if (!VALID_MAIN_EXTENSIONS.has(fileExtension(manifest['main']))) {
            issues.push(err(
                'UNUSUAL_MAIN_EXTENSION',
                'The OGraf main entry point must be a JavaScript module (.js or .mjs).',
                'main',
                MANIFEST_SPEC_REF,
            ));
        }
    }

    validateOptionalString(manifest, 'version', issues);
    validateOptionalString(manifest, 'description', issues);

    if (hasOwn(manifest, 'author') && manifest['author'] !== undefined && manifest['author'] !== null) {
        issues.push(...validateAuthor(manifest['author']));
    }

    let customActionIds = new Set<string>();
    if (hasOwn(manifest, 'customActions') && manifest['customActions'] !== undefined && manifest['customActions'] !== null) {
        const result = validateCustomActions(manifest['customActions']);
        issues.push(...result.issues);
        customActionIds = result.ids;
    }

    if (hasOwn(manifest, 'actionDurations') && manifest['actionDurations'] !== undefined && manifest['actionDurations'] !== null) {
        issues.push(...validateActionDurations(manifest['actionDurations'], customActionIds));
    }

    validateRequiredBoolean(manifest, 'supportsRealTime', issues);
    validateRequiredBoolean(manifest, 'supportsNonRealTime', issues);
    if (manifest['supportsRealTime'] === false && manifest['supportsNonRealTime'] === false) {
        issues.push(err(
            'NO_RUNTIME_SUPPORT',
            'At least one of "supportsRealTime" or "supportsNonRealTime" must be true.',
            'supportsRealTime',
            MANIFEST_SPEC_REF,
        ));
    }

    if (hasOwn(manifest, 'stepCount') && manifest['stepCount'] !== undefined && manifest['stepCount'] !== null) {
        const stepCount = manifest['stepCount'];
        if (!isFiniteNumber(stepCount) || !Number.isInteger(stepCount)) {
            issues.push(err('INVALID_TYPE', 'The "stepCount" field must be an integer.', 'stepCount'));
        } else if (stepCount < -1) {
            issues.push(err('INVALID_STEP_COUNT', 'The "stepCount" field must be -1 or a non-negative integer.', 'stepCount', MANIFEST_SPEC_REF));
        }
    }

    if (!hasOwn(manifest, 'schema') || manifest['schema'] === undefined) {
        issues.push(info(
            'MISSING_GDD',
            'No GDD "schema" is defined. Adding one enables data validation and UI tooling support.',
            'schema',
            GDD_SCHEMA_URL,
        ));
    } else {
        issues.push(...validateGddRoot(manifest['schema'], 'schema'));
    }

    if (hasOwn(manifest, 'renderRequirements') && manifest['renderRequirements'] !== undefined && manifest['renderRequirements'] !== null) {
        issues.push(...validateRenderRequirements(manifest['renderRequirements']));
    }
    if (hasOwn(manifest, 'thumbnails') && manifest['thumbnails'] !== undefined && manifest['thumbnails'] !== null) {
        issues.push(...validateThumbnails(manifest['thumbnails']));
    }

    issues.push(...validateUnknownFields(manifest, MANIFEST_FIELDS, '', MANIFEST_SPEC_REF));
    return deduplicateIssues(issues);
}

function validateNonEmptyManifestString(
    manifest: JsonObject,
    field: 'name' | 'main',
    emptyCode: 'INVALID_NAME' | 'INVALID_MAIN',
    issues: ValidationIssue[],
): void {
    if (isMissing(manifest, field)) return;
    const value = manifest[field];
    if (typeof value !== 'string') {
        issues.push(err('INVALID_TYPE', `The "${field}" field must be a string.`, field));
    } else if (value.trim() === '') {
        issues.push(err(emptyCode, `The "${field}" field must not be empty.`, field, MANIFEST_SPEC_REF));
    }
}

function validateOptionalString(manifest: JsonObject, field: string, issues: ValidationIssue[]): void {
    const value = manifest[field];
    if (value !== undefined && value !== null && typeof value !== 'string') {
        issues.push(err('INVALID_TYPE', `The "${field}" field must be a string.`, field));
    }
}

function validateRequiredBoolean(manifest: JsonObject, field: string, issues: ValidationIssue[]): void {
    if (isMissing(manifest, field)) return;
    if (typeof manifest[field] !== 'boolean') {
        issues.push(err('INVALID_TYPE', `The "${field}" field must be a boolean.`, field));
    }
}

function validateAuthor(value: unknown): ValidationIssue[] {
    if (!isRecord(value)) {
        return [err('INVALID_AUTHOR', 'The "author" field must be an object.', 'author', MANIFEST_SPEC_REF)];
    }

    const issues: ValidationIssue[] = [];
    if (isMissing(value, 'name')) {
        issues.push(err('MISSING_AUTHOR_NAME', 'The author object requires a "name".', 'author.name', MANIFEST_SPEC_REF));
    } else if (typeof value['name'] !== 'string') {
        issues.push(err('INVALID_TYPE', 'The author "name" must be a string.', 'author.name'));
    }
    for (const key of ['email', 'url']) {
        if (value[key] !== undefined && value[key] !== null && typeof value[key] !== 'string') {
            issues.push(err('INVALID_TYPE', `The author "${key}" must be a string.`, `author.${key}`));
        }
    }
    issues.push(...validateUnknownFields(value, new Set(['name', 'email', 'url']), 'author', MANIFEST_SPEC_REF));
    return issues;
}

function validateCustomActions(value: unknown): { issues: ValidationIssue[]; ids: Set<string> } {
    const ids = new Set<string>();
    if (!Array.isArray(value)) {
        return {
            ids,
            issues: [err('INVALID_CUSTOM_ACTIONS', 'The "customActions" field must be an array.', 'customActions', CUSTOM_ACTION_SPEC_REF)],
        };
    }

    const issues: ValidationIssue[] = [];
    value.forEach((entry, index) => {
        const path = `customActions[${index}]`;
        if (!isRecord(entry)) {
            issues.push(err('INVALID_CUSTOM_ACTION', 'Each custom action must be an object.', path, CUSTOM_ACTION_SPEC_REF));
            return;
        }
        issues.push(...validateUnknownFields(entry, new Set(['id', 'name', 'description', 'schema']), path, CUSTOM_ACTION_SPEC_REF));
        for (const key of ['id', 'name'] as const) {
            const fieldValue = entry[key];
            if (typeof fieldValue !== 'string' || fieldValue.trim() === '') {
                issues.push(err('INVALID_CUSTOM_ACTION', `Custom action "${key}" must be a non-empty string.`, `${path}.${key}`, CUSTOM_ACTION_SPEC_REF));
            }
        }
        if (typeof entry['id'] === 'string' && entry['id'].trim() !== '') {
            if (ids.has(entry['id'])) {
                issues.push(err('DUPLICATE_CUSTOM_ACTION_ID', `Duplicate custom action id "${entry['id']}".`, `${path}.id`, CUSTOM_ACTION_SPEC_REF));
            } else {
                ids.add(entry['id']);
            }
        }
        if (entry['description'] !== undefined && entry['description'] !== null && typeof entry['description'] !== 'string') {
            issues.push(err('INVALID_CUSTOM_ACTION', 'Custom action "description" must be a string.', `${path}.description`, CUSTOM_ACTION_SPEC_REF));
        }
        if (entry['schema'] !== undefined && entry['schema'] !== null) {
            issues.push(...validateGddRoot(entry['schema'], `${path}.schema`));
        }
    });
    return { issues, ids };
}

function validateActionDurations(value: unknown, customActionIds: ReadonlySet<string>): ValidationIssue[] {
    if (!Array.isArray(value)) {
        return [err('INVALID_ACTION_DURATION', 'The "actionDurations" field must be an array.', 'actionDurations', ACTION_DURATION_SPEC_REF)];
    }

    const issues: ValidationIssue[] = [];
    const seenBuiltIns = new Set<string>();
    const seenCustomActions = new Set<string>();
    value.forEach((entry, index) => {
        const path = `actionDurations[${index}]`;
        if (!isRecord(entry)) {
            issues.push(err('INVALID_ACTION_DURATION', 'Action durations must be objects.', path, ACTION_DURATION_SPEC_REF));
            return;
        }

        const type = entry['type'];
        const allowed = type === 'playAction'
            ? new Set(['type', 'duration', 'steps'])
            : type === 'customAction'
                ? new Set(['type', 'duration', 'customActionId'])
                : new Set(['type', 'duration']);
        issues.push(...validateUnknownFields(entry, allowed, path, ACTION_DURATION_SPEC_REF));

        if (isMissing(entry, 'type')) {
            issues.push(err('MISSING_FIELD', 'Action duration "type" is required.', `${path}.type`, ACTION_DURATION_SPEC_REF));
        } else if (typeof type !== 'string' || !['playAction', 'updateAction', 'stopAction', 'customAction'].includes(type)) {
            issues.push(err('INVALID_ACTION_DURATION', 'Action duration has an unsupported "type".', `${path}.type`, ACTION_DURATION_SPEC_REF));
        }
        validateDurationValue(entry, `${path}.duration`, issues);

        if (type === 'playAction' || type === 'updateAction' || type === 'stopAction') {
            if (seenBuiltIns.has(type)) {
                issues.push(err('DUPLICATE_ACTION_DURATION', `Only one ${type} duration entry is allowed.`, `${path}.type`, ACTION_DURATION_SPEC_REF));
            } else {
                seenBuiltIns.add(type);
            }
        }
        if (type === 'playAction' && entry['steps'] !== undefined && entry['steps'] !== null) {
            issues.push(...validateActionStepDurations(entry['steps'], `${path}.steps`));
        }
        if (type === 'customAction') {
            const id = entry['customActionId'];
            if (isMissing(entry, 'customActionId')) {
                issues.push(err('MISSING_FIELD', 'A customAction duration requires "customActionId".', `${path}.customActionId`, ACTION_DURATION_SPEC_REF));
            } else if (typeof id !== 'string' || id.trim() === '') {
                issues.push(err('INVALID_ACTION_DURATION', 'The "customActionId" field must be a non-empty string.', `${path}.customActionId`, ACTION_DURATION_SPEC_REF));
            } else {
                if (seenCustomActions.has(id)) {
                    issues.push(err('DUPLICATE_ACTION_DURATION', `Only one duration entry is allowed for custom action "${id}".`, `${path}.customActionId`, ACTION_DURATION_SPEC_REF));
                } else {
                    seenCustomActions.add(id);
                }
                if (!customActionIds.has(id)) {
                    issues.push(err('UNKNOWN_CUSTOM_ACTION_DURATION', `Custom action "${id}" is not declared in customActions.`, `${path}.customActionId`, ACTION_DURATION_SPEC_REF));
                }
            }
        }
    });
    return issues;
}

function validateDurationValue(entry: JsonObject, path: string, issues: ValidationIssue[]): void {
    if (isMissing(entry, 'duration')) {
        issues.push(err('MISSING_FIELD', 'Action duration requires "duration".', path, ACTION_DURATION_SPEC_REF));
        return;
    }
    const value = entry['duration'];
    if (!isFiniteNumber(value) || !Number.isInteger(value) || value < -1) {
        issues.push(err('INVALID_ACTION_DURATION', 'Duration must be an integer greater than or equal to -1.', path, ACTION_DURATION_SPEC_REF));
    }
}

function validateActionStepDurations(value: unknown, path: string): ValidationIssue[] {
    if (!Array.isArray(value)) {
        return [err('INVALID_ACTION_DURATION', 'Play action "steps" must be an array.', path, ACTION_DURATION_SPEC_REF)];
    }
    const issues: ValidationIssue[] = [];
    const seenSteps = new Set<number>();
    let seenFallback = false;
    value.forEach((entry, index) => {
        const itemPath = `${path}[${index}]`;
        if (!isRecord(entry)) {
            issues.push(err('INVALID_ACTION_DURATION', 'Step duration must be an object.', itemPath, ACTION_DURATION_SPEC_REF));
            return;
        }
        issues.push(...validateUnknownFields(entry, new Set(['step', 'duration']), itemPath, ACTION_DURATION_SPEC_REF));
        validateDurationValue(entry, `${itemPath}.duration`, issues);
        if (entry['step'] === undefined || entry['step'] === null) {
            if (seenFallback) {
                issues.push(err('DUPLICATE_ACTION_DURATION', 'Only one fallback step duration is allowed.', itemPath, ACTION_DURATION_SPEC_REF));
            }
            seenFallback = true;
        } else if (!isFiniteNumber(entry['step']) || !Number.isInteger(entry['step']) || entry['step'] < 0) {
            issues.push(err('INVALID_ACTION_DURATION', 'Step must be a non-negative integer.', `${itemPath}.step`, ACTION_DURATION_SPEC_REF));
        } else if (seenSteps.has(entry['step'])) {
            issues.push(err('DUPLICATE_ACTION_DURATION', `Duplicate duration for step ${entry['step']}.`, `${itemPath}.step`, ACTION_DURATION_SPEC_REF));
        } else {
            seenSteps.add(entry['step']);
        }
    });
    return issues;
}

function validateRenderRequirements(value: unknown): ValidationIssue[] {
    if (!Array.isArray(value)) {
        return [err('INVALID_RENDER_REQUIREMENT', 'The "renderRequirements" field must be an array.', 'renderRequirements', RENDER_REQUIREMENT_SPEC_REF)];
    }
    const issues: ValidationIssue[] = [];
    value.forEach((requirement, index) => {
        const path = `renderRequirements[${index}]`;
        if (!isRecord(requirement)) {
            issues.push(err('INVALID_RENDER_REQUIREMENT', 'Render requirements must be objects.', path, RENDER_REQUIREMENT_SPEC_REF));
            return;
        }
        issues.push(...validateUnknownFields(requirement, new Set(['resolution', 'frameRate', 'accessToPublicInternet', 'engine']), path, RENDER_REQUIREMENT_SPEC_REF));
        if (isRecord(requirement['resolution'])) {
            issues.push(...validateUnknownFields(
                requirement['resolution'],
                new Set(['width', 'height']),
                `${path}.resolution`,
                RENDER_REQUIREMENT_SPEC_REF,
            ));
            validateNumberConstraint(requirement['resolution']['width'], `${path}.resolution.width`, issues);
            validateNumberConstraint(requirement['resolution']['height'], `${path}.resolution.height`, issues);
        }
        validateNumberConstraint(requirement['frameRate'], `${path}.frameRate`, issues);
        if (Array.isArray(requirement['engine'])) {
            requirement['engine'].forEach((engine, engineIndex) => {
                if (!isRecord(engine)) return;
                const enginePath = `${path}.engine[${engineIndex}]`;
                issues.push(...validateUnknownFields(engine, new Set(['type', 'version']), enginePath, RENDER_REQUIREMENT_SPEC_REF));
                if (typeof engine['type'] === 'string' && engine['type'].trim() === '') {
                    issues.push(err('INVALID_RENDER_REQUIREMENT', 'Engine "type" must not be empty.', `${enginePath}.type`, RENDER_REQUIREMENT_SPEC_REF));
                }
                if (isRecord(engine['version'])) {
                    issues.push(...validateUnknownFields(
                        engine['version'],
                        new Set(['min']),
                        `${enginePath}.version`,
                        RENDER_REQUIREMENT_SPEC_REF,
                    ));
                    if (typeof engine['version']['min'] === 'string' && engine['version']['min'].trim() === '') {
                        issues.push(err(
                            'INVALID_RENDER_REQUIREMENT',
                            'Engine "version.min" must not be empty.',
                            `${enginePath}.version.min`,
                            RENDER_REQUIREMENT_SPEC_REF,
                        ));
                    }
                }
            });
        }
    });
    return issues;
}

function validateNumberConstraint(value: unknown, path: string, issues: ValidationIssue[]): void {
    if (!isRecord(value)) return;
    const min = value['min'];
    const max = value['max'];
    if (isFiniteNumber(min) && isFiniteNumber(max) && min > max) {
        issues.push(err('INVALID_RENDER_REQUIREMENT', 'Constraint "min" must not exceed "max".', path, RENDER_REQUIREMENT_SPEC_REF));
    }
}

function validateThumbnails(value: unknown): ValidationIssue[] {
    if (!Array.isArray(value)) {
        return [err('INVALID_THUMBNAIL', 'The "thumbnails" field must be an array.', 'thumbnails', MANIFEST_SPEC_REF)];
    }
    const issues: ValidationIssue[] = [];
    value.forEach((thumbnail, index) => {
        const path = `thumbnails[${index}]`;
        if (!isRecord(thumbnail)) {
            issues.push(err('INVALID_THUMBNAIL', 'Thumbnail entries must be objects.', path, MANIFEST_SPEC_REF));
            return;
        }
        issues.push(...validateUnknownFields(thumbnail, new Set(['file', 'resolution']), path, MANIFEST_SPEC_REF));
        if (typeof thumbnail['file'] === 'string' && !VALID_THUMBNAIL_EXTENSIONS.has(fileExtension(thumbnail['file']))) {
            issues.push(err('INVALID_THUMBNAIL', 'Thumbnail must use PNG, JPG, GIF, or WebP.', `${path}.file`, MANIFEST_SPEC_REF));
        }
        if (isRecord(thumbnail['resolution'])) {
            issues.push(...validateUnknownFields(
                thumbnail['resolution'],
                new Set(['width', 'height']),
                `${path}.resolution`,
                MANIFEST_SPEC_REF,
            ));
        }
    });
    return issues;
}

function deduplicateIssues(issues: ValidationIssue[]): ValidationIssue[] {
    const seen = new Set<string>();
    return issues.filter((entry) => {
        const key = `${entry.code}|${entry.path ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
