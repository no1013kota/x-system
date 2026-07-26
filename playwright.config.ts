import { defineConfig, devices } from "@playwright/test";

/**
 * E2E (T-M7-05, 要件06 全般)。ローカルの安全な既定でだけ動かす:
 * `APP_ENV=development`・`X_POSTING_MODE=dry_run`・ローカルSupabase・127.0.0.1のdevサーバ。
 * 逸脱時は `e2e/fixtures/guard.ts` の globalSetup が起動前に落とす。
 *
 * DBを共有し active Xアカウントを切り替えるため、シナリオは直列実行する（workers: 1）。
 * 実行は `npm run test:e2e`（.env / .env.local を Node の --env-file で読み込む）。
 */

export const E2E_BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/fixtures/guard.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: E2E_BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
