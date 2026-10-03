import { expect, test, type Page } from '@playwright/test';
import { zipFixture } from '../src/__tests__/zip-fixture.js';
import { readFile } from 'node:fs/promises';

const graphic = `import { label } from './shared/label.mjs';
export default class Graphic extends HTMLElement {
    async load() { this.textContent = label; }
    async playAction() { return { statusCode: 200, currentStep: 0 }; }
    async updateAction() {} async stopAction() {} async dispose() {} async customAction() {}
}`;
const manifest = (name: string) => JSON.stringify({
    $schema: 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json',
    id: name.toLowerCase(), name, main: 'graphic.mjs', supportsRealTime: true,
    supportsNonRealTime: false, schema: { type: 'object', properties: {} },
});
function fixture() {
    return zipFixture([
        { name: 'Bundle/alpha.ograf.json', content: manifest('Alpha') },
        { name: 'Bundle/beta.ograf.json', content: manifest('Beta'), stored: true },
        { name: 'Bundle/graphic.mjs', content: graphic },
        { name: 'Bundle/shared/label.mjs', content: 'export const label = "Archive preview works";' },
    ]);
}
async function upload(page: Page, bytes = fixture()) {
    await page.getByLabel('Choose ZIP archive').setInputFiles({ name: 'graphics.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
}

test('opens multiple graphics and shared assets from ZIP, runs sandbox checks and exports real coverage', async ({ page }) => {
    await page.goto('/');
    await upload(page);
    await expect(page.getByText('ZIP snapshot', { exact: false })).toBeVisible();
    await expect(page.getByText('2/2', { exact: true })).toBeVisible();
    await page.getByRole('button').filter({ hasText: 'Alpha' }).first().click();
    const coverage = page.getByRole('region', { name: 'Test coverage' });
    await expect(coverage).toContainText('1 of 1 steps confirmed');
    await expect(coverage).toContainText('1920 × 1080');
    await expect(coverage).toContainText('Extended · Not run');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.frameLocator('iframe[aria-label="OGraf graphic preview"]').locator('#stage')).toContainText('Archive preview works');
    await page.getByRole('button', { name: /^Validation/ }).click();
    await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
    const report = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
    expect(report.coverage[0].modes[0].steps).toEqual([0]);
    expect(report.coverage[0].modes[0].profiles[0]).toContain('1920 × 1080');
    expect(report.runtimeTest.result.reportContext.packageComparison).toBe('unchanged');
    expect(await page.evaluate(() => localStorage.getItem('ograf-last-directory'))).not.toBe('graphics.zip');
});

test('rejects an unsafe archive without replacing the current package and supports ZIP drag and drop', async ({ page }) => {
    await page.goto('/');
    await upload(page);
    await expect(page.getByText('2/2', { exact: true })).toBeVisible();
    await upload(page, zipFixture([{ name: '../escape.ograf.json', content: '{}' }]));
    await expect(page.getByRole('alert')).toContainText('unsafe');
    await expect(page.getByText('2/2', { exact: true })).toBeVisible();
    const dataTransfer = await page.evaluateHandle((data) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([Uint8Array.from(data)], 'dropped.zip', { type: 'application/zip' }));
        return transfer;
    }, [...fixture()]);
    await page.locator('header').dispatchEvent('drop', { dataTransfer });
    await expect(page.getByRole('banner').getByText('dropped.zip', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('2/2', { exact: true })).toBeVisible();
});

test('can switch back from a ZIP snapshot to a real directory', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(window, 'showDirectoryPicker', { value: async () => {
            const root = await navigator.storage.getDirectory();
            const dir = await root.getDirectoryHandle('Real directory', { create: true });
            return dir;
        } });
    });
    await page.goto('/');
    await upload(page);
    await expect(page.getByText('ZIP snapshot', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Open Directory', exact: true }).first().click();
    await expect(page.getByText('Real directory', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('ZIP snapshot', { exact: false })).toHaveCount(0);
});

test('cancels a pending ZIP import without installing a late result', async ({ page }) => {
    await page.addInitScript(() => {
        const original = File.prototype.arrayBuffer;
        let release: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        Object.defineProperty(window, 'releaseZipRead', { value: () => release() });
        File.prototype.arrayBuffer = async function () {
            if (this.name === 'graphics.zip') await gate;
            return original.call(this);
        };
    });
    await page.goto('/');
    await upload(page);
    await page.getByRole('button', { name: 'Cancel ZIP import' }).click();
    await page.evaluate(() => (window as unknown as { releaseZipRead: () => void }).releaseZipRead());
    await expect(page.getByText('ZIP snapshot', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancel ZIP import' })).toHaveCount(0);
    await expect(page.getByText('2/2', { exact: true })).toHaveCount(0);
    // A later, fresh import can still complete normally.
    await upload(page);
    await expect(page.getByText('2/2', { exact: true })).toBeVisible();
});

test('ZIP import does not depend on a native directory picker and works at mobile width', async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(window, 'showDirectoryPicker', { value: undefined }); });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Open ZIP', exact: true })).toBeVisible();
    await upload(page);
    await expect(page.getByText('2/2', { exact: true })).toBeVisible();
    await expect(page.getByText('ZIP snapshot', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
