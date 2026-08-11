/**
 * @streamshapers/ograf-validator-core
 *
 * Validates ograf Graphics Package manifests against the EBU ograf v1 spec.
 * Usable in browser (with File System Access API) and Node.js (CI/CD).
 *
 * @see https://ograf.ebu.io/v1/specification/docs/Specification.html
 * @see https://github.com/Streamshapers/OGraf-Validator
 */

export { validateManifest, validatePackage } from './validate.js';
export type {
    OgrafManifest,
    OgrafVendorExtensions,
    OgrafAuthor,
    OgrafCustomAction,
    OgrafActionDuration,
    OgrafActionStepDuration,
    OgrafPlayActionDuration,
    OgrafUpdateActionDuration,
    OgrafStopActionDuration,
    OgrafCustomActionDuration,
    OgrafRenderRequirement,
    OgrafResolutionRequirement,
    OgrafEngineRequirement,
    OgrafEngineVersionRequirement,
    OgrafNumberConstraint,
    OgrafBooleanConstraint,
    OgrafThumbnail,
    OgrafThumbnailResolution,
    GddSchema,
    GddField,
    GddFieldType,
    GddOptions,
    GddValidValue,
    ValidationIssue,
    ValidationIssueCode,
    ValidationResult,
    ValidationSeverity,
    VirtualFS,
} from './types.js';
