import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  getPlaywrightExecutablePath,
  playwrightBrowserSelections,
  selectPlaywrightBrowser,
} from "./playwright-browser.mjs";

const execFileAsync = promisify(execFile);
const selection = selectPlaywrightBrowser(process.platform);

if (selection === playwrightBrowserSelections.standard) {
  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  await execFileAsync(npxCommand, ["playwright", "install", "chromium"], {
    env: process.env,
    timeout: 120_000,
  });
}

const executablePath = await getPlaywrightExecutablePath();
const { stdout } = await execFileAsync(executablePath, ["--version"], {
  env: process.env,
  timeout: 30_000,
});

console.log(
  `Playwright browser ready: ${selection} (${stdout.trim()}) at ${executablePath}`,
);
