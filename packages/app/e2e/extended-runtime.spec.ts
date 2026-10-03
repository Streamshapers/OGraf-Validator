import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type { ValidationReport } from '../src/readiness/validation-report.js';

const GRAPHIC_NAME = 'Extended regression';
const SANDBOX = 'iframe[aria-label="OGraf runtime test sandbox"]';
const BASE_MANIFEST = {
    $schema: 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json',
    id: 'extended-regression',
    name: GRAPHIC_NAME,
    main: 'graphic.mjs',
    supportsRealTime: true,
    supportsNonRealTime: false,
    stepCount: 3,
    schema: { type: 'object', properties: {} },
};

function graphic(overrides = ''): string {
    return `export default class Graphic extends HTMLElement {
        async load() { this.step = undefined; }
        async updateAction() {}
        async playAction({ goto, delta = 1, skipAnimation }) {
            this.animated = !skipAnimation;
            const target = goto ?? ((this.step ?? -1) + delta);
            this.step = target >= 3 ? undefined : target;
            return { statusCode: 200, currentStep: this.step };
        }
        async stopAction() { this.step = undefined; }
        async customAction() {}
        async dispose() {}
        async setActionsSchedule() {}
        async goToTime() {}
        ${overrides}
    }`;
}

const CONTROLLED_GRAPHIC = graphic(`
    async load() {
        this.step = undefined;
        this.mode = (await (await fetch('./control.json')).json()).mode;
        this.worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
        await new Promise((resolve) => { this.worker.onmessage = () => resolve(); });
    }
    async playAction({ goto, delta = 1, skipAnimation }) {
        if (!skipAnimation && this.mode === 'hold') {
            this.dataset.holding = 'true';
            await new Promise(() => {});
        }
        const target = goto ?? ((this.step ?? -1) + delta);
        this.step = target >= 3 ? undefined : target;
        return {
            statusCode: 200,
            currentStep: this.mode === 'broken' && this.step === 1 ? 999 : this.step,
        };
    }
`);

async function openGraphic(
    page: Page,
    source: string,
    manifest: Record<string, unknown> = {},
    options: { controlled?: boolean; secondGraphic?: boolean; mode?: string; standardFailed?: boolean } = {},
): Promise<void> {
    await page.addInitScript(({ controlled, mode }) => {
        localStorage.setItem('ograf-settings', JSON.stringify({ autoRevalidate: false }));
        Object.defineProperty(window, '__extendedFixtureMode', {
            configurable: true, writable: true, value: mode ?? 'good',
        });
        Object.defineProperty(window, 'showDirectoryPicker', {
            configurable: true,
            value: async () => {
                const directory = await (await navigator.storage.getDirectory())
                    .getDirectoryHandle('extended-regression', { create: true });
                if (!controlled) return directory;
                return new Proxy(directory, {
                    get(target, key) {
                        if (key === 'getFileHandle') return async (name: string) => {
                            const handle = await target.getFileHandle(name);
                            if (name !== 'control.json') return handle;
                            return {
                                kind: 'file', name,
                                getFile: async () => new File([
                                    JSON.stringify({ mode: Reflect.get(window, '__extendedFixtureMode') }),
                                ], name, { type: 'application/json', lastModified: 1 }),
                            };
                        };
                        const value = Reflect.get(target, key, target);
                        return typeof value === 'function' ? value.bind(target) : value;
                    },
                });
            },
        });
    }, { controlled: options.controlled ?? false, mode: options.mode });
    await page.goto('/');
    await page.evaluate(async (files) => {
        const directory = await (await navigator.storage.getDirectory())
            .getDirectoryHandle('extended-regression', { create: true });
        for (const [name, contents] of Object.entries(files)) {
            const handle = await directory.getFileHandle(name, { create: true });
            const writer = await handle.createWritable();
            await writer.write(contents);
            await writer.close();
        }
    }, {
        'manifest.ograf.json': JSON.stringify({ ...BASE_MANIFEST, ...manifest }),
        'graphic.mjs': source,
        ...(options.controlled ? {
            'control.json': JSON.stringify({ mode: options.mode ?? 'good' }),
            'worker.mjs': 'self.postMessage("ready"); setInterval(() => {}, 1000);',
        } : {}),
        ...(options.secondGraphic ? {
            'other.ograf.json': JSON.stringify({
                ...BASE_MANIFEST, id: 'other-regression', name: 'Other regression', main: 'other.mjs',
            }),
            'other.mjs': graphic(),
        } : {}),
    });
    await page.getByRole('button', { name: 'Open Directory', exact: true }).first().click();
    await selectGraphic(page, GRAPHIC_NAME);
    await expect(page.getByText(options.standardFailed ? 'Runtime Failed' : 'Runtime Passed',
        { exact: true }).first()).toBeVisible();
}

async function selectGraphic(page: Page, name: string): Promise<void> {
    await page.getByRole('button').filter({ hasText: name }).first().click();
    await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
}

async function finishExtended(page: Page, rerun = false): Promise<void> {
    await page.getByRole('button', {
        name: rerun ? 'Rerun extended tests' : 'Run extended tests', exact: true,
    }).click();
    await expect(page.getByRole('button', { name: 'Rerun extended tests', exact: true }))
        .toBeEnabled();
    await expect(page.getByRole('status', { name: 'Extended runtime activity' })).toHaveCount(0);
    await expect(page.locator(SANDBOX)).toHaveCount(0);
    await expect.poll(() => page.workers().length).toBe(0);
}

async function exportReport(page: Page): Promise<ValidationReport> {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
    const file = await (await pending).path();
    if (!file) throw new Error('Report download has no local file.');

    return JSON.parse(await readFile(file, 'utf8')) as ValidationReport;
}

async function setMode(page: Page, mode: string): Promise<void> {
    await page.evaluate((value) => Reflect.set(window, '__extendedFixtureMode', value), mode);
}

test('extended checks are opt-in and complete RT/NRT navigation with matching exports', async ({ page }) => {
    await openGraphic(page, graphic(), { supportsNonRealTime: true });
    await expect(page.getByRole('button', { name: 'Run extended tests', exact: true })).toBeEnabled();
    const before = await exportReport(page);
    expect(before.runtimeTest.result?.passed).toBe(true);
    expect(before.extendedRuntimeTest?.result ?? null).toBeNull();

    await finishExtended(page);
    const report = await exportReport(page);
    expect(report.runtimeTest.result?.passed).toBe(true);
    expect(report.extendedRuntimeTest?.status).toBe('passed');
    expect(report.extendedRuntimeTest?.result).toMatchObject({
        suite: 'extended', passed: true, outcome: 'completed', budgetMinutes: 2,
    });
    expect(report.extendedRuntimeTest?.result?.scenarios).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'rt.steps', status: 'passed' }),
        expect.objectContaining({ id: 'nrt.steps', status: 'passed' }),
        expect.objectContaining({ id: 'rt.animation-repeat', status: 'passed' }),
        expect.objectContaining({ id: 'nrt.seeking', status: 'passed' }),
    ]));
    expect(report.extendedRuntimeTest?.result?.steps.some((step) => (
        step.checkId === 'rt.steps.previous' && step.expectedCurrentStep === 0
            && step.actualCurrentStep === 0
    ))).toBe(true);
    await expect(page.getByText('Production-Ready', { exact: true }).first()).toBeVisible();

    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export HTML', exact: true }).click();
    const html = await readFile((await (await pending).path())!, 'utf8');
    expect(html).toContain('Extended Runtime Test');
    expect(html).toContain('rt.steps.previous');
    expect(html).toContain('nrt.seeking');
});

test('detects a wrong later step while preserving the successful standard result', async ({ page }) => {
    await openGraphic(page, CONTROLLED_GRAPHIC, {}, { controlled: true, mode: 'broken' });
    await finishExtended(page);
    await expect(page.getByText('CURRENT_STEP_MISMATCH', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Runtime Failed', { exact: true }).first()).toBeVisible();
    const report = await exportReport(page);
    expect(report.runtimeTest.result?.passed).toBe(true);
    expect(report.extendedRuntimeTest?.status).toBe('failed');
    expect(report.extendedRuntimeTest?.result?.steps).toEqual(expect.arrayContaining([
        expect.objectContaining({
            status: 'fail', scenarioId: 'rt.steps', expectedCurrentStep: 1, actualCurrentStep: 999,
            diagnostic: expect.objectContaining({ code: 'CURRENT_STEP_MISMATCH' }),
        }),
    ]));
});

test('finds an NRT error beyond the standard zero timestamp', async ({ page }) => {
    await openGraphic(page, graphic(`async goToTime({ timestamp }) {
        if (timestamp === 750) throw new Error('Later NRT frame failed');
    }`), { supportsRealTime: false, supportsNonRealTime: true });
    await finishExtended(page);
    await expect(page.getByText(/Later NRT frame failed/).first()).toBeVisible();
    const report = await exportReport(page);
    expect(report.runtimeTest.result?.passed).toBe(true);
    expect(report.extendedRuntimeTest?.result?.steps).toEqual(expect.arrayContaining([
        expect.objectContaining({ status: 'fail', scenarioId: 'nrt.seeking', renderMode: 'NRT' }),
    ]));
});

for (const phase of ['play', 'cleanup']) {
    test(`records real asynchronous ${phase} rejections in extended scenarios`, async ({ page }) => {
        const error = `Unhandled extended ${phase}`;
        const override = phase === 'play' ? `
            async updateAction({ skipAnimation }) {
                if (!skipAnimation) {
                    Promise.reject(new Error('${error}'));
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
            }
        ` : `
            async dispose() {
                if (this.animated) {
                    Promise.reject(new Error('${error}'));
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
            }
        `;
        await openGraphic(page, graphic(override));
        await finishExtended(page);
        await expect(page.getByText('UNCAUGHT_RUNTIME_ERROR', { exact: true }).first()).toBeVisible();
        const report = await exportReport(page);
        expect(report.runtimeTest.result?.passed).toBe(true);
        expect(report.extendedRuntimeTest?.result?.steps).toEqual(expect.arrayContaining([
            expect.objectContaining({
                status: 'fail', scenarioId: 'rt.animation-repeat', error: expect.stringContaining(error),
            }),
        ]));
    });
}

test('retains known failures through cancelled retries and clears them after a complete success', async ({ page }) => {
    await openGraphic(page, CONTROLLED_GRAPHIC, {}, { controlled: true, mode: 'broken' });
    await finishExtended(page);
    await expect(page.getByText('CURRENT_STEP_MISMATCH', { exact: true }).first()).toBeVisible();

    for (let attempt = 0; attempt < 2; attempt++) {
        await setMode(page, 'hold');
        await page.getByRole('button', { name: 'Rerun extended tests', exact: true }).click();
        await expect(page.frameLocator(SANDBOX).locator('#stage > *'))
            .toHaveAttribute('data-holding', 'true');
        await expect.poll(() => page.workers().length).toBeGreaterThan(0);
        await expect(page.getByText('CURRENT_STEP_MISMATCH', { exact: true }).first()).toBeVisible();
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Rerun extended tests', exact: true }))
            .toBeEnabled();
        await expect(page.locator(SANDBOX)).toHaveCount(0);
        await expect.poll(() => page.workers().length).toBe(0);
        const cancelled = await exportReport(page);
        expect(cancelled.extendedRuntimeTest?.latestAttempt?.outcome).toBe('cancelled');
        expect(cancelled.extendedRuntimeTest?.status).toBe('failed');
        expect(cancelled.extendedRuntimeTest?.retainedFailures).toEqual(expect.arrayContaining([
            expect.objectContaining({ diagnostic: expect.objectContaining({ code: 'CURRENT_STEP_MISMATCH' }) }),
        ]));
    }

    await setMode(page, 'good');
    await finishExtended(page, true);
    const fixed = await exportReport(page);
    expect(fixed.extendedRuntimeTest?.status).toBe('passed');
    expect(fixed.extendedRuntimeTest?.retainedFailures).toEqual([]);
    await expect(page.getByText('CURRENT_STEP_MISMATCH', { exact: true })).toHaveCount(0);
});

test('continues across graphic navigation and permits cancellation from the global status', async ({ page }) => {
    await openGraphic(page, CONTROLLED_GRAPHIC, {}, {
        controlled: true, secondGraphic: true, mode: 'hold',
    });
    await selectGraphic(page, 'Other regression');
    await expect(page.getByText('Runtime Passed', { exact: true }).first()).toBeVisible();
    await selectGraphic(page, GRAPHIC_NAME);
    await page.getByRole('button', { name: 'Run extended tests', exact: true }).click();
    await expect(page.frameLocator(SANDBOX).locator('#stage > *'))
        .toHaveAttribute('data-holding', 'true');
    await selectGraphic(page, 'Other regression');
    const activity = page.getByRole('status', { name: 'Extended runtime activity' });
    await expect(activity).toContainText(GRAPHIC_NAME);
    await expect(page.frameLocator(SANDBOX).locator('#stage > *'))
        .toHaveAttribute('data-holding', 'true');
    await activity.getByRole('button', { name: `Cancel extended test for ${GRAPHIC_NAME}` }).click();
    await expect(activity).toHaveCount(0);
    await expect(page.locator(SANDBOX)).toHaveCount(0);
    await expect.poll(() => page.workers().length).toBe(0);
    await selectGraphic(page, GRAPHIC_NAME);
    const cancelled = await exportReport(page);
    expect(cancelled.extendedRuntimeTest?.latestAttempt?.outcome).toBe('cancelled');
    expect(cancelled.extendedRuntimeTest?.status).toBe('inconclusive');
});

test('invalidates changed manifests on selection and rejects late errors from the old attempt', async ({ page }) => {
    const source = CONTROLLED_GRAPHIC.replace('async dispose() {}', `async dispose() {
        if (this.dataset.holding === 'true') {
            console.info('OLD_SCOPE_CLEANUP');
            Promise.reject(new Error('OLD_PACKAGE_REJECTION'));
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }`);
    await openGraphic(page, source, {}, {
        controlled: true, secondGraphic: true, mode: 'broken',
    });
    await finishExtended(page);
    await expect(page.getByText('CURRENT_STEP_MISMATCH', { exact: true }).first()).toBeVisible();
    await setMode(page, 'hold');
    await page.getByRole('button', { name: 'Rerun extended tests', exact: true }).click();
    await expect(page.frameLocator(SANDBOX).locator('#stage > *'))
        .toHaveAttribute('data-holding', 'true');
    await selectGraphic(page, 'Other regression');

    await page.evaluate(async () => {
        const directory = await (await navigator.storage.getDirectory())
            .getDirectoryHandle('extended-regression');
        const handle = await directory.getFileHandle('manifest.ograf.json');
        const manifest = JSON.parse(await (await handle.getFile()).text());
        const writer = await handle.createWritable();
        await writer.write(JSON.stringify({ ...manifest, description: 'Updated while running' }));
        await writer.close();
    });
    const cleanup = page.waitForEvent('console', (message) => message.text() === 'OLD_SCOPE_CLEANUP');
    await selectGraphic(page, GRAPHIC_NAME);
    await cleanup;
    await expect(page.getByRole('button', { name: 'Run extended tests', exact: true })).toBeEnabled();
    await expect(page.getByRole('status', { name: 'Extended runtime activity' })).toHaveCount(0);
    await expect(page.locator(SANDBOX)).toHaveCount(0);
    await expect.poll(() => page.workers().length).toBe(0);
    await expect(page.getByText('Runtime Passed', { exact: true }).first()).toBeVisible();
    const report = await exportReport(page);
    expect(report.extendedRuntimeTest).toBeUndefined();
    expect(report.runtimeTest.result?.passed).toBe(true);
    expect(JSON.stringify(report)).not.toContain('OLD_PACKAGE_REJECTION');
    expect(JSON.stringify(report)).not.toContain('CURRENT_STEP_MISMATCH');
    await expect(page.getByText('OLD_PACKAGE_REJECTION', { exact: false })).toHaveCount(0);
});

test('cancels a queued extended test without creating a sandbox or declaring success', async ({ page }) => {
    await openGraphic(page, CONTROLLED_GRAPHIC, {}, {
        controlled: true, secondGraphic: true, mode: 'hold',
    });
    await selectGraphic(page, 'Other regression');
    await expect(page.getByText('Runtime Passed', { exact: true }).first()).toBeVisible();
    await selectGraphic(page, GRAPHIC_NAME);
    await page.getByRole('button', { name: 'Run extended tests', exact: true }).click();
    await expect(page.frameLocator(SANDBOX).locator('#stage > *'))
        .toHaveAttribute('data-holding', 'true');
    await page.evaluate((sandboxSelector) => {
        const createdSandboxes: string[] = [];
        Reflect.set(window, '__createdQueuedSandboxes', createdSandboxes);
        new MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (node instanceof HTMLIFrameElement && node.matches(sandboxSelector)) {
                        createdSandboxes.push(node.src);
                    }
                }
            }
        }).observe(document.body, { childList: true, subtree: true });
    }, SANDBOX);

    await selectGraphic(page, 'Other regression');
    await page.getByRole('button', { name: 'Run extended tests', exact: true }).click();
    const card = page.getByRole('region', { name: 'Extended runtime test', exact: true });
    await expect(card.getByText('Pending', { exact: true })).toBeVisible();
    await expect(card.getByText('Waiting to start.', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Rerun extended tests', exact: true })).toBeEnabled();
    const report = await exportReport(page);
    expect(report.extendedRuntimeTest?.status).toBe('inconclusive');
    expect(report.extendedRuntimeTest?.latestAttempt).toMatchObject({
        outcome: 'cancelled', inconclusive: true, totalDurationMs: 0,
    });
    expect(report.extendedRuntimeTest?.latestAttempt?.steps.some((step) => step.status === 'pass'))
        .toBe(false);

    const active = page.getByRole('status', { name: 'Extended runtime activity' });
    await expect(active).toContainText(GRAPHIC_NAME);
    await active.getByRole('button', { name: `Cancel extended test for ${GRAPHIC_NAME}` }).click();
    await expect(active).toHaveCount(0);
    await expect(page.locator(SANDBOX)).toHaveCount(0);
    await expect.poll(() => page.workers().length).toBe(0);
    expect(await page.evaluate(() => Reflect.get(window, '__createdQueuedSandboxes'))).toEqual([]);
    await expect(card.getByText('Inconclusive', { exact: true })).toBeVisible();
});

test('combines the same contract failure across suites in UI, clipboard and reports', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openGraphic(page, graphic(`async setActionsSchedule() { return { statusCode: 200 }; }`),
        { supportsNonRealTime: true }, { standardFailed: true });
    await finishExtended(page);
    const findings = page.getByRole('region', { name: 'Runtime findings', exact: true });
    const issue = findings.getByRole('article');
    await expect(issue).toHaveCount(1);
    await expect(issue).toContainText('3 occurrences');
    await expect(issue).toContainText('Standard test · Extended test');
    await expect(page.getByText('INVALID_EMPTY_PAYLOAD', { exact: true })).toHaveCount(1);
    const standard = page.getByRole('region', { name: 'Standard runtime test', exact: true });
    const extended = page.getByRole('region', { name: 'Extended runtime test', exact: true });
    for (const card of [standard, extended]) {
        await expect(card.getByRole('article')).toHaveCount(0);
        await expect(card.getByRole('link', { name: 'setActionsSchedule()', exact: true }))
            .toHaveAttribute('href', '#runtime-finding-1');
        await expect(card).toContainText('Not fully tested');
    }
    await extended.getByRole('link', { name: 'setActionsSchedule()', exact: true }).click();
    await expect(issue).toBeInViewport();
    await issue.getByText('Show calls and scenarios (3)', { exact: true }).click();
    await expect(issue.getByText(/nrt.seeking.schedule/)).toBeVisible();
    await issue.getByRole('button', { name: 'Copy diagnostic' }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('standard');
    expect(copied).toContain('extended');
    expect(copied).toContain('nrt.seeking.schedule');
    expect(copied.match(/INVALID_EMPTY_PAYLOAD/g)).toHaveLength(1);
    const report = await exportReport(page);
    expect(report.readiness).toMatchObject({ totalIssues: 1, runtimeErrors: 1,
        runtimeCoverageIncomplete: true });
    expect(report.runtimeFindings).toHaveLength(1);
    expect(report.runtimeFindings?.[0]?.occurrences).toHaveLength(3);
    expect(report.runtimeTest.result?.steps.filter((step) => step.status === 'fail')).toHaveLength(1);
    expect(report.extendedRuntimeTest?.result?.steps.filter((step) => step.status === 'fail')).toHaveLength(2);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export HTML', exact: true }).click();
    const html = await readFile((await (await downloading).path())!, 'utf8');
    expect(html.match(/INVALID_EMPTY_PAYLOAD/g)).toHaveLength(1);
    expect(html.match(/href="#runtime-finding-1"/g)).toHaveLength(3);
    for (const width of [390, 640, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(issue).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
});
