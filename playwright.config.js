// End-to-end tests drive the real app in LOCAL DEMO MODE (synthetic data, no credentials needed).
// First time only: npx playwright install chromium
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5180', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 950 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@responsive/ },
  ],
  webServer: [
    { command: 'npm run demo --prefix backend', port: 4010, env: { PORT: '4010', CORS_ORIGINS: 'http://localhost:5180' }, reuseExistingServer: false, timeout: 60_000 },
    { command: 'npm run dev --prefix frontend -- --port 5180 --strictPort', port: 5180, env: { VITE_API_TARGET: 'http://localhost:4010' }, reuseExistingServer: false, timeout: 60_000 },
  ],
});
