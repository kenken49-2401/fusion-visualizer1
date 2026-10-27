import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
      args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
    },
  },
  projects: [
    { name: 'desktop', testMatch: ['viewer.spec.ts', 'measurements.spec.ts', 'models.spec.ts'], use: { viewport: { width: 1440, height: 1050 } } },
    { name: 'mobile', testMatch: 'mobile.spec.ts', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
    { name: 'local-admin', testMatch: ['admin.spec.ts', 'zoom.spec.ts'], use: { baseURL: 'http://127.0.0.1:5174' } },
  ],
  webServer: [
    { command: 'npm run preview', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
    { command: 'npm run dev:admin -- --port 5174', url: 'http://127.0.0.1:5174', reuseExistingServer: !process.env.CI },
  ],
});
