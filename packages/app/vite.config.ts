import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appPkg  = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as { version: string };
const corePkg = JSON.parse(readFileSync(resolve(__dirname, '../validator-core/package.json'), 'utf-8')) as { version: string };

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
});
