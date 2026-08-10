import type { ValidationIssue, ValidationResult } from '@streamshapers/ograf-validator-core';

export type InspectorIssueArea =
    | 'capabilities'
    | 'render'
    | 'data'
    | 'actions'
    | 'assets'
    | 'manifest';

export type InspectorIssueGroups = Record<InspectorIssueArea, ValidationIssue[]>;

const IGNORED_CODES = new Set([
    'PACKAGE_FILE_COUNT',
    'PACKAGE_TOTAL_SIZE',
]);

const ASSET_CODES = new Set([
    'EMPTY_PACKAGE',
    'FILE_ACCESS_ERROR',
    'LARGE_FILE',
    'MISSING_ASSET',
    'MISSING_DEFAULT_ASSET',
    'MISSING_THUMBNAIL_ASSET',
    'INVALID_THUMBNAIL',
]);

const ACTION_CODES = new Set([
    'DUPLICATE_ACTION_DURATION',
    'DUPLICATE_CUSTOM_ACTION_ID',
    'INVALID_ACTION_DURATION',
    'INVALID_CUSTOM_ACTION',
    'INVALID_CUSTOM_ACTIONS',
    'UNKNOWN_CUSTOM_ACTION_DURATION',
]);

const DATA_CODES = new Set([
    'INVALID_GDD',
    'INVALID_GDD_FIELD',
    'INVALID_GDD_TYPE',
    'MISSING_GDD',
    'MISSING_GDD_PROPERTIES',
]);

const RENDER_CODES = new Set([
    'INVALID_RENDER_REQUIREMENT',
    'INVALID_RENDER_REQUIREMENTS',
]);

const CAPABILITY_CODES = new Set([
    'INVALID_MAIN',
    'INVALID_STEP_COUNT',
    'NO_RUNTIME_SUPPORT',
    'UNUSUAL_MAIN_EXTENSION',
]);

export function groupInspectorIssues(result: ValidationResult): InspectorIssueGroups {
    const groups: InspectorIssueGroups = {
        capabilities: [],
        render: [],
        data: [],
        actions: [],
        assets: [],
        manifest: [],
    };

    const issues = [...result.errors, ...result.warnings, ...result.infos];
    for (const issue of issues) {
        if (IGNORED_CODES.has(issue.code)) continue;
        groups[classifyInspectorIssue(issue)].push(issue);
    }
    return groups;
}

export function classifyInspectorIssue(issue: ValidationIssue): InspectorIssueArea {
    const path = issue.path ?? '';

    if (path === 'customActions' || path.startsWith('customActions[') ||
        path === 'actionDurations' || path.startsWith('actionDurations[') ||
        ACTION_CODES.has(issue.code)) {
        return 'actions';
    }
    if (ASSET_CODES.has(issue.code) || path === 'thumbnails' || path.startsWith('thumbnails[')) {
        return 'assets';
    }
    if (path === 'schema' || path.startsWith('schema.') || DATA_CODES.has(issue.code)) {
        return 'data';
    }
    if (path === 'renderRequirements' || path.startsWith('renderRequirements[') || RENDER_CODES.has(issue.code)) {
        return 'render';
    }
    if (
        path === 'main' ||
        path === 'stepCount' ||
        path === 'supportsRealTime' ||
        path === 'supportsNonRealTime' ||
        CAPABILITY_CODES.has(issue.code)
    ) {
        return 'capabilities';
    }
    return 'manifest';
}
