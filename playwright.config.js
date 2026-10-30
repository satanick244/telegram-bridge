import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:3001',
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox','--disable-dev-shm-usage'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node server/index.js',
    env: { NODE_ENV: 'production', PORT: '3001', DATABASE_PATH: ':memory:', COOKIE_SECURE:'false', ADMIN_USERNAME:'e2e_admin', ADMIN_PASSWORD:'E2E-local-only-Password9!' },
    url: 'http://127.0.0.1:3001/api/health',
    reuseExistingServer: false,
  },
});
