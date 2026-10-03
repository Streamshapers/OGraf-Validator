import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { zipFixture } from '../src/__tests__/zip-fixture.js';

test('abandons a pending report when the selected package changes', async ({ page }) => {
    await page.addInitScript(() => {
        const originalRead = File.prototype.arrayBuffer;
        const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
        let release: (() => void) | undefined;
        Reflect.set(window, 'releaseExportRead', () => release?.());
        File.prototype.arrayBuffer = async function () {
            if (this.name === 'z-last.txt' && Reflect.get(window, 'holdExportRead')) {
                Reflect.set(window, 'holdExportRead', false);
                Reflect.set(window, 'exportReadPending', true);
                await new Promise<void>((resolve) => { release = resolve; });
                Reflect.set(window, 'releasedExportDigests', 0);
            }
            return originalRead.call(this);
        };
        crypto.subtle.digest = async (...args) => {
            const result = await originalDigest(...args);
            const count = Reflect.get(window, 'releasedExportDigests');
            if (typeof count === 'number') Reflect.set(window, 'releasedExportDigests', count + 1);
            return result;
        };
    });
    await page.goto('/');
    const manifest = (name: string) => JSON.stringify({
        $schema: 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json',
        id: name.toLowerCase(), name, main: 'graphic.mjs', supportsRealTime: true,
        supportsNonRealTime: false, schema: { type: 'object', properties: {} },
    });
    const archive = zipFixture([
        { name: 'alpha.ograf.json', content: manifest('Alpha') },
        { name: 'beta.ograf.json', content: manifest('Beta') },
        { name: 'graphic.mjs', content: `export default class Graphic extends HTMLElement {
            async load() {} async updateAction() {} async stopAction() {}
            async customAction() {} async dispose() {}
            async playAction() { return { statusCode: 200, currentStep: 0 }; }
        }` },
        { name: 'z-last.txt', content: 'Capture the final file after navigation.' },
    ]);
    await page.getByLabel('Choose ZIP archive').setInputFiles({
        name: 'reports.zip', mimeType: 'application/zip', buffer: Buffer.from(archive),
    });
    await expect(page.getByText('2/2', { exact: true })).toBeVisible();
    await page.getByRole('button').filter({ hasText: 'Alpha' }).first().click();
    await page.evaluate(() => { Reflect.set(window, 'holdExportRead', true); });
    await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'exportReadPending')))
        .toBe(true);
    await page.getByRole('button').filter({ hasText: 'Beta' }).first().click();
    await expect(page.getByRole('heading', { name: 'Beta · beta.ograf.json', exact: true }))
        .toBeVisible();
    await page.evaluate(() => Reflect.get(window, 'releaseExportRead')());
    // The original fingerprint finishes after two hashes; cancellation stops after the first.
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'releasedExportDigests')))
        .toBeGreaterThanOrEqual(1);
    await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
    const report = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
    expect(report.packageName).toBe('Beta · beta.ograf.json');
    expect(report.packageAtExport.manifestFilename).toBe('beta.ograf.json');
});
