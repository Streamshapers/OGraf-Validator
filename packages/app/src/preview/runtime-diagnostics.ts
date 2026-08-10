import type { RuntimeTestStep } from './runtime-test-types.js';

export interface RuntimeDiagnostic {
    code: string;
    hint: string;
}

export type RuntimeMode = 'RT' | 'NRT';

export interface RuntimeFailureOccurrence {
    mode?: RuntimeMode;
    step: RuntimeTestStep;
}

export interface RuntimeFailureGroup extends RuntimeDiagnostic {
    label: string;
    error?: string;
    occurrences: RuntimeFailureOccurrence[];
}

export function splitRuntimeStepName(name: string): { mode?: RuntimeMode; label: string } {
    const match = name.match(/^(RT|NRT):\s*(.+)$/);
    return match?.[1] && match[2]
        ? { mode: match[1] as RuntimeMode, label: match[2] }
        : { label: name };
}

/**
 * Group repeated observations of the same OGraf contract violation. The exact
 * check label and error remain part of the identity, so unrelated methods,
 * custom actions, and failures are never merged merely because they share a
 * diagnostic code.
 */
export function groupRuntimeFailures(steps: readonly RuntimeTestStep[]): RuntimeFailureGroup[] {
    const groups = new Map<string, RuntimeFailureGroup>();

    for (const step of steps) {
        if (step.status !== 'fail') continue;
        const diagnostic = diagnoseRuntimeError(step.error);
        const { mode, label } = splitRuntimeStepName(step.name);
        const error = step.error?.trim();
        const key = JSON.stringify([diagnostic.code, label, error ?? '']);
        const existing = groups.get(key);
        const occurrence: RuntimeFailureOccurrence = {
            ...(mode ? { mode } : {}),
            step,
        };

        if (existing) {
            existing.occurrences.push(occurrence);
        } else {
            groups.set(key, {
                ...diagnostic,
                label,
                ...(error ? { error } : {}),
                occurrences: [occurrence],
            });
        }
    }

    return [...groups.values()];
}

export function diagnoseRuntimeError(error?: string): RuntimeDiagnostic {
    const message = error ?? '';
    const nonVendorField = message.match(/ReturnPayload contains non-vendor field "([^"]+)"/i)?.[1];
    if (nonVendorField) {
        const quotedField = JSON.stringify(nonVendorField);
        const propertyExample = /^[A-Za-z_$][\w$]*$/.test(nonVendorField)
            ? nonVendorField
            : quotedField;
        return {
            code: 'INVALID_RETURN_PAYLOAD',
            hint: `Move ${quotedField} into result: { statusCode: 200, result: { ${propertyExample}: value } }. For playAction, keep currentStep at the top level. Use v_ only for vendor fields.`,
        };
    }
    if (/Missing required method/i.test(message)) {
        return {
            code: 'MISSING_REQUIRED_METHODS',
            hint: 'Add all required OGraf methods to the exported HTMLElement class.',
        };
    }
    if (/status\s*\d{3}|statusCode/i.test(message)) {
        return {
            code: 'ACTION_RETURNED_ERROR_STATUS',
            hint: 'For success, return undefined or a payload with a 2xx statusCode.',
        };
    }
    if (/currentStep/i.test(message)) {
        return {
            code: 'INVALID_CURRENT_STEP',
            hint: 'When a step is active, return the zero-based currentStep at the top level of the playAction payload.',
        };
    }
    if (/timeout|timed out/i.test(message)) {
        return {
            code: 'RUNTIME_TIMEOUT',
            hint: 'Make sure the action promise finishes. With skipAnimation, do not wait for the animation.',
        };
    }
    if (/module|import|specifier/i.test(message)) {
        return {
            code: 'SANDBOX_IMPORT_FAILED',
            hint: 'Check main and all relative module and asset paths.',
        };
    }
    return {
        code: 'RUNTIME_CHECK_FAILED',
        hint: 'Read the error above. Check the method response against the OGraf Graphic interface.',
    };
}
