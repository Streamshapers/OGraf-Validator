import { describe, expect, it } from 'vitest';
import { getPackageDisplayName } from '../package-loading.js';
import type { PackageEntry } from '../scanner/scan-packages.js';

function entry(manifestFilename = 'main.ograf.json'): PackageEntry {
    return {
        key: manifestFilename,
        path: manifestFilename,
        manifestPath: manifestFilename,
        directoryPath: '.',
        displayName: manifestFilename,
        dirHandle: {} as FileSystemDirectoryHandle,
        manifestFilename,
    };
}

describe('getPackageDisplayName', () => {
    it('uses the manifest name when one Graphic is in the directory', () => {
        expect(getPackageDisplayName({ name: 'Lower Third', id: 'fallback' }, entry(), 1))
            .toBe('Lower Third');
    });

    it('uses the id as fallback and disambiguates shared directories', () => {
        expect(getPackageDisplayName({ id: 'goal-flash' }, entry('flash.ograf.json'), 2))
            .toBe('goal-flash · flash.ograf.json');
    });

    it('uses the manifest filename when name and id are unusable', () => {
        expect(getPackageDisplayName({ name: ' ' }, entry('fallback.ograf.json'), 1))
            .toBe('fallback');
    });
});
