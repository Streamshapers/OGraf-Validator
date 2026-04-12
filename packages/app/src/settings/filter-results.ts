import type { ValidationResult } from '@streamshapers/ograf-validator-core';

/**
 * Returns a new ValidationResult with issues of the given severities removed.
 * `errors` and `valid` are NEVER altered — only warnings and infos can be hidden.
 */
export function filterValidationResult(
    result: ValidationResult,
    hiddenSeverities: ReadonlySet<string>,
): ValidationResult {
    if (hiddenSeverities.size === 0) return result;

    const warnings = hiddenSeverities.has('warning') ? [] : result.warnings;
    const infos    = hiddenSeverities.has('info')    ? [] : result.infos;
    const issues   = [...result.errors, ...warnings, ...infos];

    return {
        ...result,
        issues,
        warnings,
        infos,
    };
}
