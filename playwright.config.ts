import { defineConfig, devices } from "@playwright/test";

// The repo sandbox is intentionally minimal. This flag makes the package extract
// its bundled Linux libraries instead of relying on host-installed browser deps.
process.env.AWS_EXECUTION_ENV ??= "AWS_Lambda_nodejs20.x";

const { default: chromium } = await import("@sparticuz/chromium");
chromium.setGraphicsMode = false;
const executablePath = await chromium.executablePath();

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
    launchOptions: {
      args: chromium.args,
      executablePath,
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
