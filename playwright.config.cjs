const { defineConfig } = require('playwright/test');
const fs = require('node:fs');
const path = require('node:path');

function loadLocalTestingEnv() {
  const envPath = path.resolve(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^(TESTING_NSEC|TESTING_MEMBER_NSEC)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim();
  }
}

loadLocalTestingEnv();

const port = process.env.PLAYWRIGHT_PORT || '4173';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;
const backendUrl = process.env.PLAYWRIGHT_SUPERBASED_URL || 'https://sb4.otherstuff.studio';

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 180_000,
  expect: {
    timeout: 20_000,
  },
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: true,
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: `sh -c 'VITE_DEFAULT_SUPERBASED_URL=${backendUrl} bunx vite --host 127.0.0.1 --port ${port} --strictPort'`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
