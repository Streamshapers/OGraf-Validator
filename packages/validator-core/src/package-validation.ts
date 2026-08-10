/** Safe package and VirtualFS validation. */

import type { ValidationIssue, VirtualFS } from './types.js';
import {
    GRAPHIC_REQUIREMENTS_SPEC_REF,
    LARGE_FILE_THRESHOLD,
    MANIFEST_SPEC_REF,
    err,
    errorMessage,
    info,
    isFiniteNumber,
    isRecord,
    warn,
} from './validation-utils.js';
import type { JsonObject } from './validation-utils.js';

interface FilePathDefault {
    filePath: string;
    issuePath: string;
}

export async function validateAssets(manifest: JsonObject, fs: VirtualFS): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const main = manifest['main'];
    if (typeof main === 'string' && main.trim() !== '') {
        const exists = await checkFileExists(fs, main, 'main', issues);
        if (exists === false) {
            issues.push(err('MISSING_ASSET', `Main entry point not found: "${main}".`, 'main', GRAPHIC_REQUIREMENTS_SPEC_REF));
        }
    }

    await validateThumbnailAssets(manifest['thumbnails'], fs, issues);
    await validateGddDefaultAssets(manifest, fs, issues);

    let files: string[] | undefined;
    try {
        const listedFiles = await fs.listFiles();
        if (!Array.isArray(listedFiles) || listedFiles.some((entry) => typeof entry !== 'string')) {
            issues.push(err(
                'FILE_ACCESS_ERROR',
                'VirtualFS.listFiles() must return an array of strings.',
                undefined,
                GRAPHIC_REQUIREMENTS_SPEC_REF,
            ));
        } else {
            files = listedFiles;
        }
    } catch (error) {
        issues.push(err(
            'FILE_ACCESS_ERROR',
            `Could not list package files: ${errorMessage(error)}`,
            undefined,
            GRAPHIC_REQUIREMENTS_SPEC_REF,
        ));
    }

    if (files === undefined) return issues;
    const nonManifestFiles = files.filter((file) => !file.endsWith('.ograf.json'));
    if (nonManifestFiles.length === 0) {
        issues.push(warn('EMPTY_PACKAGE', 'Package directory contains no files besides manifests.'));
    }
    issues.push(info('PACKAGE_FILE_COUNT', `Package contains ${files.length} file(s).`));

    if (typeof fs.getFileSize === 'function') {
        let totalSize = 0;
        for (const file of files) {
            try {
                const size = await fs.getFileSize(file);
                if (!isFiniteNumber(size) || size < 0) {
                    issues.push(err('FILE_ACCESS_ERROR', `Invalid file size returned for "${file}".`, file));
                    continue;
                }
                totalSize += size;
                if (size > LARGE_FILE_THRESHOLD) {
                    issues.push(warn('LARGE_FILE', `File "${file}" is ${formatBytes(size)}. Consider optimizing large assets.`, file));
                }
            } catch (error) {
                issues.push(err(
                    'FILE_ACCESS_ERROR',
                    `Could not read the size of "${file}": ${errorMessage(error)}`,
                    file,
                    GRAPHIC_REQUIREMENTS_SPEC_REF,
                ));
            }
        }
        issues.push(info('PACKAGE_TOTAL_SIZE', `Total package size: ${formatBytes(totalSize)}.`));
    }

    return issues;
}

async function validateThumbnailAssets(
    value: unknown,
    fs: VirtualFS,
    issues: ValidationIssue[],
): Promise<void> {
    if (!Array.isArray(value)) return;
    for (let index = 0; index < value.length; index += 1) {
        const entry = value[index];
        if (!isRecord(entry) || typeof entry['file'] !== 'string' || entry['file'].trim() === '') continue;
        const filePath = entry['file'];
        if (!isPackageRelativePath(filePath)) continue;
        const path = `thumbnails[${index}].file`;
        const exists = await checkFileExists(fs, filePath, path, issues);
        if (exists === false) {
            issues.push(err('MISSING_THUMBNAIL_ASSET', `Thumbnail file not found: "${filePath}".`, path, MANIFEST_SPEC_REF));
        }
    }
}

async function validateGddDefaultAssets(
    manifest: JsonObject,
    fs: VirtualFS,
    issues: ValidationIssue[],
): Promise<void> {
    const defaults: FilePathDefault[] = [];
    collectFilePathDefaults(manifest['schema'], 'schema', defaults, new WeakSet<object>());
    if (Array.isArray(manifest['customActions'])) {
        manifest['customActions'].forEach((action, index) => {
            if (isRecord(action)) {
                collectFilePathDefaults(action['schema'], `customActions[${index}].schema`, defaults, new WeakSet<object>());
            }
        });
    }

    for (const entry of defaults) {
        if (!isPackageRelativePath(entry.filePath)) continue;
        const exists = await checkFileExists(fs, entry.filePath, entry.issuePath, issues);
        if (exists === false) {
            issues.push(warn(
                'MISSING_DEFAULT_ASSET',
                `GDD default file not found: "${entry.filePath}".`,
                entry.issuePath,
                GRAPHIC_REQUIREMENTS_SPEC_REF,
            ));
        }
    }
}

function collectFilePathDefaults(
    value: unknown,
    path: string,
    results: FilePathDefault[],
    stack: WeakSet<object>,
): void {
    if (!isRecord(value) || stack.has(value)) return;
    stack.add(value);
    try {
        if (
            (value['gddType'] === 'file-path' || value['gddType'] === 'file-path/image-path')
            && typeof value['default'] === 'string'
            && value['default'].trim() !== ''
        ) {
            results.push({ filePath: value['default'], issuePath: `${path}.default` });
        }
        if (isRecord(value['properties'])) {
            for (const [name, child] of Object.entries(value['properties'])) {
                collectFilePathDefaults(child, `${path}.properties.${name}`, results, stack);
            }
        }
        collectFilePathDefaults(value['items'], `${path}.items`, results, stack);
    } finally {
        stack.delete(value);
    }
}

async function checkFileExists(
    fs: VirtualFS,
    filePath: string,
    issuePath: string,
    issues: ValidationIssue[],
): Promise<boolean | undefined> {
    try {
        const result = await fs.fileExists(filePath);
        if (typeof result !== 'boolean') {
            issues.push(err(
                'FILE_ACCESS_ERROR',
                `VirtualFS.fileExists("${filePath}") must return a boolean.`,
                issuePath,
                GRAPHIC_REQUIREMENTS_SPEC_REF,
            ));
            return undefined;
        }
        return result;
    } catch (error) {
        issues.push(err(
            'FILE_ACCESS_ERROR',
            `Could not check file "${filePath}": ${errorMessage(error)}`,
            issuePath,
            GRAPHIC_REQUIREMENTS_SPEC_REF,
        ));
        return undefined;
    }
}

function isPackageRelativePath(path: string): boolean {
    return !/^[a-z][a-z\d+.-]*:/i.test(path)
        && !path.startsWith('/')
        && !path.startsWith('\\')
        && !/^[a-z]:[\\/]/i.test(path);
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
