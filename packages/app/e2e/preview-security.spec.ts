import { expect, test, type Page } from '@playwright/test';

async function mountRunner(page: Page): Promise<void> {
    await page.goto('/');
    await page.evaluate(async () => {
        const frame = document.createElement('iframe');
        frame.id = 'security-runner';
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.src = '/preview-runner.html?protocol=4&runner=security-test';
        await new Promise<void>((resolve) => {
            frame.onload = () => resolve();
            document.body.append(frame);
        });
    });
}

async function connect(page: Page, targetOrigin = '*', protocol = 4): Promise<boolean> {
    return page.evaluate(({ targetOrigin, protocol }) => new Promise<boolean>((resolve) => {
        const frame = document.querySelector<HTMLIFrameElement>('#security-runner')!;
        const channel = new MessageChannel();
        const finish = (accepted: boolean) => {
            clearTimeout(timer);
            channel.port1.close();
            resolve(accepted);
        };
        const timer = setTimeout(() => finish(false), 750);
        channel.port1.onmessage = (event: MessageEvent<{ type: string }>) => {
            finish(event.data.type === 'OGRAF_RUNNER_READY');
        };
        frame.contentWindow!.postMessage({
            protocol, type: 'OGRAF_RUNNER_CONNECT', runnerId: 'security-test', sessionId: '0123456789abcdef',
        }, targetOrigin, [channel.port2]);
    }), { targetOrigin, protocol });
}

test('connects the opaque runner once using the wildcard target origin', async ({ page }) => {
    await mountRunner(page);
    const origin = new URL(page.url()).origin;
    expect(await connect(page, origin)).toBe(false);
    expect(await connect(page, '*', 99)).toBe(false);
    expect(await connect(page)).toBe(true);
    expect(await connect(page)).toBe(false);
    await expect(page.locator('#security-runner')).toHaveAttribute('sandbox', 'allow-scripts');
});

test('rejects a connection from a sibling window', async ({ page }) => {
    await mountRunner(page);
    await page.evaluate(async () => {
        const sibling = document.createElement('iframe');
        sibling.name = 'unrelated-sender';
        sibling.srcdoc = '<!doctype html><title>Unrelated sender</title>';
        await new Promise<void>((resolve) => {
            sibling.onload = () => resolve();
            document.body.append(sibling);
        });
    });
    const sibling = page.frame({ name: 'unrelated-sender' });
    if (!sibling) throw new Error('Missing sibling test frame.');
    const accepted = await sibling.evaluate(() => new Promise<boolean>((resolve) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 750);
        channel.port1.onmessage = () => { clearTimeout(timer); channel.port1.close(); resolve(true); };
        parent.frames[0]!.postMessage({
            protocol: 4, type: 'OGRAF_RUNNER_CONNECT', runnerId: 'security-test', sessionId: '0123456789abcdef',
        }, '*', [channel.port2]);
    }));
    expect(accepted).toBe(false);
    expect(await connect(page)).toBe(true);
});

test('rejects port commands for another protocol, runner, or session', async ({ page }) => {
    await mountRunner(page);
    const responses = await page.evaluate(() => new Promise<string[]>((resolve, reject) => {
        const frame = document.querySelector<HTMLIFrameElement>('#security-runner')!;
        const channel = new MessageChannel();
        const seen: string[] = [];
        const binding = { protocol: 4, runnerId: 'security-test', sessionId: '0123456789abcdef' };
        const timer = setTimeout(() => {
            channel.port1.close();
            reject(new Error('The runner did not acknowledge the valid command.'));
        }, 5_000);
        channel.port1.onmessage = (event: MessageEvent<{ type: string; requestId?: string }>) => {
            if (event.data.type === 'OGRAF_RUNNER_READY') {
                const command = { ...binding, type: 'OGRAF_RUNNER_SET_BACKGROUND', payload: { type: 'checker' } };
                channel.port1.postMessage({ ...command, requestId: 'wrong-protocol', protocol: 99 });
                channel.port1.postMessage({ ...command, requestId: 'wrong-runner', runnerId: 'another-runner' });
                channel.port1.postMessage({ ...command, requestId: 'wrong-session', sessionId: 'another-session' });
                channel.port1.postMessage({ ...command, requestId: 'valid' });
            } else if (event.data.type === 'OGRAF_RUNNER_RESPONSE' && event.data.requestId) {
                seen.push(event.data.requestId);
                if (event.data.requestId === 'valid') {
                    clearTimeout(timer);
                    channel.port1.close();
                    resolve(seen);
                }
            }
        };
        frame.contentWindow!.postMessage({ ...binding, type: 'OGRAF_RUNNER_CONNECT' }, '*', [channel.port2]);
    }));
    expect(responses).toEqual(['valid']);
});
