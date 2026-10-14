import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Frame, type Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const player =
    readFileSync(require.resolve('lottie-web/build/player/lottie.min.js'), 'utf8') +
    '\nexport default globalThis.lottie;';
const xlink = 'http://www.w3.org/1999/xlink';
const source = `import lottie from './lottie.mjs';
export default class Graphic extends HTMLElement {
    constructor() { super(); this.root = this.attachShadow({mode:'open'}); }
    async load() {
        this.style.cssText = 'display:block;width:100%;height:100%';
        this.svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
        this.svg.setAttribute('width','100%'); this.svg.setAttribute('height','100%');
        this.svg.setAttribute('viewBox','0 0 16 16');
        this.image = document.createElementNS('http://www.w3.org/2000/svg','image');
        this.image.setAttribute('width','16'); this.image.setAttribute('height','16');
        this.image.addEventListener('load',()=>this.dataset.loads=String(+(this.dataset.loads||0)+1));
        this.image.addEventListener('error',()=>this.dataset.errors=String(+(this.dataset.errors||0)+1));
        this.svg.append(this.image); this.root.append(this.svg); this.dataset.ready='true';
    }
    async startLottie() {
        this.svg.remove(); const container=document.createElement('div');
        container.style.cssText='width:100%;height:100%'; this.root.append(container);
        const assets=['red','green','blue'].map((color,n)=>({id:'frame'+n,w:16,h:16,u:'',p:color+'.png',e:0}));
        const layers=assets.map((asset,n)=>({ddd:0,ind:n+1,ty:2,refId:asset.id,sr:1,ip:n,op:n+1,st:0,bm:0,
            ks:{o:{a:0,k:100},r:{a:0,k:0},p:{a:0,k:[0,0,0]},a:{a:0,k:[0,0,0]},s:{a:0,k:[100,100,100]}}}));
        this.animation=lottie.loadAnimation({container,renderer:'svg',autoplay:false,loop:false,
            animationData:{v:'5.12.2',fr:1,ip:0,op:3,w:16,h:16,assets,layers}});
        await new Promise(resolve=>this.animation.addEventListener('DOMLoaded',resolve));
    }
    async playAction() { return {statusCode:200,currentStep:0}; }
    async stopAction() {}
    async updateAction() {}
    async customAction() {}
    async dispose() { this.animation?.destroy(); }
}`;

interface BrokerState {
    delay: boolean;
    fail: boolean;
    reads: string[];
    releases: Array<() => void>;
    pngBuffers: number;
    pngBlobs: number;
}
type TestWindow = Window & { svgBroker: BrokerState };
const uncaught = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
    const errors: string[] = [];
    uncaught.set(page, errors);
    page.on('pageerror', (error) => {
        // Playwright's SW-blocking init script also runs in the opaque iframe.
        if (
            error.message ===
            "Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag."
        )
            return;
        errors.push(error.message);
    });
});
test.afterEach(({ page }) => {
    expect(uncaught.get(page)).toEqual([]);
});

async function openFixture(page: Page): Promise<Frame> {
    await page.addInitScript(() => {
        const state: BrokerState = {
            delay: false,
            fail: false,
            reads: [],
            releases: [],
            pngBuffers: 0,
            pngBlobs: 0,
        };
        (window as unknown as TestWindow).svgBroker = state;
        const nativePostMessage = MessagePort.prototype.postMessage;
        Object.defineProperty(MessagePort.prototype, 'postMessage', {
            value: function (
                message: {
                    type?: string;
                    result?: { mimeType?: string; blob?: unknown; buffer?: unknown };
                },
                ...args: unknown[]
            ) {
                if (
                    message?.type === 'OGRAF_RUNNER_FILE_RESPONSE' &&
                    message.result?.mimeType === 'image/png'
                ) {
                    if (message.result.blob instanceof Blob) state.pngBlobs++;
                    if (message.result.buffer instanceof ArrayBuffer) state.pngBuffers++;
                }
                return Reflect.apply(nativePostMessage, this, [message, ...args]);
            },
        });
        const nativeGetFileHandle = FileSystemDirectoryHandle.prototype.getFileHandle;
        FileSystemDirectoryHandle.prototype.getFileHandle = async function (name, options) {
            const handle = await nativeGetFileHandle.call(this, name, options);
            return new Proxy(handle, {
                get(target, key) {
                    if (key === 'getFile')
                        return async () => {
                            const file = await target.getFile();
                            state.reads.push(name);
                            if (name === 'slow.png' && state.delay) {
                                await new Promise<void>((resolve) => state.releases.push(resolve));
                                if (state.fail)
                                    throw new DOMException('Test read failed', 'NotReadableError');
                            }
                            return file;
                        };
                    const value = Reflect.get(target, key, target);
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            });
        };
        Object.defineProperty(window, 'showDirectoryPicker', {
            value: async () => {
                const root = await (
                    await navigator.storage.getDirectory()
                ).getDirectoryHandle('svg-images', { create: true });
                return root;
            },
        });
    });
    await page.goto('/');
    await page.evaluate(
        async ({ source, player }) => {
            const root = await (
                await navigator.storage.getDirectory()
            ).getDirectoryHandle('svg-images', { create: true });
            const files: Record<string, string | Blob> = {
                'graphic.mjs': source,
                'lottie.mjs': player,
                'broken.png': 'not a PNG',
                'manifest.ograf.json': JSON.stringify({
                    $schema:
                        'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json',
                    id: 'svg-images',
                    name: 'SVG images',
                    main: 'graphic.mjs',
                    supportsRealTime: true,
                    supportsNonRealTime: false,
                    schema: { type: 'object', properties: {} },
                    stepCount: 1,
                    renderRequirements: [
                        {
                            resolution: { width: { exact: 16 }, height: { exact: 16 } },
                            frameRate: { exact: 1 },
                        },
                    ],
                }),
            };
            for (const color of ['red', 'green', 'blue']) {
                const canvas = document.createElement('canvas');
                canvas.width = 16;
                canvas.height = 16;
                const ctx = canvas.getContext('2d')!;
                ctx.fillStyle = color;
                ctx.fillRect(0, 0, 16, 16);
                files[color + '.png'] = await new Promise<Blob>((resolve) =>
                    canvas.toBlob((blob) => resolve(blob!), 'image/png'),
                );
            }
            files['slow.png'] = files['red.png']!;
            for (const [name, content] of Object.entries(files)) {
                const writable = await (
                    await root.getFileHandle(name, { create: true })
                ).createWritable();
                await writable.write(content);
                await writable.close();
            }
        },
        { source, player },
    );
    await page.getByRole('button', { name: 'Open Directory', exact: true }).first().click();
    await page.getByRole('button').filter({ hasText: 'SVG images' }).first().click();
    await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const handle = await page.locator('iframe[aria-label="OGraf graphic preview"]').elementHandle();
    const frame = await handle?.contentFrame();
    if (!frame) throw new Error('Missing preview frame');
    await expect(frame.locator('#stage > *')).toHaveAttribute('data-ready', 'true');
    return frame;
}

async function command(frame: Frame, code: string): Promise<unknown> {
    return frame.evaluate(
        `(async()=>{const graphic=document.querySelector('#stage > *');const image=graphic.image;${code}})()`,
    );
}

async function pixel(page: Page): Promise<number[]> {
    const png = await page.locator('iframe[aria-label="OGraf graphic preview"]').screenshot();
    return page.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        const result = [
            ...ctx.getImageData(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1)
                .data,
        ];
        bitmap.close();
        return result;
    }, png.toString('base64'));
}

for (const serviceWorkers of ['allow', 'block'] as const)
    test.describe(`SVG images, SW ${serviceWorkers}`, () => {
        test.use({ serviceWorkers });
        test('renders PNGs through attribute setters and preserves href precedence', async ({
            page,
        }) => {
            const frame = await openFixture(page);
            const setters = [
                `image.setAttribute('href','red.png')`,
                `image.setAttributeNS(null,'href','red.png')`,
                `image.setAttributeNS('','href','red.png')`,
                `image.setAttributeNS('${xlink}','href','red.png')`,
                `image.setAttributeNS('${xlink}','xlink:href','red.png')`,
            ];
            for (const setter of setters) {
                await command(
                    frame,
                    `image.removeAttribute('href');image.removeAttributeNS('${xlink}','href');${setter};`,
                );
                await expect.poll(() => pixel(page)).toEqual([255, 0, 0, 255]);
            }
            await command(
                frame,
                `image.setAttributeNS('${xlink}','xlink:href','red.png');image.setAttribute('href','blue.png');`,
            );
            await expect.poll(() => pixel(page)).toEqual([0, 0, 255, 255]);
            await command(frame, `image.removeAttribute('href');`);
            await expect.poll(() => pixel(page)).toEqual([255, 0, 0, 255]);
            // Unnamespaced xlink:href stays unnamespaced, as with the native DOM API.
            await command(
                frame,
                `image.removeAttributeNS('${xlink}','href');image.setAttribute('xlink:href','red.png');`,
            );
            await expect
                .poll(() =>
                    command(frame, `return image.getAttribute('xlink:href')?.startsWith('blob:')`),
                )
                .toBe(true);
            expect(await command(frame, `return image.getAttributeNS('${xlink}','href')`)).toBe(
                null,
            );
        });

        test('plays and seeks a real Lottie PNG sequence with distinct visible frames', async ({
            page,
        }) => {
            const frame = await openFixture(page);
            await command(
                frame,
                'await graphic.startLottie();graphic.animation.goToAndStop(0,true);',
            );
            await expect.poll(() => pixel(page)).toEqual([255, 0, 0, 255]);
            await command(frame, 'graphic.animation.goToAndStop(1,true);');
            await expect.poll(() => pixel(page)).toEqual([0, 128, 0, 255]);
            await command(frame, 'graphic.animation.goToAndStop(2,true);');
            await expect.poll(() => pixel(page)).toEqual([0, 0, 255, 255]);
            await command(
                frame,
                `graphic.seen=[];graphic.animation.addEventListener('enterFrame',e=>graphic.seen.push(Math.floor(e.currentTime)));graphic.animation.goToAndPlay(0,true);`,
            );
            await expect
                .poll(() =>
                    command(frame, 'return graphic.seen.includes(1)&&graphic.seen.includes(2);'),
                )
                .toBe(true);
            await expect.poll(() => pixel(page)).toEqual([0, 0, 255, 255]);
            expect(
                await page.evaluate(() => (window as unknown as TestWindow).svgBroker.pngBuffers),
            ).toBe(0);
            expect(
                await page.evaluate(() => (window as unknown as TestWindow).svgBroker.pngBlobs),
            ).toBe(3);
        });
    });

for (const change of ['replace', 'qualified', 'remove', 'removeNS', 'external', 'failure'] as const)
    test(`ignores stale SVG load after ${change}`, async ({ page }) => {
        const frame = await openFixture(page);
        await page.evaluate((fail) => {
            const state = (window as unknown as TestWindow).svgBroker;
            state.delay = true;
            state.fail = fail;
        }, change === 'failure');
        await command(
            frame,
            `globalThis.svgBlobCount=0;const create=URL.createObjectURL;URL.createObjectURL=function(blob){globalThis.svgBlobCount++;return create(blob)};image.setAttributeNS('${xlink}','xlink:href','slow.png');`,
        );
        await expect
            .poll(() =>
                page.evaluate(() => (window as unknown as TestWindow).svgBroker.releases.length),
            )
            .toBe(1);
        const replacement =
            change === 'remove'
                ? `image.removeAttribute('xlink:href');`
                : change === 'removeNS'
                  ? `image.removeAttributeNS('${xlink}','href');`
                  : change === 'external'
                    ? `image.setAttributeNS('${xlink}','href','data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>');`
                    : change === 'qualified'
                      ? `image.setAttribute('xlink:href','blue.png');`
                      : `image.setAttributeNS('${xlink}','href','blue.png');`;
        await command(frame, replacement);
        if (change === 'replace' || change === 'qualified' || change === 'failure')
            await expect.poll(() => pixel(page)).toEqual([0, 0, 255, 255]);
        await page.evaluate(() => {
            const state = (window as unknown as TestWindow).svgBroker;
            state.delay = false;
            state.releases.splice(0).forEach((release) => release());
        });
        if (change !== 'failure')
            await expect
                .poll(() => command(frame, 'return globalThis.svgBlobCount;'))
                .toBe(change === 'replace' || change === 'qualified' ? 2 : 1);
        // A subsequent broker round trip completes after the released response.
        await command(frame, `await fetch('green.png');`);
        if (change === 'remove' || change === 'removeNS')
            expect(await command(frame, `return image.hasAttributeNS('${xlink}','href')`)).toBe(
                false,
            );
        else if (change === 'external')
            expect(
                await command(
                    frame,
                    `return image.getAttributeNS('${xlink}','href')?.startsWith('data:')`,
                ),
            ).toBe(true);
        else expect(await pixel(page)).toEqual([0, 0, 255, 255]);
        expect(await command(frame, `return graphic.dataset.errors||'0'`)).toBe('0');
    });

test('reports missing and undecodable PNGs inside Shadow Roots', async ({ page }) => {
    const frame = await openFixture(page);
    await command(
        frame,
        `const host=document.createElement('div');graphic.root.append(host);host.attachShadow({mode:'closed'}).append(graphic.svg);`,
    );
    for (const file of ['missing.png', 'broken.png']) {
        await command(frame, `image.setAttributeNS('${xlink}','href','${file}');`);
        await expect(page.getByText(new RegExp(file.replace('.', '\\.'))).first()).toBeVisible();
    }
    await expect(frame.locator('#stage > *')).toHaveAttribute('data-errors', '2');
    expect(await page.locator('body').innerText()).not.toContain('[object SVGAnimatedString]');
});

test('deduplicates SVG image reads and suppresses pending work during teardown', async ({
    page,
}) => {
    const frame = await openFixture(page);
    await page.evaluate(() => {
        const state = (window as unknown as TestWindow).svgBroker;
        state.delay = true;
        state.reads = [];
    });
    await command(
        frame,
        `image.setAttributeNS('${xlink}','href','slow.png');const second=image.cloneNode();graphic.svg.append(second);second.setAttributeNS('${xlink}','href','slow.png');`,
    );
    await expect
        .poll(() =>
            page.evaluate(() => (window as unknown as TestWindow).svgBroker.releases.length),
        )
        .toBe(1);
    expect(
        await page.evaluate(
            () =>
                (window as unknown as TestWindow).svgBroker.reads.filter(
                    (name) => name === 'slow.png',
                ).length,
        ),
    ).toBe(1);
    await page.getByRole('button', { name: '↺ Reload', exact: true }).click();
    await expect.poll(() => frame.isDetached()).toBe(true);
    await page.evaluate(() =>
        (window as unknown as TestWindow).svgBroker.releases
            .splice(0)
            .forEach((release) => release()),
    );
    expect(await page.locator('body').innerText()).not.toContain('Preview runner was destroyed');
});
