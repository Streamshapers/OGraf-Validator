/// <reference types="vitest/config" />

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = fileURLToPath(new URL('.', import.meta.url));
const appPkg  = JSON.parse(readFileSync(resolve(currentDir, 'package.json'), 'utf-8')) as { version: string };
const corePkg = JSON.parse(readFileSync(resolve(currentDir, '../validator-core/package.json'), 'utf-8')) as { version: string };

export default defineConfig({
    plugins: [react()],
    define: {
        __APP_VERSION__:  JSON.stringify(appPkg.version),
        __CORE_VERSION__: JSON.stringify(corePkg.version),
    },
    resolve: {
        dedupe: ['react', 'react-dom'],
    },
    server: {
        port: 3000,
    },
    build: {
        target: 'es2020',
        outDir: 'dist',
    },
    test: {
        include: ['src/**/*.test.{ts,tsx}'],
        setupFiles: ['src/__tests__/setup.ts'],
    },
});
