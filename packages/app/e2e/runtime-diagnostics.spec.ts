import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const GRAPHIC_NAME = 'Diagnostic regression';
const BASE_MANIFEST = {
    $schema: 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json',
    id: 'diagnostic-regression',
    name: GRAPHIC_NAME,
    main: 'graphic.mjs',
    supportsRealTime: true,
    supportsNonRealTime: false,
    schema: { type: 'object', properties: {} },
};

function graphic(overrides = ''): string {
    return `export default class Graphic extends HTMLElement {
        async load() {}
        async updateAction() {}
        async playAction() { return { statusCode: 200, currentStep: 0 }; }
        async stopAction() {}
        async customAction() {}
        async dispose() {}
        async setActionsSchedule() {}
        async goToTime() {}
        ${overrides}
    }`;
}

async function openGraphic(
    page: Page,
    source: string,
    manifest: Record<string, unknown> = {},
    pendingResource = false,
    extraFiles: Record<string, string> = {},
): Promise<void> {
    await page.addInitScript((holdResource) => {
        Object.defineProperty(window, 'showDirectoryPicker', {
            configurable: true,
            value: async () => {
                const directory = await (await navigator.storage.getDirectory())
                    .getDirectoryHandle('diagnostic-regression', { create: true });
                if (!holdResource) return directory;
                return new Proxy(directory, {
                    get(target, key) {
                        if (key === 'getFileHandle') return async (name: string) => {
                            const handle = await target.getFileHandle(name);
                            if (name !== 'slow.txt') return handle;
                            return {
                                kind: 'file', name,
                                getFile: async () => {
                                    const file = await handle.getFile();
                                    Object.defineProperty(file, 'arrayBuffer', {
                                        value: () => new Promise(() => {}),
                                    });
                                    return file;
                                },
                            };
                        };
                        const value = Reflect.get(target, key, target);
                        return typeof value === 'function' ? value.bind(target) : value;
                    },
                });
            },
        });
    }, pendingResource);
    await page.goto('/');
    await page.evaluate(async (files) => {
        const directory = await (await navigator.storage.getDirectory())
            .getDirectoryHandle('diagnostic-regression', { create: true });
        for (const [name, content] of Object.entries(files)) {
            const file = await directory.getFileHandle(name, { create: true });
            const writable = await file.createWritable();
            await writable.write(content);
            await writable.close();
        }
    }, {
        'manifest.ograf.json': JSON.stringify({ ...BASE_MANIFEST, ...manifest }),
        'graphic.mjs': source,
        ...(pendingResource ? { 'slow.txt': 'An intentionally pending broker resource.' } : {}),
        ...extraFiles,
    });
    await page.getByRole('button', { name: 'Open Directory', exact: true }).first().click();
    await page.getByRole('button').filter({ hasText: GRAPHIC_NAME }).first().click();
    await expect(page.getByRole('heading', { name: new RegExp(GRAPHIC_NAME) })).toBeVisible();
}

test('explains EmptyPayload correctly in UI, clipboard and exported reports', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openGraphic(page, graphic(`
        async setActionsSchedule() { return { statusCode: 200, statusMessage: 'OK' }; }
    `), { supportsRealTime: false, supportsNonRealTime: true });
    const issue = page.getByRole('article', { name: 'NRT: setActionsSchedule() failed' });
    await expect(issue.getByText('INVALID_EMPTY_PAYLOAD', { exact: true })).toBeVisible();
    await expect(issue).toContainText('undefined');
    await expect(issue).toContainText('v_');
    await expect(issue).not.toContainText('a 2xx statusCode');
    await expect(issue.getByRole('link', { name: 'Specification reference' }))
        .toHaveAttribute('href', /#setactionsschedule$/);
    await issue.getByRole('button', { name: 'Copy diagnostic' }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('INVALID_EMPTY_PAYLOAD');
    expect(copied).toContain('#setactionsschedule');

    const jsonDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Review report contents' })).toBeVisible();
    await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
    const jsonPath = await (await jsonDownload).path();
    const report = JSON.parse(await readFile(jsonPath!, 'utf8'));
    const failed = report.runtimeTest.result.steps.find((step: { status: string }) => step.status === 'fail');
    expect(failed.diagnostic.code).toBe('INVALID_EMPTY_PAYLOAD');
    expect(copied).toContain(failed.diagnostic.hint);
    expect(failed.diagnostic.specRef).toContain('#setactionsschedule');

    const htmlDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export HTML', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Review report contents' })).toBeVisible();
    await page.getByRole('button', { name: 'Download HTML', exact: true }).click();
    const htmlPath = await (await htmlDownload).path();
    const html = await readFile(htmlPath!, 'utf8');
    expect(html).toContain('INVALID_EMPTY_PAYLOAD');
    expect(html).toContain('#setactionsschedule');
    expect(html).not.toContain('a 2xx statusCode');
});

const RETURN_CASES = [
    { name: 'missing status', method: 'async load() { return {}; }', code: 'INVALID_STATUS_CODE' },
    { name: 'status type', method: 'async load() { return { statusCode: "200" }; }', code: 'INVALID_STATUS_CODE' },
    { name: 'status message', method: 'async load() { return { statusCode: 200, statusMessage: 7 }; }', code: 'INVALID_STATUS_MESSAGE' },
    { name: 'non-Promise', method: 'load() { return undefined; }', code: 'METHOD_MUST_RETURN_PROMISE' },
    { name: 'missing currentStep', method: 'async playAction() { return { statusCode: 200 }; }', code: 'INVALID_CURRENT_STEP' },
    { name: 'wrong currentStep', method: 'async playAction() { return { statusCode: 200, currentStep: 999 }; }', code: 'CURRENT_STEP_MISMATCH' },
];

for (const scenario of RETURN_CASES) {
    test(`classifies ${scenario.name} at its source in the actual sandbox`, async ({ page }) => {
        await openGraphic(page, graphic(scenario.method));
        await expect(page.getByText(scenario.code, { exact: true }).first()).toBeVisible();
        await expect(page.getByText('Runtime Failed', { exact: true }).first()).toBeVisible();
    });
}

test('reports a missing export separately from missing paths', async ({ page }) => {
    await openGraphic(page, 'export class Graphic extends HTMLElement {}');
    await expect(page.getByText('INVALID_DEFAULT_EXPORT', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('SANDBOX_IMPORT_FAILED', { exact: true })).toHaveCount(0);
});

test('explains an export that is not an HTMLElement', async ({ page }) => {
    await openGraphic(page, 'export default class Graphic {}');
    await expect(page.getByText('DEFAULT_EXPORT_NOT_HTMLELEMENT', { exact: true }).first()).toBeVisible();
});

test('does not infer an exception category from Graphic error keywords', async ({ page }) => {
    await openGraphic(page, graphic('async load() { throw new Error("statusCode import timeout"); }'));
    await expect(page.getByText('Runtime Failed', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('ACTION_RETURNED_ERROR_STATUS', { exact: true })).toHaveCount(0);
    await expect(page.getByText('SANDBOX_IMPORT_FAILED', { exact: true })).toHaveCount(0);
    await expect(page.getByText('RUNTIME_TIMEOUT', { exact: true })).toHaveCount(0);
});

test('marks missing load input as inconclusive without calling load', async ({ page }) => {
    await openGraphic(page, graphic(`
        async load() { throw new Error('LOAD_SHOULD_NOT_RUN'); }
        async dispose() { throw new Error('UNINITIALIZED_DISPOSE_SHOULD_NOT_RUN'); }
    `), {
        schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    });
    await expect(page.getByText('INVALID_TEST_DATA', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Runtime Inconclusive', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Needs Review', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('LOAD_SHOULD_NOT_RUN', { exact: true })).toHaveCount(0);
    await expect(page.getByText('UNINITIALIZED_DISPOSE_SHOULD_NOT_RUN', { exact: true })).toHaveCount(0);
});

test('actually invokes parameterless custom actions', async ({ page }) => {
    await openGraphic(page, graphic(`async customAction({ id, payload }) {
        if (id !== 'ping' || payload !== undefined) throw new Error('Wrong parameterless call');
        return { statusCode: 400, statusMessage: 'PARAMETERLESS_ACTION_WAS_CALLED' };
    }`), { customActions: [{ id: 'ping', name: 'Ping', schema: null }] });
    await expect(page.getByText('ACTION_RETURNED_ERROR_STATUS', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/PARAMETERLESS_ACTION_WAS_CALLED/).first()).toBeVisible();
});

test('marks an action without usable defaults as untested', async ({ page }) => {
    await openGraphic(page, graphic('async customAction() { throw new Error("ACTION_SHOULD_NOT_RUN"); }'), {
        customActions: [{ id: 'ping', name: 'Ping', schema: {
            type: 'object', properties: { name: { type: 'string' } }, required: ['name'],
        } }],
    });
    await expect(page.getByText('Runtime Inconclusive', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Needs Review', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('ACTION_SHOULD_NOT_RUN', { exact: true })).toHaveCount(0);
});

for (const target of ['load', 'customAction'] as const) {
    test(`marks excessive ${target} default generation as a test limitation`, async ({ page }) => {
        const schema = {
            type: 'object',
            properties: {
                rows: { type: 'array', minItems: 4294967296, items: { type: 'string', default: 'x' } },
            },
            required: ['rows'],
        };
        await openGraphic(page, graphic(`async ${target}() {
            throw new Error('Oversized generated input must not be dispatched');
        }`), target === 'load' ? { schema } : {
            customActions: [{ id: 'large', name: 'Large input', schema }],
        });
        await expect(page.getByText('Runtime Inconclusive', { exact: true }).first()).toBeVisible();
        await expect(page.getByText('Needs Review', { exact: true }).first()).toBeVisible();
        await expect(page.getByText('Runtime Failed', { exact: true })).toHaveCount(0);
    });
}

for (const method of ['load', 'dispose']) {
    test(`captures unhandled rejections during ${method}`, async ({ page }) => {
        await openGraphic(page, graphic(`async ${method}() {
            Promise.reject(new Error('Unhandled ${method} rejection'));
        }`));
        await expect(page.getByText('UNCAUGHT_RUNTIME_ERROR', { exact: true }).first()).toBeVisible();
        await expect(page.getByText('Runtime Failed', { exact: true }).first()).toBeVisible();
    });
}

test('accepts conforming zero-step and EmptyPayload results', async ({ page }) => {
    await openGraphic(page, graphic(`
        async playAction() { return { statusCode: 200, currentStep: undefined }; }
        async setActionsSchedule() { return { v_example: true }; }
    `), { stepCount: 0, supportsRealTime: false, supportsNonRealTime: true });
    await expect(page.getByText('Runtime Passed', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Checks Passed', { exact: true }).first()).toBeVisible();
});

test('explains invalid schedule input in the editor and permits partial updates', async ({ page }) => {
    await openGraphic(page, graphic(`async setActionsSchedule({ schedule }) {
        this.dataset.receivedSchedule = JSON.stringify(schedule);
    }`), {
        supportsRealTime: false,
        supportsNonRealTime: true,
        schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', default: 'Test' } } },
        customActions: [{ id: 'ping', name: 'Ping', schema: null }],
    });
    await expect(page.getByText('Runtime Passed', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Actions schedule JSON' });
    const apply = page.getByRole('button', { name: 'Apply', exact: true });
    const element = page.frameLocator('iframe[aria-label="OGraf graphic preview"]').locator('#stage > *');
    await expect(apply).toBeEnabled();
    await editor.fill(JSON.stringify([{ timestamp: 0, action: { type: 'updateAction', params: {} } }]));
    await apply.click();
    await expect(page.getByText(/action.params.data is required/)).toBeVisible();
    await expect(element).not.toHaveAttribute('data-received-schedule');
    await editor.fill(JSON.stringify([{ timestamp: 0, action: { type: 'customAction', params: { id: 'missing', payload: {} } } }]));
    await apply.click();
    await expect(page.getByText(/must name a custom action declared in the manifest/)).toBeVisible();
    const validSchedule = [
        { timestamp: 0, action: { type: 'updateAction', params: { data: {} } } },
        { timestamp: 1, action: { type: 'customAction', params: { id: 'ping' } } },
    ];
    await editor.fill(JSON.stringify(validSchedule));
    await apply.click();
    await expect(element).toHaveAttribute('data-received-schedule', JSON.stringify(validSchedule));
    await expect(page.getByText(/must name a custom action declared in the manifest/)).toHaveCount(0);
});

test('does not blame the Graphic for a pending fetch cancelled by runner cleanup', async ({ page }) => {
    await openGraphic(page, graphic(`async load() {
        const filename = ['slow', 'txt'].join('.');
        void fetch('./' + filename);
    }`), {}, true);
    await expect(page.getByText('Runtime Passed', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('UNCAUGHT_RUNTIME_ERROR', { exact: true })).toHaveCount(0);
});

for (const handled of [false, true]) {
    test(`${handled ? 'accepts handled' : 'reports unhandled'} Worker exceptions`, async ({ page }) => {
        await openGraphic(page, graphic(`async load() {
            this.worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
            await new Promise((resolve) => {
                this.worker.addEventListener('error', (event) => {
                    ${handled ? 'event.preventDefault();' : ''}
                    resolve();
                });
            });
        }
        async dispose() { this.worker?.terminate(); }`), {}, false, {
            'worker.mjs': 'throw new Error("Worker regression failure");',
        });
        await expect(page.getByText(handled ? 'Runtime Passed' : 'Runtime Failed', { exact: true })
            .first()).toBeVisible();
        if (!handled) {
            await expect(page.getByText('UNCAUGHT_RUNTIME_ERROR', { exact: true }).first()).toBeVisible();
        }
    });
}

test('reviews reproducible report data before downloading and allows cancellation on mobile', async ({ page }) => {
    await openGraphic(page, graphic(), { schema: { type: 'object', properties: {
        title: { type: 'string', default: 'Private example title' },
    } } });
    await expect(page.getByText('Checks Passed', { exact: true }).first()).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(async () => {
        await Promise.all(document.getAnimations().filter((animation) => (
            animation.effect?.getComputedTiming().iterations !== Infinity
        )).map((animation) => animation.finished.catch(() => {})));
    });
    const downloads: string[] = [];
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Review report contents' });
    await expect(review).toBeVisible();
    await review.getByText('Inspect included data', { exact: true }).click();
    await expect(review.locator('pre')).toContainText('Private example title');
    await expect(review.locator('pre')).toContainText('packageBefore');
    const bounds = await review.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: test.info().outputPath('export-review-mobile.png') });
    await review.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(review).not.toBeVisible();
    expect(downloads).toEqual([]);
    await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
    const download = page.waitForEvent('download');
    await review.getByRole('button', { name: 'Download JSON', exact: true }).click();
    const report = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
    expect(report.environment.specCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(report.runtimeTest.result.reportContext.packageComparison).toBe('unchanged');
    expect(report.packageAtExport.fingerprint).toEqual(report.runtimeTest.result.reportContext.packageBefore);
    const load = report.runtimeTest.result.steps.find((step: { invocation?: { method: string } }) => step.invocation?.method === 'load');
    expect(load.invocation.parameters.value.data.title).toBe('Private example title');
    expect(load.invocation.parameters.value.renderCharacteristics).toBeDefined();
    expect(load.invocation.response).toEqual({ type: 'undefined' });
});

test('shows expected and captured values and lets the user inspect individual calls', async ({ page }) => {
    await openGraphic(page, graphic(`
        async setActionsSchedule() { return { statusCode: 200, statusMessage: 'OK' }; }
    `), { supportsRealTime: false, supportsNonRealTime: true });
    const issue = page.getByRole('article', { name: 'NRT: setActionsSchedule() failed' });
    await expect(issue).toContainText('Expected');
    await expect(issue).toContainText('Received');
    await expect(issue).toContainText('"statusCode": 200');
    await issue.getByText(/Show calls and scenarios/).click();
    await expect(issue).toContainText('Call inputs · setActionsSchedule()');
    await expect(issue).toContainText('"schedule"');
});

test('navigates a nested manifest diagnostic to its highlighted field', async ({ page }) => {
    await openGraphic(page, graphic(), { customActions: [{ id: 'example', name: 42, schema: null }] });
    const issue = page.getByRole('article').filter({ hasText: 'customActions[0].name' }).first();
    await issue.getByRole('button', { name: 'Show in manifest', exact: true }).click();
    const target = page.locator('[data-manifest-target="true"]');
    await expect(target).toContainText('"name"');
    await expect(target).toContainText('42');
    await expect(target).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'Selected field:' }))
        .toContainText('customActions[0].name');
    await page.screenshot({ path: test.info().outputPath('manifest-location.png') });
});

test('navigates a missing manifest field to its existing parent', async ({ page }) => {
    await openGraphic(page, graphic(), { customActions: [{ id: 'example', schema: null }] });
    const missing = page.getByRole('article').filter({ hasText: 'customActions[0].name' }).first();
    await missing.getByRole('button', { name: 'Show parent in manifest', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Field not present;' }))
        .toContainText('customActions[0].name');
    await expect(page.locator('[data-manifest-target="true"]')).toContainText('schema');
});

test('groups caught missing package fetches as review observations instead of Graphic failures', async ({ page }) => {
    await openGraphic(page, graphic(`async load() {
        await fetch('missing-image.png').catch(() => {});
        await fetch('missing-image.png').catch(() => {});
    }`));
    const resources = page.getByRole('region', { name: 'Resource observations' });
    await expect(resources).toContainText('missing-image.png');
    await expect(resources).toContainText('2 observations');
    await expect(resources).toContainText('not found in the selected package');
    await expect(page.getByRole('region', { name: 'Standard runtime test', exact: true })).toContainText('Inconclusive');
    await expect(page.getByRole('region', { name: 'Runtime findings', exact: true })).toHaveCount(0);
});

test('reports external HTTP failures without treating external dependencies as invalid', async ({ page }) => {
    await page.route('https://assets.example.test/**', (route) => route.fulfill({
        status: 404, body: 'missing', headers: { 'access-control-allow-origin': '*' },
    }));
    await openGraphic(page, graphic(`async load() { await fetch('https://assets.example.test/image.png?secret=hidden'); }`));
    const resources = page.getByRole('region', { name: 'Resource observations' });
    await expect(resources).toContainText('HTTP 404');
    await expect(resources).toContainText('https://assets.example.test/image.png');
    await expect(resources).not.toContainText('secret=hidden');
    await expect(page.getByRole('region', { name: 'Standard runtime test', exact: true })).toContainText('Inconclusive');
});

test('keeps successful external fetches and intentionally aborted fetches neutral', async ({ page }) => {
    await page.route('https://assets.example.test/**', (route) => route.fulfill({
        status: 200, body: 'ok', headers: { 'access-control-allow-origin': '*' },
    }));
    await openGraphic(page, graphic(`async load() {
        await fetch('https://assets.example.test/ok');
        const controller = new AbortController(); controller.abort();
        await fetch('https://assets.example.test/cancelled', { signal: controller.signal }).catch(() => {});
    }`));
    await expect(page.getByRole('region', { name: 'Standard runtime test', exact: true })).toContainText('Passed');
    await expect(page.getByRole('region', { name: 'Resource observations' })).toHaveCount(0);
});

test('reports actual CSP blocking as a policy restriction and exports grouped observations', async ({ page }) => {
    await openGraphic(page, graphic(`async load() {
        const policy = document.createElement('meta');
        policy.httpEquiv = 'Content-Security-Policy';
        policy.content = "connect-src 'none'";
        document.head.append(policy);
        const blocked = new Promise(resolve => addEventListener('securitypolicyviolation', resolve, { once: true }));
        await fetch('https://assets.example.test/blocked').catch(() => {});
        await blocked;
    }`));
    const resources = page.getByRole('region', { name: 'Resource observations' });
    await expect(resources).toContainText('Browser policy restriction');
    await expect(resources).toContainText('not an OGraf violation');
    await expect(page.getByRole('region', { name: 'Standard runtime test', exact: true })).toContainText('Inconclusive');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
    await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
    const report = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
    expect(report.resourceObservations).toHaveLength(1);
    expect(report.resourceObservations[0].reason).toBe('sandbox-policy');
    expect(report.readiness.runtimeWarnings).toBe(1);
    expect(report.coverage[0].resourceReviewCount).toBe(1);
    expect(report.resourceObservations[0].observations.length).toBeGreaterThanOrEqual(2);
    expect(report.readiness.status).not.toBe('runtime-failed');
});

test('reports missing DOM images and CSS assets with package paths', async ({ page }) => {
    await openGraphic(page, graphic(`async load() {
        const img = new Image();
        const failed = new Promise(resolve => img.addEventListener('error', resolve, { once: true }));
        img.src = 'missing-dom.png'; this.append(img);
        await failed;
        const style = document.createElement('style');
        style.textContent = ':host { background-image: url("missing-css.png"); }';
        const cssFailed = new Promise(resolve => style.addEventListener('error', resolve, { once: true }));
        this.append(style);
        await cssFailed;
    }`));
    const resources = page.getByRole('region', { name: 'Resource observations' });
    await expect(resources).toContainText('missing-dom.png');
    await expect(resources).toContainText('missing-css.png');
    await expect(resources).toContainText('Package resource');
    await expect(page.getByRole('region', { name: 'Standard runtime test', exact: true })).toContainText('Inconclusive');
});
