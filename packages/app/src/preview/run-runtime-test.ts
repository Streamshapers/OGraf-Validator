/**
 * Standalone runtime test runner for OGraf graphics.
 * Imports the graphic module, registers a custom element,
 * and runs the full lifecycle (load → play → stop → dispose).
 *
 * Runs in a hidden offscreen container — no iframe needed
 * because the preview Service Worker is already active.
 */

import type { OgrafElement } from './preview-types.js';
import type { RuntimeTestResult, RuntimeTestStep } from './runtime-test-types.js';
import { buildPreviewData } from './use-preview-sw.js';
import { DEFAULT_RENDER_CHARACTERISTICS } from './preview-types.js';
import { BrowserFS } from '../fs/browser-fs.js';

const CHANNEL_NAME = 'ograf-preview';

function getMimeType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
        mjs: 'text/javascript', js: 'text/javascript', ts: 'text/javascript',
        html: 'text/html', css: 'text/css', json: 'application/json',
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
        woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
    };
    return map[ext] ?? 'application/octet-stream';
}

/** Set up a temporary BroadcastChannel file server for one test run. Returns a cleanup function. */
function startFileServer(dirHandle: FileSystemDirectoryHandle): () => void {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    const fs = new BrowserFS(dirHandle);

    const handler = async (event: MessageEvent<unknown>) => {
        const msg = event.data;
        if (typeof msg !== 'object' || msg === null) return;
        const { type, id, path } = msg as Record<string, unknown>;
        if (type !== 'FILE_REQUEST' || typeof id !== 'string' || typeof path !== 'string') return;
        try {
            const buffer = await fs.readArrayBuffer(path);
            channel.postMessage({ type: 'FILE_RESPONSE', id, buffer, mimeType: getMimeType(path) });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            channel.postMessage({ type: 'FILE_RESPONSE', id, error: message });
        }
    };

    channel.addEventListener('message', handler);
    return () => {
        channel.removeEventListener('message', handler);
        channel.close();
    };
}

const STEP_TIMEOUT = 5_000; // 5 seconds per step

/** Run a single step with timeout and error handling. */
async function runStep(
    name: string,
    fn: () => Promise<unknown> | unknown,
): Promise<RuntimeTestStep> {
    const start = performance.now();
    try {
        const result = fn();
        if (result instanceof Promise) {
            await Promise.race([
                result,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Timeout after ${STEP_TIMEOUT}ms`)), STEP_TIMEOUT),
                ),
            ]);
        }
        return { name, status: 'pass', durationMs: Math.round(performance.now() - start) };
    } catch (e) {
        return {
            name,
            status: 'fail',
            durationMs: Math.round(performance.now() - start),
            error: e instanceof Error ? e.message : String(e),
        };
    }
}

function skipStep(name: string): RuntimeTestStep {
    return { name, status: 'skip', durationMs: 0 };
}

/**
 * Run the full OGraf lifecycle test against an already-importable URL.
 * The preview Service Worker must be ready before calling this.
 */
export async function runRuntimeTest(
    importUrl: string,
    manifest: unknown,
    dirHandle: FileSystemDirectoryHandle,
    onStepComplete?: (step: RuntimeTestStep) => void,
): Promise<RuntimeTestResult> {
    const totalStart = performance.now();
    const steps: RuntimeTestStep[] = [];
    let element: OgrafElement | null = null;
    let container: HTMLDivElement | null = null;
    let tagName = '';

    const pushStep = (step: RuntimeTestStep) => {
        steps.push(step);
        onStepComplete?.(step);
    };

    // Serve package files over the BroadcastChannel for the SW to pick up
    const stopFileServer = startFileServer(dirHandle);

    const m = (typeof manifest === 'object' && manifest !== null)
        ? manifest as Record<string, unknown>
        : {} as Record<string, unknown>;

    const supportsRT = m['supportsRealTime'] === true;
    const supportsNRT = m['supportsNonRealTime'] === true;
    const data = buildPreviewData(manifest);

    try {
        // 1. Import module
        let GraphicClass: { new(): OgrafElement } | null = null;
        const importStep = await runStep('Import module', async () => {
            const mod = await import(/* @vite-ignore */ importUrl);
            const cls = mod.default ?? mod;
            if (typeof cls !== 'function') {
                throw new Error('Module does not export a class / constructor.');
            }
            GraphicClass = cls;
        });
        pushStep(importStep);
        if (importStep.status === 'fail') {
            return { passed: false, steps, totalDurationMs: Math.round(performance.now() - totalStart) };
        }

        // 2. Register custom element + create instance
        tagName = `ograf-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const registerStep = await runStep('Register element', () => {
            if (!GraphicClass) throw new Error('No class to register');
            if (!customElements.get(tagName)) {
                customElements.define(tagName, GraphicClass);
            }
        });
        pushStep(registerStep);
        if (registerStep.status === 'fail') {
            return { passed: false, steps, totalDurationMs: Math.round(performance.now() - totalStart) };
        }

        // 3. Create hidden container + element
        container = document.createElement('div');
        container.style.cssText = 'position:fixed;left:-9999px;top:0;width:1920px;height:1080px;overflow:hidden;pointer-events:none;';
        document.body.appendChild(container);
        element = document.createElement(tagName) as OgrafElement;
        element.style.cssText = 'display:block;width:100%;height:100%;';
        container.appendChild(element);

        // 4. load()
        if (typeof element.load !== 'function') {
            pushStep({ name: 'load()', status: 'fail', durationMs: 0, error: 'load() method not found on element.' });
            return { passed: false, steps, totalDurationMs: Math.round(performance.now() - totalStart) };
        }
        const loadStep = await runStep('load()', () =>
            element!.load!({
                data,
                renderType: supportsRT ? 'realtime' : 'non-realtime',
                renderCharacteristics: DEFAULT_RENDER_CHARACTERISTICS,
            }),
        );
        pushStep(loadStep);
        if (loadStep.status === 'fail') {
            return { passed: false, steps, totalDurationMs: Math.round(performance.now() - totalStart) };
        }

        // 5. Real-time lifecycle
        if (supportsRT) {
            if (typeof element.updateAction === 'function') {
                pushStep(await runStep('updateAction()', () =>
                    element!.updateAction!({ data })));
            }

            if (typeof element.playAction === 'function') {
                pushStep(await runStep('playAction()', () =>
                    element!.playAction!({})));
            } else {
                pushStep({ name: 'playAction()', status: 'fail', durationMs: 0, error: 'playAction() method not found.' });
            }

            if (typeof element.stopAction === 'function') {
                pushStep(await runStep('stopAction()', () =>
                    element!.stopAction!({})));
            } else {
                pushStep({ name: 'stopAction()', status: 'fail', durationMs: 0, error: 'stopAction() method not found.' });
            }
        } else {
            pushStep(skipStep('updateAction()'));
            pushStep(skipStep('playAction()'));
            pushStep(skipStep('stopAction()'));
        }

        // 6. Non-real-time lifecycle
        if (supportsNRT) {
            if (typeof element.setActionsSchedule === 'function') {
                pushStep(await runStep('setActionsSchedule()', () =>
                    element!.setActionsSchedule!({ schedule: [] })));
            } else {
                pushStep({ name: 'setActionsSchedule()', status: 'fail', durationMs: 0,
                    error: 'setActionsSchedule() required for non-realtime but not found.' });
            }

            if (typeof element.goToTime === 'function') {
                pushStep(await runStep('goToTime()', () =>
                    element!.goToTime!({ timestamp: 0 })));
            } else {
                pushStep({ name: 'goToTime()', status: 'fail', durationMs: 0,
                    error: 'goToTime() required for non-realtime but not found.' });
            }
        }

        // 7. dispose()
        if (typeof element.dispose === 'function') {
            pushStep(await runStep('dispose()', () =>
                element!.dispose!()));
        } else {
            pushStep({ name: 'dispose()', status: 'fail', durationMs: 0, error: 'dispose() method not found.' });
        }

    } finally {
        // 8. Cleanup DOM + file server
        stopFileServer();
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
    }

    const passed = steps.every((s) => s.status !== 'fail');
    return { passed, steps, totalDurationMs: Math.round(performance.now() - totalStart) };
}
