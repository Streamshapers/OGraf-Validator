import type { RuntimeTestStep } from './runtime-test-types.js';
import type { ReportValue } from '../readiness/report-evidence.js';

export interface RuntimeExplanation {
    expected?: string;
    received: string;
    parameters: string;
    method?: string;
}

/** Display only captured facts; missing evidence must never look like an undefined return. */
export function formatCapturedValue(value?: ReportValue): string {
    if (!value) return 'Not captured';
    if (value.type === 'undefined') return 'undefined';
    if (value.type === 'unavailable') return `Not available: ${value.reason}`;
    const undefinedPaths = value.undefinedPaths ?? [];
    if (!undefinedPaths.length) return JSON.stringify(value.value, null, 2);
    const undefinedLocations = new Set(undefinedPaths.map((path) => JSON.stringify(path)));
    const display = (item: unknown, path: (string | number)[], depth: number): string => {
        if (undefinedLocations.has(JSON.stringify(path))) return 'undefined';
        if (item === null || typeof item !== 'object') return JSON.stringify(item);
        const indent = '  '.repeat(depth);
        const array = Array.isArray(item);
        const entries = array ? item.map((child, index) => [index, child] as const) : Object.entries(item);
        if (!entries.length) return array ? '[]' : '{}';
        const lines = entries.map(([key, child]) => `${indent}  ${array ? '' : `${JSON.stringify(key)}: `}${display(child, [...path, key], depth + 1)}`);
        return `${array ? '[' : '{'}\n${lines.join(',\n')}\n${indent}${array ? ']' : '}'}`;
    };
    return display(value.value, [], 0);
}

export function explainRuntimeStep(step: RuntimeTestStep): RuntimeExplanation {
    const diagnostic = step.diagnostic;
    let expected: string | undefined;
    switch (diagnostic?.code) {
        case 'INVALID_EMPTY_PAYLOAD':
            expected = 'undefined, {}, or an object containing only v_-prefixed vendor fields.';
            break;
        case 'INVALID_RETURN_PAYLOAD':
            expected = diagnostic.method === 'playAction'
                ? 'A ReturnPayload object containing currentStep.'
                : 'A ReturnPayload object with the allowed fields, or undefined.';
            break;
        case 'INVALID_STATUS_CODE': expected = 'statusCode: an integer from 100 to 599.'; break;
        case 'INVALID_STATUS_MESSAGE': expected = 'statusMessage: a string, or undefined.'; break;
        case 'INVALID_CURRENT_STEP': expected = 'A currentStep field containing a non-negative integer or undefined.'; break;
        case 'CURRENT_STEP_MISMATCH':
            if (step.expectedCurrentStep !== undefined) {
                expected = `currentStep: ${step.expectedCurrentStep === null ? 'undefined (end / no step)' : step.expectedCurrentStep}.`;
            }
            break;
        case 'METHOD_MUST_RETURN_PROMISE': expected = 'A Promise returned by the method.'; break;
        case 'ACTION_RETURNED_ERROR_STATUS': expected = 'A successful action reports a 2xx statusCode; inspect the inputs and statusMessage for the failure reason.'; break;
        case 'INVALID_DEFAULT_EXPORT': expected = 'A default export defining the Graphic custom element.'; break;
        case 'DEFAULT_EXPORT_NOT_HTMLELEMENT': expected = 'A default-exported class extending HTMLElement.'; break;
    }
    let received = formatCapturedValue(step.invocation?.response);
    if (diagnostic?.code === 'METHOD_MUST_RETURN_PROMISE' && step.invocation?.wasPromise === false) {
        received = `Non-Promise return\n${received}`;
    }
    return {
        ...(expected ? { expected } : {}), received,
        parameters: formatCapturedValue(step.invocation?.parameters),
        method: step.invocation?.method ?? diagnostic?.method,
    };
}
