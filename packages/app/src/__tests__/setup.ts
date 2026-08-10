import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const nativeFetch = globalThis.fetch.bind(globalThis);

// @rollup/browser loads its parser WebAssembly with fetch(). Browsers receive
// that file through Vite; Node's fetch does not support file: URLs in Vitest.
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith('file:') && url.endsWith('/bindings_wasm_bg.wasm')) {
        const bytes = await readFile(fileURLToPath(url));
        return new Response(bytes, {
            status: 200,
            headers: { 'Content-Type': 'application/wasm' },
        });
    }
    return nativeFetch(input, init);
};
