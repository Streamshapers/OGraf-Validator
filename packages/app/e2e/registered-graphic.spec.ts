import { expect, test, type Page } from '@playwright/test';
import { zipFixture } from '../src/__tests__/zip-fixture.js';

const NAME = 'Registered graphic regression';

function graphic(extra = '', register = true): string {
    return `class Graphic extends HTMLElement {
        currentStep = undefined;
        async load() { this.textContent = 'Registered graphic rendered'; }
        async playAction({ goto, delta = 1 }) {
            const target = goto ?? ((this.currentStep ?? -1) + delta);
            this.currentStep = target >= 1 ? undefined : target;
            return { statusCode: 200, currentStep: this.currentStep };
        }
        async updateAction() {}
        async stopAction() { this.currentStep = undefined; }
        async customAction() {}
        async dispose() {}
        ${extra}
    }
    ${register ? "customElements.define('self-registered-graphic', Graphic);" : ''}
    export default Graphic;`;
}

async function openGraphic(page: Page, source: string,
    manifest: Record<string, unknown> = {}): Promise<void> {
    await page.goto('/');
    const archive = zipFixture([
        { name: 'manifest.ograf.json', content: JSON.stringify({
            $schema: 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json',
            id: 'registered-graphic', name: NAME, main: 'graphic.mjs',
            supportsRealTime: true, supportsNonRealTime: false,
            schema: { type: 'object', properties: {} },
            ...manifest,
        }) },
        { name: 'graphic.mjs', content: source },
    ]);
    await page.getByLabel('Choose ZIP archive').setInputFiles({
        name: 'registered-graphic.zip', mimeType: 'application/zip', buffer: Buffer.from(archive),
    });
    await page.getByRole('button').filter({ hasText: NAME }).first().click();
    await expect(page.getByRole('heading', { name: NAME })).toBeVisible();
}

test('runs a self-registered default class in standard, extended and preview sessions', async ({ page }) => {
    await openGraphic(page, graphic());
    const coverage = page.getByRole('region', { name: 'Test coverage' });
    await expect(coverage).toContainText('Standard · Passed');
    await page.getByRole('button', { name: 'Run extended tests', exact: true }).click();
    await expect(coverage).toContainText('Extended · Passed');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.frameLocator('iframe[aria-label="OGraf graphic preview"]')
        .locator('#stage')).toContainText('Registered graphic rendered');
});

for (const registered of [true, false]) {
    test(`preserves constructor failures when the class is ${registered ? 'registered' : 'unregistered'}`,
        async ({ page }) => {
            await openGraphic(page, graphic(
                "constructor() { super(); throw new Error('GRAPHIC_CONSTRUCTOR_FAILED'); }",
                registered,
            ));
            await expect(page.getByText('Runtime Failed', { exact: true }).first()).toBeVisible();
            await expect(page.getByText(/GRAPHIC_CONSTRUCTOR_FAILED/).first()).toBeVisible();
            await expect(page.getByRole('region', { name: 'Test coverage' }))
                .toContainText('Standard · Failed');
        });
}

test('rejects an empty unknown return field in the actual sandbox', async ({ page }) => {
    await openGraphic(page, graphic("async load() { return { statusCode: 200, '': true }; }"));
    await expect(page.getByText('INVALID_RETURN_PAYLOAD', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Runtime Failed', { exact: true }).first()).toBeVisible();
});

test('keeps incompatible render defaults out of automatic checks and explains manual preview',
    async ({ page }) => {
        await openGraphic(page, graphic(), { renderRequirements: [{ frameRate: { exact: 0 } }] });
        const coverage = page.getByRole('region', { name: 'Test coverage' });
        await expect(coverage).toContainText('Standard · Inconclusive');
        await expect(coverage).toContainText('0 of 1 steps confirmed');
        await expect(page.getByText('Needs Review', { exact: true }).first()).toBeVisible();
        await page.getByRole('button', { name: 'Run extended tests', exact: true }).click();
        await expect(coverage).toContainText('Extended · Inconclusive');
        await expect(page.locator('iframe')).toHaveCount(0);
        await page.getByRole('button', { name: 'Preview', exact: true }).click();
        await expect(page.getByText(/Manual preview uses custom\/default values/)).toBeVisible();
        await expect(page.frameLocator('iframe[aria-label="OGraf graphic preview"]')
            .locator('#stage')).toContainText('Registered graphic rendered');
    });
