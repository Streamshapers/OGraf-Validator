import type { RuntimeTestStep } from './runtime-test-types.js';
import type { RuntimeDiagnosticCode, RuntimeDiagnosticDetails } from './runtime-diagnostic-types.js';

export interface RuntimeDiagnostic {
    code: RuntimeDiagnosticCode;
    hint: string;
    specRef?: string;
}

export type RuntimeMode = 'RT' | 'NRT';

export interface RuntimeFailureOccurrence {
    mode?: RuntimeMode;
    step: RuntimeTestStep;
}

export interface RuntimeFailureGroup extends RuntimeDiagnostic {
    id: string;
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

/** Contract identity spans suites; uncertain exceptions keep their execution context. */
export function groupRuntimeFailures(steps: readonly RuntimeTestStep[]): RuntimeFailureGroup[] {
    const groups = new Map<string, RuntimeFailureGroup>();

    for (const step of steps) {
        if (step.status !== 'fail') continue;
        const diagnostic = diagnoseRuntimeError(step.error, step.diagnostic);
        const parsed = splitRuntimeStepName(step.name);
        const mode = step.renderMode ?? parsed.mode;
        const label = hasContractIdentity(step) ? `${step.diagnostic?.method}()` : parsed.label;
        const error = step.error?.trim();
        const key = runtimeFailureIdentity(step);
        const existing = groups.get(key);
        const occurrence: RuntimeFailureOccurrence = {
            ...(mode ? { mode } : {}),
            step,
        };

        if (existing) {
            existing.occurrences.push(occurrence);
        } else {
            groups.set(key, {
                id: `runtime-finding-${groups.size + 1}`,
                ...diagnostic,
                label,
                ...(error ? { error } : {}),
                occurrences: [occurrence],
            });
        }
    }

    return [...groups.values()];
}

function hasContractIdentity(step: RuntimeTestStep): boolean {
    const { code, method } = step.diagnostic ?? {};
    return !!method && method !== 'customAction' && !!code
        && ['INVALID_EMPTY_PAYLOAD', 'INVALID_RETURN_PAYLOAD', 'INVALID_STATUS_CODE',
            'INVALID_STATUS_MESSAGE', 'INVALID_CURRENT_STEP', 'CURRENT_STEP_MISMATCH',
            'ACTION_RETURNED_ERROR_STATUS', 'METHOD_MUST_RETURN_PROMISE'].includes(code);
}

export function runtimeFailureIdentity(step: RuntimeTestStep): string {
    const contract = hasContractIdentity(step);
    const details = step.diagnostic;
    return JSON.stringify([
        details?.code ?? 'RUNTIME_CHECK_FAILED', details?.reason, details?.method,
        details?.field, details?.statusCode, step.error?.trim() ?? '',
        ...(contract ? [] : [splitRuntimeStepName(step.name).label, step.suite ?? 'standard',
            step.scenarioId?.replace(/^(?:rt|nrt)\./, ''),
            step.checkId?.replace(/^(?:rt|nrt)\./, '')]),
        step.expectedCurrentStep === undefined ? 'not-specified' : step.expectedCurrentStep,
        step.actualCurrentStep === undefined ? 'not-reported' : step.actualCurrentStep,
    ]);
}

const SPEC = 'https://ograf.ebu.io/v1/specification/docs/Specification.html';

export function diagnoseRuntimeError(
    _error?: string,
    details?: RuntimeDiagnosticDetails,
): RuntimeDiagnostic {
    const code = details?.code ?? 'RUNTIME_CHECK_FAILED';
    const methodRef = details?.method
        ? `${SPEC}#${details.method.toLowerCase()}`
        : `${SPEC}#web-component-interface`;
    const diagnostic = (hint: string, specRef?: string): RuntimeDiagnostic => ({
        code, hint, ...(specRef ? { specRef } : {}),
    });

    switch (code) {
        case 'INVALID_EMPTY_PAYLOAD':
            return diagnostic(
                'setActionsSchedule must resolve to undefined, {}, or an object containing only v_-prefixed vendor fields. Do not return statusCode, statusMessage, or result.',
                `${SPEC}#setactionsschedule`,
            );
        case 'INVALID_RETURN_PAYLOAD': {
            if (details?.reason !== 'non-vendor-field' || !details.field) {
                if (details?.method === 'playAction') {
                    return diagnostic('playAction must resolve to an object containing statusCode and currentStep. Use the zero-based active step, or currentStep: undefined at the end. The complete payload must not be undefined.', methodRef);
                }
                return diagnostic(
                    details?.method
                        ? `${details.method} must resolve to a ReturnPayload object containing statusCode, or to undefined for success.`
                        : 'Resolve to a ReturnPayload object containing statusCode. Check the failing method for any additional required response fields.',
                    methodRef,
                );
            }
            const quoted = JSON.stringify(details.field);
            const property = /^[A-Za-z_$][\w$]*$/.test(details.field) ? details.field : quoted;
            const stepField = details.method === 'playAction' ? ' currentStep,' : '';
            return diagnostic(
                `Move ${quoted} into result: { statusCode: 200,${stepField} result: { ${property}: value } }.${
                    details.method === 'playAction'
                        ? ' Keep currentStep at the top level; use undefined when the end is reached.' : ''
                } Use v_ only for vendor fields.`,
                methodRef,
            );
        }
        case 'INVALID_STATUS_CODE':
            return diagnostic('A returned ReturnPayload must include statusCode as an integer HTTP status code from 100 to 599. A missing, string, or out-of-range value is an invalid payload.', methodRef);
        case 'INVALID_STATUS_MESSAGE':
            return diagnostic('Omit statusMessage or return a string. statusMessage is optional and does not replace statusCode.', methodRef);
        case 'INVALID_CURRENT_STEP':
        case 'CURRENT_STEP_MISMATCH':
            return diagnostic('playAction must return statusCode and currentStep at the top level. Use the zero-based active step; explicitly return currentStep: undefined when the end is reached or stepCount is 0.', `${SPEC}#playaction`);
        case 'ACTION_RETURNED_ERROR_STATUS':
            return diagnostic('The method reported a non-success status. Inspect statusMessage and the supplied input before fixing the underlying cause. A completed successful ReturnPayload uses a 2xx statusCode.', methodRef);
        case 'METHOD_MUST_RETURN_PROMISE':
            return diagnostic('Return a Promise from the method, for example by declaring it async. Resolve it when the method has completed the work required by its OGraf contract.', methodRef);
        case 'MISSING_REQUIRED_METHODS':
            return diagnostic('Implement load, dispose, playAction, stopAction, updateAction, and customAction. When supportsNonRealTime is true, also implement goToTime and setActionsSchedule.', `${SPEC}#web-component-interface`);
        case 'INVALID_DEFAULT_EXPORT':
            return diagnostic('Export the Graphic class as the module default export: export default Graphic.', `${SPEC}#web-component-interface`);
        case 'DEFAULT_EXPORT_NOT_HTMLELEMENT':
            return diagnostic('The default-exported Graphic class must extend HTMLElement.', `${SPEC}#web-component-interface`);
        case 'SANDBOX_IMPORT_FAILED':
            return diagnostic('Inspect the import error and the manifest main path, module dependencies, and initialization code. A failed import does not identify a specific OGraf return-contract violation.');
        case 'RUNTIME_TIMEOUT':
            return diagnostic('The validator time limit expired; the result is inconclusive. Check Promise completion and the rendering environment. This limit is not imposed by OGraf or by manifest actionDurations.');
        case 'RUNTIME_ABORTED':
            return diagnostic('The test was interrupted. Rerun it to obtain results for the remaining checks.');
        case 'PREVIEW_LIMITATION':
            if (details?.reason === 'blocked-dependent-checks' || details?.reason === 'blocked-prerequisite') {
                return diagnostic('Resolve the preceding failure or test limitation, then rerun the full suite. Earlier findings remain until the dependent checks can be evaluated.');
            }
            if (details?.reason === 'bounded-step-coverage') {
                return diagnostic('Some target steps are outside this suite\'s bounded coverage. Check the omitted steps manually in Preview or another renderer. A larger time budget does not expand the selected targets.');
            }
            if (details?.reason === 'incomplete-runtime-harness') {
                return diagnostic('The validator could not complete the test. Inspect the harness error and rerun the suite; earlier findings remain until a conclusive replacement finishes.');
            }
            if (details?.reason === 'test-data-generation') {
                return diagnostic('The validator could not generate test data within its resource limits. Provide suitable input manually in Preview or another renderer. These limits are not OGraf schema restrictions.');
            }
            return diagnostic('This check cannot establish conformance in the isolated browser environment. Verify it in a renderer that provides the required capability.');
        case 'UNCAUGHT_RUNTIME_ERROR':
            return diagnostic('Inspect the uncaught exception or unhandled Promise rejection and its source. Handle asynchronous failures in the Graphic; the message alone does not identify an OGraf contract violation.');
        case 'INVALID_TEST_DATA':
            return diagnostic('The generated test data does not satisfy the declared schema. Correct the defaults for the automatic test, or test suitable input manually in Preview. This is not evidence of a Graphic API defect.', methodRef);
        case 'UNSUPPORTED_TEST_SCHEMA':
            return diagnostic('The validator cannot establish whether the generated input satisfies this schema. Validate suitable input separately before testing the Graphic.');
        case 'CUSTOM_ACTION_NOT_TESTED':
            return diagnostic('This custom action could not be tested with generated input. Provide a suitable payload in Preview to complete the check.', `${SPEC}#customaction`);
        case 'INVALID_SCHEDULE':
            return diagnostic('Correct the schedule input using action.type and method-specific params; custom action IDs must be declared in the manifest. This is an input problem, not a Graphic return-value failure.', `${SPEC}#setactionsschedule`);
        default:
            return diagnostic('Inspect the original error and the failing operation. No specific OGraf contract violation has been established from this message.');
    }
}
