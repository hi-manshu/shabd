import { defineConfig, devices } from '@playwright/test'
import { PORTS } from './e2e/support/ports.mjs'

/**
 * Browser tests. Two servers run for the whole session, each on its own copy
 * of e2e/site:
 *
 *   :4411  `shabd dev`      for tests that edit files and watch the page update
 *   :4412  `shabd preview`  a production build, for everything else
 *
 * Tests run one at a time: the dev tests share one set of files.
 * `SHABD_E2E_PORT` moves both servers, for a second checkout running the tests at the same time.
 */
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.results',
  globalSetup: './e2e/support/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: {
            // The Studio's two editors find each other by address. Firefox hides a machine's addresses
            // behind names that only resolve on a network with mDNS, which a CI machine does not have.
            'media.peerconnection.ice.obfuscate_host_addresses': false,
            'media.peerconnection.ice.loopback': true,
          },
        },
      },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    {
      command: 'node e2e/support/serve.mjs dev',
      url: `http://localhost:${PORTS.dev}/`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'node e2e/support/serve.mjs preview',
      url: `http://localhost:${PORTS.preview}/`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
