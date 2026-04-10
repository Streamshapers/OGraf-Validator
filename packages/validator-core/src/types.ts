/**
 * Core type definitions for the ograf validator.
 * Based on the EBU ograf v1 specification: https://ograf.ebu.io/v1/specification/docs/Specification.html
 */

// ─── Manifest Types ───────────────────────────────────────────────────────────

export interface OgrafManifest {
    /** URL to the ograf JSON schema – required */
    $schema: string;
    /** Unique identifier for the graphic package (any chars except `/`) */
    id: string;
    /** Display name */
    name: string;
    /** Path to the Web Component JS entry point (e.g. "graphic.mjs") */
    main: string;
    /** Whether the graphic supports real-time rendering */
    supportsRealTime: boolean;
    /** Whether the graphic supports non-real-time rendering */
    supportsNonRealTime: boolean;
    /** Version descriptor (no specific format required by spec) */
    version?: string;
    description?: string;
    author?: OgrafAuthor;
    /** Custom actions exposed by the graphic */
    customActions?: OgrafCustomAction[];
    /** Number of steps: -1 (dynamic), 0 (none), undefined/1 (single), >1 (multiple) */
    stepCount?: number;
    /** Render environment requirements (at least one must be satisfied) */
    renderRequirements?: OgrafRenderRequirement[];
    /** GDD schema for the graphic's data properties */
    schema?: GddSchema;
}

export interface OgrafAuthor {
    name?: string;
    email?: string;
    url?: string;
}

export interface OgrafCustomAction {
    id: string;
    name: string;
    description?: string;
    schema?: GddSchema;
}

export interface OgrafRenderRequirement {
    resolution?: {
        width?: OgrafNumberConstraint;
        height?: OgrafNumberConstraint;
    };
    frameRate?: OgrafNumberConstraint;
    accessToPublicInternet?: OgrafBooleanConstraint;
}

export interface OgrafNumberConstraint {
    max?: number;
    min?: number;
    exact?: number;
    ideal?: number;
}

export interface OgrafBooleanConstraint {
    exact?: boolean;
    ideal?: boolean;
}

// ─── GDD (Graphics Data Definition) Types ────────────────────────────────────

export type GddFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

export interface GddValidValue {
    value: unknown;
    label: string;
}

export interface GddField {
    type?: GddFieldType;
    /** Human-readable label (ograf v1 uses "label" instead of "title") */
    label?: string;
    title?: string;
    description?: string;
    default?: unknown;
    enum?: unknown[];
    /** GDD field type hint (ograf v1: "gddType", e.g. "single-line", "dropdown") */
    gddType?: string;
    validValues?: GddValidValue[];
    // Nested
    properties?: Record<string, GddField>;
    items?: GddField;
}

export interface GddSchema {
    $schema?: string;
    type: 'object';
    title?: string;
    description?: string;
    properties: Record<string, GddField>;
    required?: string[];
}

// ─── Validation Result Types ──────────────────────────────────────────────────

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
    severity: ValidationSeverity;
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

// ─── File System Abstraction ──────────────────────────────────────────────────

export interface VirtualFS {
    readFile(path: string): Promise<string>;
    fileExists(path: string): Promise<boolean>;
    listFiles(path?: string): Promise<string[]>;
}
