/**
 * Public types for EBU OGraf v1 manifests.
 *
 * The normative schema snapshot is pinned in
 * `spec/ebu-ograf-v1-d42afced`.
 */

export interface OgrafVendorExtensions {
    [key: `v_${string}`]: unknown;
}

// ─── Manifest Types ──────────────────────────────────────────────────────────

export interface OgrafManifest extends OgrafVendorExtensions {
    $schema: string;
    id: string;
    name: string;
    main: string;
    supportsRealTime: boolean;
    supportsNonRealTime: boolean;
    version?: string;
    description?: string;
    author?: OgrafAuthor;
    customActions?: OgrafCustomAction[];
    actionDurations?: OgrafActionDuration[];
    stepCount?: number;
    renderRequirements?: OgrafRenderRequirement[];
    thumbnails?: OgrafThumbnail[];
    schema?: GddSchema;
}

export interface OgrafAuthor extends OgrafVendorExtensions {
    /** Runtime validation requires this when author is present; optional here for source compatibility. */
    name?: string;
    email?: string;
    url?: string;
}

export interface OgrafCustomAction extends OgrafVendorExtensions {
    id: string;
    name: string;
    description?: string;
    schema?: GddSchema | null;
}

export interface OgrafActionStepDuration extends OgrafVendorExtensions {
    step?: number;
    duration: number;
}

export interface OgrafPlayActionDuration extends OgrafVendorExtensions {
    type: 'playAction';
    duration: number;
    steps?: OgrafActionStepDuration[];
}

export interface OgrafUpdateActionDuration extends OgrafVendorExtensions {
    type: 'updateAction';
    duration: number;
}

export interface OgrafStopActionDuration extends OgrafVendorExtensions {
    type: 'stopAction';
    duration: number;
}

export interface OgrafCustomActionDuration extends OgrafVendorExtensions {
    type: 'customAction';
    customActionId: string;
    duration: number;
}

export type OgrafActionDuration =
    | OgrafPlayActionDuration
    | OgrafUpdateActionDuration
    | OgrafStopActionDuration
    | OgrafCustomActionDuration;

export interface OgrafRenderRequirement extends OgrafVendorExtensions {
    resolution?: OgrafResolutionRequirement;
    frameRate?: OgrafNumberConstraint;
    accessToPublicInternet?: OgrafBooleanConstraint;
    engine?: OgrafEngineRequirement[];
}

export interface OgrafResolutionRequirement extends OgrafVendorExtensions {
    width?: OgrafNumberConstraint;
    height?: OgrafNumberConstraint;
}

export interface OgrafEngineRequirement extends OgrafVendorExtensions {
    type: string;
    version: OgrafEngineVersionRequirement;
}

export interface OgrafEngineVersionRequirement extends OgrafVendorExtensions {
    min: string;
}

export interface OgrafNumberConstraint extends OgrafVendorExtensions {
    max?: number;
    min?: number;
    exact?: number;
    ideal?: number;
}

export interface OgrafBooleanConstraint extends OgrafVendorExtensions {
    exact?: boolean;
    ideal?: boolean;
}

export interface OgrafThumbnail extends OgrafVendorExtensions {
    file: string;
    resolution?: OgrafThumbnailResolution;
}

export interface OgrafThumbnailResolution extends OgrafVendorExtensions {
    width: number;
    height: number;
}

// ─── GDD (Graphics Data Definition) Types ────────────────────────────────────

export type GddFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';

/** Legacy dropdown representation retained for existing consumers. */
export interface GddValidValue {
    value: unknown;
    label: string;
}

export interface GddOptions {
    labels?: Record<string, string>;
    extensions?: string[];
    [key: string]: unknown;
}

/**
 * GDD properties are JSON Schema objects with OGraf-specific presentation
 * hints. The index signature intentionally permits standard JSON Schema
 * keywords and vendor-defined GDD extensions.
 */
export interface GddField {
    /** Runtime validation requires a supported non-null type; optional here for source compatibility. */
    type?: GddFieldType;
    label?: string;
    title?: string;
    description?: string;
    default?: unknown;
    enum?: unknown[];
    gddType?: string;
    gddOptions?: GddOptions;
    hidden?: boolean;
    order?: number;
    validValues?: GddValidValue[];
    properties?: Record<string, GddField>;
    items?: GddField;
    required?: string[];
    [key: string]: unknown;
}

export interface GddSchema extends GddField {
    type: 'object';
    properties: Record<string, GddField>;
}

// ─── Validation Result Types ─────────────────────────────────────────────────

export type ValidationSeverity = 'error' | 'warning' | 'info';

export type ValidationIssueCode =
    | 'INVALID_MANIFEST'
    | 'MISSING_FIELD'
    | 'INVALID_TYPE'
    | 'INVALID_ID'
    | 'INVALID_NAME'
    | 'INVALID_MAIN'
    | 'INVALID_AUTHOR'
    | 'MISSING_AUTHOR_NAME'
    | 'INVALID_CUSTOM_ACTIONS'
    | 'INVALID_CUSTOM_ACTION'
    | 'DUPLICATE_CUSTOM_ACTION_ID'
    | 'INVALID_ACTION_DURATION'
    | 'DUPLICATE_ACTION_DURATION'
    | 'UNKNOWN_CUSTOM_ACTION_DURATION'
    | 'INVALID_STEP_COUNT'
    | 'INVALID_RENDER_REQUIREMENTS'
    | 'INVALID_RENDER_REQUIREMENT'
    | 'INVALID_GDD'
    | 'INVALID_GDD_TYPE'
    | 'MISSING_GDD_PROPERTIES'
    | 'INVALID_GDD_FIELD'
    | 'INVALID_THUMBNAIL'
    | 'MISSING_ASSET'
    | 'MISSING_THUMBNAIL_ASSET'
    | 'INVALID_SCHEMA_REF'
    | 'NO_RUNTIME_SUPPORT'
    | 'MISSING_GDD'
    | 'UNKNOWN_FIELD'
    | 'INVALID_MANIFEST_FILENAME'
    | 'UNUSUAL_MAIN_EXTENSION'
    | 'EMPTY_PACKAGE'
    | 'LARGE_FILE'
    | 'MISSING_DEFAULT_ASSET'
    | 'PACKAGE_FILE_COUNT'
    | 'PACKAGE_TOTAL_SIZE'
    | 'FILE_ACCESS_ERROR';

export interface ValidationIssue {
    severity: ValidationSeverity;
    /** Known validator codes are exposed as ValidationIssueCode; custom consumers remain source-compatible. */
    code: string;
    message: string;
    path?: string;
    specRef?: string;
}

export interface ValidationResult {
    valid: boolean;
    issues: ValidationIssue[];
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    infos: ValidationIssue[];
}

// ─── File System Abstraction ─────────────────────────────────────────────────

export interface VirtualFS {
    readFile(path: string): Promise<string>;
    fileExists(path: string): Promise<boolean>;
    listFiles(path?: string): Promise<string[]>;
    getFileSize?(path: string): Promise<number>;
}
