import type { RuntimeDiagnosticDetails } from './runtime-diagnostic-types.js';

/** An error created by trusted preview code, with an explicit diagnostic category. */
export class PreviewDiagnosticError extends Error {
    readonly diagnostic?: RuntimeDiagnosticDetails;

    constructor(message: string, diagnostic?: RuntimeDiagnosticDetails) {
        super(message);
        this.name = 'PreviewDiagnosticError';
        this.diagnostic = diagnostic;
    }
}
