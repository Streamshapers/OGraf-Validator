import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    timeout: 45_000,
    expect: { timeout: 15_000 },
    retries: process.env['CI'] ? 2 : 0,
    reporter: process.env['CI'] ? 'github' : 'list',
    use: {
        baseURL: 'http://127.0.0.1:3000',
        channel: 'chrome',
        headless: true,
        serviceWorkers: 'allow',
        trace: 'retain-on-failure',
    },
    webServer: {
        command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 3000 --strictPort',
        url: 'http://127.0.0.1:3000',
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
