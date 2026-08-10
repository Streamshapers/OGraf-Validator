import { validatePackage } from '@streamshapers/ograf-validator-core';
import type { ValidationIssue, ValidationResult } from '@streamshapers/ograf-validator-core';
import { BrowserFS } from './fs/browser-fs.js';
import type { PackageEntry } from './scanner/scan-packages.js';

export interface LoadedPackage {
    manifest: unknown;
    validationResult: ValidationResult;
    assets: string[];
    loadError?: string;
}

/**
 * Parse and validate one discovered manifest. Expected package failures are
 * returned as validation results so cards never remain in an indeterminate
 * loading state.
 */
export async function loadPackage(
    entry: PackageEntry,
    assetList?: Promise<string[]>,
): Promise<LoadedPackage> {
    const fs = new BrowserFS(entry.dirHandle);
    let manifest: unknown;

    try {
        const manifestText = await fs.readFile(entry.manifestFilename);
        manifest = JSON.parse(manifestText) as unknown;
    } catch (error) {
        const isSyntaxError = error instanceof SyntaxError;
        const message = isSyntaxError
            ? `${entry.manifestFilename} is not valid JSON: ${error.message}`
            : `Unable to read ${entry.manifestFilename}: ${readErrorMessage(error)}`;

        return {
            manifest: null,
            validationResult: createFailureResult(
                isSyntaxError ? 'INVALID_MANIFEST' : 'FILE_ACCESS_ERROR',
                message,
                entry.manifestPath,
            ),
            assets: [],
            loadError: message,
        };
    }

    const [validationResult, assets] = await Promise.all([
        validatePackage(manifest, fs, entry.manifestFilename).catch((error: unknown) =>
            createFailureResult(
                'FILE_ACCESS_ERROR',
                `Package validation failed: ${readErrorMessage(error)}`,
                entry.manifestPath,
            ),
        ),
        (assetList ?? fs.listFiles()).catch(() => []),
    ]);

    return { manifest, validationResult, assets };
}

/** Name/id first; a sibling filename makes shared-directory Graphics clear. */
export function getPackageDisplayName(
    manifest: unknown,
    entry: PackageEntry,
    siblingManifestCount: number,
): string {
    const record = readRecord(manifest);
    const manifestName = readNonEmptyString(record?.['name'])
        ?? readNonEmptyString(record?.['id'])
        ?? entry.manifestFilename.replace(/\.ograf\.json$/i, '');

    return siblingManifestCount > 1
        ? `${manifestName} · ${entry.manifestFilename}`
        : manifestName;
}

function createFailureResult(
    code: 'INVALID_MANIFEST' | 'FILE_ACCESS_ERROR',
    message: string,
    path: string,
): ValidationResult {
    const issue: ValidationIssue = {
        severity: 'error',
        code,
        message,
        path,
    };

    return {
        valid: false,
        issues: [issue],
        errors: [issue],
        warnings: [],
        infos: [],
    };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
