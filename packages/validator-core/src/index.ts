/**
 * @streamshapers/ograf-validator-core
 *
 * Validates ograf Graphics Package manifests against the EBU ograf v1 spec.
 * Usable in browser (with File System Access API) and Node.js (CI/CD).
 *
 * @see https://ograf.ebu.io/v1/specification/docs/Specification.html
 * @see https://github.com/streamshapers/ograf-validator
 */

export { validateManifest, validatePackage } from './validate.js';
export type {
    OgrafManifest,
    OgrafAuthor,
    OgrafCustomAction,
    OgrafRenderRequirement,
    OgrafNumberConstraint,
    OgrafBooleanConstraint,
    GddSchema,
    GddField,
    GddFieldType,
    GddValidValue,
    ValidationIssue,
    ValidationResult,
    ValidationSeverity,
    VirtualFS,
} from './types.js';
