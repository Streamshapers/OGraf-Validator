import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const OFFICIAL_SCHEMA = 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json';
const REPOSITORY_FIXTURE_PATHS = [
    'valid-basic/manifest.ograf.json',
    'valid-basic/graphic.mjs',
    'valid-basic/index.html',
    'invalid-runtime/manifest.ograf.json',
    'invalid-runtime/graphic.mjs',
    'valid-realtime/manifest.ograf.json',
    'valid-realtime/graphic.mjs',
    'valid-realtime/goal-flash.ograf.json',
    'valid-realtime/goal-flash.mjs',
    'valid-realtime/goal-flash/index.html',
    'valid-realtime/scoreboard/index.html',
    'valid-realtime/thumbnail.png',
] as const;

interface SerializedOpfsFile {
    path: string;
    encoding: 'base64' | 'text';
    contents: string;
}

test.beforeEach(async ({ context, page }) => {
    await installDirectoryPicker(context);
    await page.goto('/');
    await writeOpfsFixture(page, fixtureFiles());
});

test('isolates packages, tabs, reloads, Unicode imports, and parent origin', async ({ context, page }) => {
    const teardownResourceErrors: string[] = [];
    const automaticAlphaDisposals: string[] = [];
    page.on('console', (message) => {
        const text = message.text();
        if (text === 'disposed ALPHA') automaticAlphaDisposals.push(text);
        if (
            message.type() === 'error' &&
            /Could not (?:load|prepare) OGraf package resource/.test(text) &&
            text.includes('Preview runner was destroyed')
        ) teardownResourceErrors.push(text);
    });

    await openFixture(page);
    await selectGraphic(page, 'Alpha Graphic');
    await expect(page.getByText('RT: dispose()', { exact: true })).toBeVisible();
    await expect(page.getByText('Runtime Passed', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Production-Ready', { exact: true }).first()).toBeVisible();
    await expect.poll(() => automaticAlphaDisposals.length).toBe(1);

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const alphaFrame = page.frameLocator('iframe[aria-label="OGraf graphic preview"]');
    await expect(alphaFrame.locator('#stage > *')).toContainText('ALPHA:realtime');
    await expect(alphaFrame.locator('#stage > *')).toHaveAttribute('data-parent-blocked', 'true');
    await expect(alphaFrame.locator('#stage > *')).toHaveAttribute('data-asset-protocol', 'http:');
    await expect(alphaFrame.locator('#stage > *')).toHaveAttribute('data-asset-text', 'sandbox asset ok');
    await expect(alphaFrame.locator('#stage > *')).toHaveAttribute('data-image-protocol', 'blob:');
    await expect(alphaFrame.locator('#stage > *')).toHaveAttribute('data-variable-image-protocol', 'blob:');
    await expect(alphaFrame.locator('#stage > *')).toHaveAttribute('data-variable-url-protocol', 'blob:');
    await expect(alphaFrame.locator('#stage > *')).toHaveAttribute('data-css-background', /blob:/);
    await expect(alphaFrame.locator('#stage > *')).toHaveAttribute('data-css-font', /Package Font/);
    await expect(alphaFrame.locator('#stage > *')).toHaveAttribute('data-inline-style', /blob:/);
    await expect(alphaFrame.locator('#stage > *')).toHaveAttribute('data-direct-style', /blob:/);
    await expect(alphaFrame.locator('#stage > *')).toHaveAttribute('data-srcset-protocol', 'blob:');
    await expect(alphaFrame.locator('#stage > *')).toHaveAttribute('data-srcset-width', '16');
    await expect(alphaFrame.locator('#stage > *')).toHaveAttribute('data-module-worker', 'module:lazy:worker data');
    await expect(alphaFrame.locator('#stage > *')).toHaveAttribute('data-classic-worker', 'classic:classic data');
    await expect(alphaFrame.locator('#stage > *')).toHaveAttribute('data-worker-error', 'worker fixture failure');

    const parentState = await page.evaluate(() => ({
        marker: document.body.dataset['sandboxMutation'],
        storage: localStorage.getItem('sandboxMutation'),
    }));
    expect(parentState).toEqual({ marker: undefined, storage: null });

    const firstSession = await currentGraphicSession(page);
    expect(firstSession).toBeDefined();
    const firstFrame = await currentPreviewFrame(page);
    expect(firstFrame).toBeDefined();
    await firstFrame?.evaluate(() => {
        const graphic = document.querySelector<HTMLElement>('#stage > *');
        for (let index = 0; index < 50; index += 1) {
            const file = index % 2 === 0 ? 'srcset one.svg' : 'srcset two.svg';
            graphic?.setAttribute('style', `background-image: url('./assets/${file}')`);
        }
    });
    await page.getByRole('button', { name: /Reload$/ }).click();
    await expect.poll(async () => (await currentGraphicSession(page)) ?? firstSession).not.toBe(firstSession);
    await expect(page.frameLocator('iframe[aria-label="OGraf graphic preview"]').locator('#stage > *'))
        .toContainText('ALPHA:realtime');
    await page.waitForTimeout(100);
    expect(teardownResourceErrors).toEqual([]);

    const play = page.getByRole('button', { name: 'Play', exact: true });
    await play.click();
    await play.click();
    await expect.poll(async () => {
        const frame = await currentPreviewFrame(page);
        return frame?.locator('#stage > *').getAttribute('data-max-concurrent');
    }).toBe('2');

    const secondPage = await context.newPage();
    await secondPage.goto('/');
    await openFixture(secondPage);
    await selectGraphic(secondPage, 'Beta Dual');
    await secondPage.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(secondPage.frameLocator('iframe[aria-label="OGraf graphic preview"]').locator('#stage > *'))
        .toContainText('BETA:realtime');
    await expect(page.frameLocator('iframe[aria-label="OGraf graphic preview"]').locator('#stage > *'))
        .toContainText('ALPHA:realtime');

    const rescan = page.getByRole('button', { name: 'Rescan Directory', exact: true });
    await expect(rescan).toBeEnabled();
    await rescan.click();
    await expect(page.getByRole('heading', { name: /Alpha Graphic/ })).toBeVisible();
    await expect(page.getByText('Runtime Passed', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
});

test('runs RT and NRT lifecycles and reports non-2xx payloads', async ({ page }) => {
    await openFixture(page);
    await selectGraphic(page, 'Beta Dual');

    await expect(page.getByText('RT: dispose()', { exact: true })).toBeVisible();
    await expect(page.getByText('NRT: setActionsSchedule()', { exact: true })).toBeVisible();
    await expect(page.getByText('NRT: goToTime(0)', { exact: true })).toBeVisible();
    await expect(page.getByText('NRT: dispose()', { exact: true })).toBeVisible();
    await expect(page.getByText('RT: customAction(ping)', { exact: true })).toBeVisible();
    await expect(page.getByText('NRT: customAction(ping)', { exact: true })).toBeVisible();

    await selectGraphic(page, 'Bad Return');
    await expect(page.getByText(/updateAction\(\) returned status 400/)).toBeVisible();

    await selectGraphic(page, 'Static Invalid');
    await expect(page.getByText('Manifest Invalid', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Not Production-Ready', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Inspect', exact: true }).click();
    await expect(page.getByRole('button', { name: '1 error. View in Validation' })).toBeVisible();
    await page.getByRole('button', { name: 'Inspect assets', exact: true }).click();
    await expect(page.getByRole('heading', { name: '1 issue in this section' })).toBeVisible();
    await page.getByRole('button', { name: 'View in Validation', exact: true }).click();
    await expect(page.getByText(/Main entry point not found/)).toBeVisible();
});

test('keeps validation diagnostics usable at compact viewports', async ({ page }) => {
    await openFixture(page);
    await selectGraphic(page, 'Bad Return');
    await expect(page.getByText(/updateAction\(\) returned status 400/)).toBeVisible();

    for (const viewport of [
        { width: 768, height: 720 },
        { width: 480, height: 800 },
    ]) {
        await page.setViewportSize(viewport);
        await expect(page.getByRole('button', { name: 'Open package navigation' })).toBeVisible();
        await expect(page.getByLabel('Validation summary')).toBeVisible();

        const layout = await page.evaluate(() => {
            const main = document.querySelector('main')?.getBoundingClientRect();
            const diagnostic = document.querySelector('article[aria-label$="failed"]')?.getBoundingClientRect();
            return {
                viewportWidth: window.innerWidth,
                documentWidth: document.documentElement.scrollWidth,
                main: main ? { left: main.left, right: main.right, width: main.width } : null,
                diagnostic: diagnostic
                    ? { left: diagnostic.left, right: diagnostic.right, width: diagnostic.width }
                    : null,
            };
        });

        expect(layout.documentWidth).toBe(layout.viewportWidth);
        expect(layout.main).not.toBeNull();
        expect(layout.main!.left).toBeGreaterThanOrEqual(0);
        expect(layout.main!.right).toBeLessThanOrEqual(viewport.width + 1);
        expect(layout.main!.width).toBeGreaterThan(viewport.width - 2);
        expect(layout.diagnostic).not.toBeNull();
        expect(layout.diagnostic!.left).toBeGreaterThanOrEqual(0);
        expect(layout.diagnostic!.right).toBeLessThanOrEqual(viewport.width + 1);
    }

    await page.getByRole('button', { name: 'Open package navigation' }).click();
    const packageNavigation = page.locator('aside');
    await expect(packageNavigation.getByText('Package navigation', { exact: true })).toBeVisible();
    await packageNavigation.getByRole('button', { name: 'Close package navigation' }).click();
    await expect.poll(async () => (await packageNavigation.boundingBox())?.x ?? 0).toBeLessThan(0);

    await page.getByRole('button', { name: 'Inspect', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Inspector overview' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Inspector sections' })).toHaveCount(0);
    await expect(page.getByText('Alternative 1', { exact: true })).toBeVisible();

    const inspectLayout = await page.getByTestId('inspect-layout').evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return {
            left: bounds.left,
            right: bounds.right,
            width: bounds.width,
            viewport: window.innerWidth,
            documentWidth: document.documentElement.scrollWidth,
        };
    });
    expect(inspectLayout.left).toBeGreaterThanOrEqual(0);
    expect(inspectLayout.right).toBeLessThanOrEqual(inspectLayout.viewport + 1);
    expect(inspectLayout.width).toBeGreaterThan(inspectLayout.viewport - 2);
    expect(inspectLayout.documentWidth).toBe(inspectLayout.viewport);

    await page.getByRole('button', { name: 'Inspect schema', exact: true }).click();
    await expect(page.getByText('No GDD schema defined.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Inspector overview', exact: true })).toBeVisible();
    const sectionPicker = page.getByLabel('Change inspector section');
    await sectionPicker.selectOption('actions');
    await expect(page.getByText('Ping', { exact: true })).toBeVisible();
    await sectionPicker.selectOption('manifest');
    await expect(page.getByText(/playwright-bad/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Inspector overview', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Inspector overview' })).toBeVisible();
});

test('keeps settings clear and usable at compact viewports', async ({ page }) => {
    await page.getByRole('button', { name: 'System Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByText('Choose dark mode, light mode, or your system setting.')).toBeVisible();

    const readThemeStyles = async () => page.evaluate(() => {
        const placeholder = document.createElement('input');
        placeholder.placeholder = 'Placeholder';
        const placeholderReference = document.createElement('span');
        placeholderReference.style.color = 'var(--color-gray-400)';
        const tokenProbe = document.createElement('span');
        tokenProbe.className = 'border border-ss-outline-variant/40 bg-ss-primary-container/10';
        document.body.append(placeholder, placeholderReference, tokenProbe);

        const resetPreview = Array.from(document.querySelectorAll('button'))
            .find((button) => button.textContent?.includes('Reset preview'));
        const styles = {
            background: getComputedStyle(document.body).backgroundColor,
            fontFamily: getComputedStyle(document.documentElement).fontFamily,
            placeholder: getComputedStyle(placeholder, '::placeholder').color,
            placeholderReference: getComputedStyle(placeholderReference).color,
            primaryToken: getComputedStyle(document.documentElement)
                .getPropertyValue('--ss-primary-container').trim(),
            outlineToken: getComputedStyle(document.documentElement)
                .getPropertyValue('--ss-outline-variant').trim(),
            tokenBackground: getComputedStyle(tokenProbe).backgroundColor,
            tokenBorder: getComputedStyle(tokenProbe).borderTopColor,
            resetRadius: resetPreview ? getComputedStyle(resetPreview).borderRadius : '',
            resetCursor: resetPreview ? getComputedStyle(resetPreview).cursor : '',
        };

        placeholder.remove();
        placeholderReference.remove();
        tokenProbe.remove();
        return styles;
    });

    const darkStyles = await readThemeStyles();
    expect(darkStyles.background).toBe('rgb(19, 19, 19)');
    expect(darkStyles.fontFamily).toContain('Open Sans');
    expect(darkStyles.placeholder).toBe(darkStyles.placeholderReference);
    expect(darkStyles.primaryToken).toBe('75 161 226');
    expect(darkStyles.outlineToken).toBe('64 72 80');
    expect(darkStyles.tokenBackground).toMatch(/\/ 0\.1\)$/u);
    expect(darkStyles.tokenBorder).toMatch(/\/ 0\.4\)$/u);
    expect(darkStyles.resetRadius).toBe('4px');
    expect(darkStyles.resetCursor).toBe('pointer');

    const theme = page.getByRole('group', { name: 'Theme', exact: true });
    await theme.getByRole('button', { name: 'Light', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/theme-light/);
    await expect.poll(async () => (await readThemeStyles()).background).toBe('rgb(246, 246, 246)');

    await page.emulateMedia({ colorScheme: 'light' });
    await theme.getByRole('button', { name: 'System', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/theme-system/);
    await expect.poll(async () => (await readThemeStyles()).background).toBe('rgb(246, 246, 246)');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(async () => (await readThemeStyles()).background).toBe('rgb(19, 19, 19)');

    const autoRevalidate = page.getByRole('switch', { name: 'Auto revalidate', exact: true });
    await expect(autoRevalidate).toHaveAttribute('aria-checked', 'false');
    await autoRevalidate.click();
    await expect(autoRevalidate).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('group', { name: 'Check interval', exact: true })
        .getByRole('button', { name: '5s', exact: true })
        .click();

    for (const viewport of [
        { width: 768, height: 720 },
        { width: 480, height: 800 },
    ]) {
        await page.setViewportSize(viewport);
        const layout = await page.locator('main').evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return {
                left: bounds.left,
                right: bounds.right,
                scrollWidth: element.scrollWidth,
                clientWidth: element.clientWidth,
                documentWidth: document.documentElement.scrollWidth,
                viewportWidth: window.innerWidth,
            };
        });
        expect(layout.left).toBeGreaterThanOrEqual(0);
        expect(layout.right).toBeLessThanOrEqual(viewport.width + 1);
        expect(layout.scrollWidth).toBe(layout.clientWidth);
        expect(layout.documentWidth).toBe(layout.viewportWidth);
        await expect(page.getByRole('button', { name: 'Reset preview', exact: true })).toBeVisible();
    }
});

test('keeps package overview and preview inside the target viewports', async ({ page }) => {
    await openFixture(page);

    for (const viewport of [
        { width: 1440, height: 900 },
        { width: 768, height: 720 },
        { width: 480, height: 800 },
    ]) {
        await page.setViewportSize(viewport);
        await expect(page.getByRole('heading', { name: 'Package Overview', exact: true })).toBeVisible();
        await expect(page.getByTestId('package-media').first()).toBeVisible();
        const overviewWidth = await page.evaluate(() => ({
            document: document.documentElement.scrollWidth,
            viewport: window.innerWidth,
        }));
        expect(overviewWidth.document).toBe(overviewWidth.viewport);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await selectGraphic(page, 'Alpha Graphic');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.frameLocator('iframe[aria-label="OGraf graphic preview"]').locator('#stage > *'))
        .toContainText('ALPHA:realtime');

    for (const viewport of [
        { width: 1440, height: 900 },
        { width: 768, height: 720 },
        { width: 480, height: 800 },
    ]) {
        await page.setViewportSize(viewport);
        const previewWidth = await page.evaluate(() => {
            const main = document.querySelector('main')?.getBoundingClientRect();
            return {
                document: document.documentElement.scrollWidth,
                viewport: window.innerWidth,
                mainLeft: main?.left,
                mainRight: main?.right,
            };
        });
        expect(previewWidth.document).toBe(previewWidth.viewport);
        expect(previewWidth.mainLeft).toBeGreaterThanOrEqual(0);
        expect(previewWidth.mainRight).toBeLessThanOrEqual(viewport.width + 1);
    }
});

test('runs committed valid fixtures and explains the committed runtime-invalid fixture', async ({ page }) => {
    test.slow();
    await writeOpfsFiles(page, repositoryFixtureFiles());
    await page.getByRole('button', { name: 'Open Directory', exact: true }).first().click();
    await expect(page.getByText('Lower Third').first()).toBeVisible();
    await expect(page.getByText('Invalid Runtime API').first()).toBeVisible();
    await expect(page.getByText('Football Scoreboard').first()).toBeVisible();
    await expect(page.getByText('Goal Flash').first()).toBeVisible();
    await expect(page.getByText('4/4', { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTitle('1 runtime test failed')).toBeVisible();
    const packageMedia = page.getByTestId('package-media');
    await expect(packageMedia).toHaveCount(4);
    await expect(packageMedia.getByText('Production-Ready', { exact: true })).toHaveCount(0);
    const mediaRatios = await packageMedia.evaluateAll((elements) => elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.width / bounds.height;
    }));
    for (const ratio of mediaRatios) expect(ratio).toBeCloseTo(16 / 9, 2);
    await expect(page.getByRole('img', { name: 'OGraf placeholder: Graphic package' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'OGraf placeholder: External thumbnail not loaded' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Goal Flash thumbnail' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Overall status: Production-Ready' })).toBeVisible();
    await expect(page.getByTitle('Production-Ready', { exact: true })).toBeVisible();
    const lowerThirdOverviewCard = page.locator('main').getByRole('button').filter({ hasText: 'Lower Third' }).first();
    await expect(lowerThirdOverviewCard.getByText('1 warning', { exact: true })).toBeVisible();
    await expect(lowerThirdOverviewCard.getByText('Render 1920 × 1080 ideal', { exact: true })).toBeVisible();
    await expect(lowerThirdOverviewCard.getByText('Runtime Inconclusive', { exact: true })).toHaveCount(0);
    await expect(lowerThirdOverviewCard.getByTitle(/Needs Review · 1 warning/)).toBeVisible();
    const footballOverviewCard = page.locator('main').getByRole('button').filter({ hasText: 'Football Scoreboard' }).first();
    await expect(footballOverviewCard.getByText('Render 1920 × 1080 · +1', { exact: true })).toBeVisible();
    const goalOverviewCard = page.locator('main').getByRole('button').filter({ hasText: 'Goal Flash' }).first();
    await expect(goalOverviewCard.getByText('Thumbnail 1672 × 941', { exact: true })).toBeVisible();
    await expect(page.getByText('· 1 failed', { exact: true })).toBeVisible();

    await selectGraphic(page, 'Lower Third');
    await expect(page.getByText('RT: required methods', { exact: true })).toBeVisible();
    await expect(page.getByText('RT: load()', { exact: true })).toBeVisible();
    await expect(page.getByText('RT: updateAction()', { exact: true })).toBeVisible();
    await expect(page.getByText('RT: playAction(goto: 0)', { exact: true })).toBeVisible();
    await expect(page.getByText('RT: stopAction()', { exact: true })).toBeVisible();
    await expect(page.getByText('RT: dispose()', { exact: true })).toBeVisible();
    await expect(page.getByText('Manifest Valid', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Runtime Inconclusive', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Needs Review', { exact: true }).first()).toBeVisible();

    await selectGraphic(page, 'Invalid Runtime API');
    await expect(page.getByRole('article', { name: 'RT: required methods failed' })).toBeVisible();
    await expect(page.getByTitle(
        /Missing required method\(s\): dispose\(\), playAction\(\), stopAction\(\), updateAction\(\), customAction\(\)\./,
    )).toBeVisible();
    await expect(page.getByText('Static validation passed.', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Manifest Valid', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Runtime Failed', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Not Production-Ready', { exact: true }).first()).toBeVisible();

    await selectGraphic(page, 'Football Scoreboard');
    await expect(page.getByText('RT: dispose()', { exact: true })).toBeVisible();
    await expect(page.getByText('NRT: setActionsSchedule()', { exact: true })).toBeVisible();
    await expect(page.getByText('NRT: goToTime(0)', { exact: true })).toBeVisible();
    await expect(page.getByText('NRT: dispose()', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Inspect', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Inspector overview' })).toBeVisible();
    await expect(page.getByText('Realtime: supported', { exact: true })).toBeVisible();
    await expect(page.getByText('Non-realtime: supported', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Inspect assets', exact: true }).click();
    const thumbnail = page.getByRole('img', { name: 'Thumbnail 1' });
    await expect(thumbnail).toBeVisible();
    await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => ({
        width: image.naturalWidth,
        height: image.naturalHeight,
    }))).toEqual({ width: 1672, height: 941 });
});

test.describe('without Service Worker control', () => {
    test.use({ serviceWorkers: 'block' });

    test('uses the isolated preview bridge', async ({ page }) => {
        await openFixture(page);
        await selectGraphic(page, 'Alpha Graphic');
        await expect(page.getByText('Runtime Passed', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

        await page.getByRole('button', { name: 'Preview', exact: true }).click();
        const frame = page.frameLocator('iframe[aria-label="OGraf graphic preview"]');
        await expect(frame.locator('#stage > *')).toContainText('ALPHA:realtime');
        await expect(frame.locator('#stage > *')).toHaveAttribute('data-asset-text', 'sandbox asset ok');
    });
});

async function installDirectoryPicker(context: BrowserContext): Promise<void> {
    await context.addInitScript(() => {
        Object.defineProperty(window, 'showDirectoryPicker', {
            configurable: true,
            value: async () => {
                const storageRoot = await navigator.storage.getDirectory();
                return storageRoot.getDirectoryHandle('ograf-playwright', { create: true });
            },
        });
    });
}

async function writeOpfsFixture(page: Page, files: Record<string, string>): Promise<void> {
    await writeOpfsFiles(page, Object.entries(files).map(([path, contents]) => ({
        path,
        encoding: 'text',
        contents,
    })));
}

async function writeOpfsFiles(page: Page, files: SerializedOpfsFile[]): Promise<void> {
    await page.evaluate(async (entries) => {
        const storageRoot = await navigator.storage.getDirectory();
        try {
            await storageRoot.removeEntry('ograf-playwright', { recursive: true });
        } catch {
            // A fresh browser context has no previous fixture.
        }
        const fixtureRoot = await storageRoot.getDirectoryHandle('ograf-playwright', { create: true });

        for (const entry of entries) {
            const segments = entry.path.split('/');
            const filename = segments.pop();
            if (!filename) continue;
            let directory = fixtureRoot;
            for (const segment of segments) {
                directory = await directory.getDirectoryHandle(segment, { create: true });
            }
            const file = await directory.getFileHandle(filename, { create: true });
            const writable = await file.createWritable();
            if (entry.encoding === 'text') {
                await writable.write(entry.contents);
            } else {
                const binary = atob(entry.contents);
                const bytes = new Uint8Array(binary.length);
                for (let index = 0; index < binary.length; index += 1) {
                    bytes[index] = binary.charCodeAt(index);
                }
                await writable.write(bytes);
            }
            await writable.close();
        }
    }, files);
}

function repositoryFixtureFiles(): SerializedOpfsFile[] {
    return REPOSITORY_FIXTURE_PATHS.map((relativePath) => ({
        path: `repository/${relativePath}`,
        encoding: 'base64',
        contents: readFileSync(new URL(`../../../fixtures/${relativePath}`, import.meta.url)).toString('base64'),
    }));
}

async function openFixture(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Open Directory', exact: true }).first().click();
    await expect(page.getByText('Alpha Graphic').first()).toBeVisible();
    await expect(page.getByText('Beta Dual').first()).toBeVisible();
    await expect(page.getByText('Bad Return').first()).toBeVisible();
}

async function selectGraphic(page: Page, name: string): Promise<void> {
    await page.getByRole('button').filter({ hasText: name }).first().click();
    await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
}

async function currentGraphicSession(page: Page): Promise<string | undefined> {
    const frame = await currentPreviewFrame(page);
    if (!frame) return undefined;
    return frame.evaluate(() => {
        const baseUrl = document.querySelector<HTMLBaseElement>('#ograf-base')?.href;
        const resource = baseUrl ?? performance.getEntriesByType('resource')
            .map((entry) => entry.name)
            .find((name) => name.includes('/__ograf_preview__/'));
        return resource?.match(/\/__ograf_preview__\/([^/]+)\//)?.[1];
    });
}

async function currentPreviewFrame(page: Page) {
    const iframe = await page.locator('iframe[aria-label="OGraf graphic preview"]').elementHandle();
    return iframe?.contentFrame() ?? undefined;
}

function fixtureFiles(): Record<string, string> {
    return {
        'alpha.ograf.json': JSON.stringify(manifest({
            id: 'playwright-alpha',
            name: 'Alpha Graphic',
            main: 'alpha.mjs',
            supportsRealTime: true,
            supportsNonRealTime: false,
        })),
        'beta.ograf.json': JSON.stringify(manifest({
            id: 'playwright-beta',
            name: 'Beta Dual',
            main: 'beta.mjs',
            supportsRealTime: true,
            supportsNonRealTime: true,
        })),
        'bad.ograf.json': JSON.stringify(manifest({
            id: 'playwright-bad',
            name: 'Bad Return',
            main: 'bad.mjs',
            supportsRealTime: true,
            supportsNonRealTime: false,
        })),
        'static-invalid.ograf.json': JSON.stringify(manifest({
            id: 'playwright-static-invalid',
            name: 'Static Invalid',
            main: 'missing-entry.mjs',
            supportsRealTime: true,
            supportsNonRealTime: false,
        })),
        'helpers/über helper.mjs': "export const alphaLabel = 'ALPHA';\n",
        'helpers/lazy.mjs': "export const loaded = true;\n",
        'assets/sandbox marker.txt': 'sandbox asset ok',
        'assets/runtime data.json': '{"loaded":true}',
        'assets/official logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>',
        'assets/variable logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="blue"/></svg>',
        'assets/variable url.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="green"/></svg>',
        'assets/srcset one.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="orange"/></svg>',
        'assets/srcset two.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="purple"/></svg>',
        'assets/css background.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="cyan"/></svg>',
        'assets/package font.woff2': 'test-font-bytes',
        'styles/main.css': '@import "./nested.css";\n@font-face { font-family: "Package Font"; src: url("../assets/package font.woff2") format("woff2"); }\n.resource-graphic { font-family: "Package Font", sans-serif; }',
        'styles/nested.css': '.resource-graphic { background-image: url("../assets/css background.svg"); }',
        'workers/module-worker.mjs': "import { value } from './module-helper.mjs'; self.onmessage = async () => self.postMessage(value + ':' + (await import('./module-lazy.mjs')).lazy + ':' + await fetch('./worker data.txt').then(r => r.text()));",
        'workers/module-helper.mjs': "export const value = 'module';",
        'workers/module-lazy.mjs': "export const lazy = 'lazy';",
        'workers/worker data.txt': 'worker data',
        'workers/classic-worker.js': "importScripts('./classic-dep.js'); self.onmessage = async () => self.postMessage(self.classicValue + ':' + await fetch('./classic data.txt').then(r => r.text()));",
        'workers/classic-dep.js': "self.classicValue = 'classic';",
        'workers/classic data.txt': 'classic data',
        'workers/error-worker.mjs': "self.onmessage = () => { throw new Error('worker fixture failure'); };",
        'alpha.mjs': `${runtimeModule([
            "import { alphaLabel as label } from './helpers/über helper.mjs';",
            "const lazyPath = './helpers/lazy.mjs';",
            'const loadDependency = async () => {',
            '  await import(import.meta.resolve(lazyPath));',
            "  return fetch(import.meta.resolve('./assets/runtime data.json')).then((response) => response.json());",
            '};',
            "const assetBaseSpecifier = './assets/';",
            'const assetBaseUrl = new URL(assetBaseSpecifier, import.meta.url);',
            "const assetUrl = new URL('sandbox marker.txt', assetBaseUrl);",
            'const loadOfficialStyleImage = () => new Promise((resolve, reject) => {',
            '  const image = new Image();',
            '  image.onload = () => resolve(image.currentSrc);',
            '  image.onerror = reject;',
            "  image.src = import.meta.resolve('./assets/official logo.svg');",
            '});',
            "const variableImagePath = './assets/variable logo.svg';",
            'const loadVariableImage = () => new Promise((resolve, reject) => {',
            '  const image = new Image();',
            '  image.onload = () => resolve(image.currentSrc);',
            '  image.onerror = reject;',
            '  image.src = import.meta.resolve(variableImagePath);',
            '});',
            "const variableUrlPath = './assets/variable url.svg';",
            'const loadVariableUrlImage = () => new Promise((resolve, reject) => {',
            '  const image = new Image();',
            '  image.onload = () => resolve(image.currentSrc);',
            '  image.onerror = reject;',
            "  image.setAttribute('src', new URL(variableUrlPath, import.meta.url).href);",
            '});',
            'const waitForImage = (image) => new Promise((resolve, reject) => { image.onload = () => resolve(image.currentSrc); image.onerror = () => reject(new Error("srcset image failed: " + (image.currentSrc || image.src))); });',
            'const waitForValue = async (read, label) => { for (let attempt = 0; attempt < 100; attempt += 1) { const value = read(); if (value.includes("blob:")) return value; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error(label + " was not rewritten to a package Blob URL"); };',
            'const waitForWorker = (worker) => new Promise((resolve, reject) => { worker.onmessage = (event) => resolve(event.data); worker.onerror = (event) => reject(new Error(event.message || event.error?.message || (event.filename ? `Worker failed at ${event.filename}:${event.lineno}:${event.colno}` : "Worker failed without browser details"))); worker.postMessage("start"); });',
            "const unusedDynamicWorker = (path) => new Worker(path, { type: 'module' });",
            "const unusedSharedWorker = () => new SharedWorker('./workers/module-worker.mjs', { type: 'module' });",
            'const loadResourceFeatures = async (element) => {',
            '  element.classList.add("resource-graphic");',
            '  const stylesheet = document.createElement("link");',
            '  stylesheet.rel = "stylesheet";',
            "  stylesheet.href = import.meta.resolve('./styles/main.css');",
            '  await new Promise((resolve, reject) => { stylesheet.onload = resolve; stylesheet.onerror = () => reject(new Error("stylesheet failed: " + stylesheet.href)); document.head.append(stylesheet); });',
            '  const computed = getComputedStyle(element);',
            '  element.dataset.cssBackground = computed.backgroundImage;',
            '  element.dataset.cssFont = computed.fontFamily;',
            '  element.classList.add("inline-resource");',
            '  const inlineStyle = document.createElement("style");',
            '  inlineStyle.textContent = ".inline-resource { border-image-source: url(./assets/srcset%20one.svg); }";',
            '  element.append(inlineStyle);',
            '  inlineStyle.textContent = ".inline-resource { border-image-source: url(./assets/srcset%20two.svg); }";',
            '  element.dataset.inlineStyle = await waitForValue(() => getComputedStyle(element).borderImageSource, "inline style");',
            '  element.style.maskImage = "url(./assets/variable%20logo.svg)";',
            '  element.dataset.directStyle = await waitForValue(() => getComputedStyle(element).maskImage, "element.style");',
            '  const sourceImage = new Image();',
            '  const imageReady = waitForImage(sourceImage);',
            "  sourceImage.srcset = import.meta.resolve('./assets/srcset one.svg') + ' 1x';",
            "  sourceImage.srcset = import.meta.resolve('./assets/srcset two.svg') + ' 1x';",
            "  sourceImage.src = import.meta.resolve('./assets/srcset one.svg');",
            '  element.dataset.srcsetProtocol = new URL(await imageReady).protocol;',
            '  element.dataset.srcsetWidth = String(sourceImage.naturalWidth);',
            "  const moduleWorker = new Worker(new URL('./workers/module-worker.mjs', import.meta.url), { type: 'module' });",
            "  const classicWorker = new Worker(new URL('./workers/classic-worker.js', import.meta.url));",
            "  const errorWorker = new Worker(new URL('./workers/error-worker.mjs', import.meta.url), { type: 'module' });",
            '  element.dataset.moduleWorker = await waitForWorker(moduleWorker);',
            '  element.dataset.classicWorker = await waitForWorker(classicWorker);',
            '  try { await waitForWorker(errorWorker); } catch (error) { element.dataset.workerError = error instanceof Error ? error.message : String(error); }',
            '  moduleWorker.terminate();',
            '  classicWorker.terminate();',
            '  errorWorker.terminate();',
            '};',
        ].join('\n'), 'label', false, '(await loadDependency(), this.dataset.imageProtocol = new URL(await loadOfficialStyleImage()).protocol, this.dataset.variableImageProtocol = new URL(await loadVariableImage()).protocol, this.dataset.variableUrlProtocol = new URL(await loadVariableUrlImage()).protocol, await loadResourceFeatures(this), assetUrl)')}`,
        'beta.mjs': runtimeModule("const label = 'BETA';", 'label'),
        'bad.mjs': runtimeModule("const label = 'BAD';", 'label', true),
    };
}

function manifest(options: {
    id: string;
    name: string;
    main: string;
    supportsRealTime: boolean;
    supportsNonRealTime: boolean;
}) {
    return {
        $schema: OFFICIAL_SCHEMA,
        ...options,
        version: '1.0.0',
        author: { name: 'Playwright' },
        stepCount: 2,
        customActions: [{
            id: 'ping',
            name: 'Ping',
            schema: {
                type: 'object',
                properties: {
                    value: { type: 'string', default: 'from-default' },
                },
            },
        }],
        actionDurations: [
            { type: 'playAction', duration: 25 },
            { type: 'customAction', customActionId: 'ping', duration: 0 },
        ],
        renderRequirements: [{
            resolution: {
                width: { exact: 1280 },
                height: { exact: 720 },
            },
            frameRate: { exact: 50 },
        }],
    };
}

function runtimeModule(
    prefix: string,
    labelExpression: string,
    badUpdate = false,
    assetExpression = 'undefined',
): string {
    return `${prefix}
export default class PlaywrightGraphic extends HTMLElement {
    active = 0;
    maxConcurrent = 0;

    async load(params) {
        this.textContent = ${labelExpression} + ':' + params.renderType;
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        const resolvedAssetUrl = ${assetExpression};
        if (resolvedAssetUrl instanceof URL) {
            this.dataset.assetProtocol = resolvedAssetUrl.protocol;
            this.dataset.assetText = await fetch(resolvedAssetUrl).then((response) => response.text());
        }
        let parentDocumentBlocked = false;
        try {
            parent.document.body.dataset.sandboxMutation = 'yes';
        } catch {
            parentDocumentBlocked = true;
        }
        let parentStorageBlocked = false;
        try {
            parent.localStorage.setItem('sandboxMutation', 'yes');
        } catch {
            parentStorageBlocked = true;
        }
        this.dataset.parentBlocked = String(parentDocumentBlocked && parentStorageBlocked);
        return { statusCode: 201 };
    }

    async dispose() {
        console.info('disposed', ${labelExpression});
        return { statusCode: 204 };
    }

    async playAction(params) {
        this.active += 1;
        this.maxConcurrent = Math.max(this.maxConcurrent, this.active);
        this.dataset.maxConcurrent = String(this.maxConcurrent);
        await new Promise((resolve) => setTimeout(resolve, 150));
        this.active -= 1;
        return { statusCode: 200, currentStep: params.goto };
    }

    async stopAction() {
        return { statusCode: 204 };
    }

    async updateAction() {
        return { statusCode: ${badUpdate ? 400 : 202}, statusMessage: ${badUpdate ? "'bad update'" : "'accepted'"} };
    }

    async customAction() {
        return { statusCode: 200 };
    }

    async goToTime() {
        return { statusCode: 200 };
    }

    async setActionsSchedule() {
        return undefined;
    }
}
`;
}
