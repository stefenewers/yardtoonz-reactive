import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  getPlaywrightExecutablePath,
  playwrightBrowserSelections,
  selectPlaywrightBrowser,
} from "./playwright-browser.mjs";

const execFileAsync = promisify(execFile);
const selection = selectPlaywrightBrowser(process.platform);

// Video recording (used by the walkthrough evidence) requires Playwright's
// ffmpeg build on every platform; the browser selection stays separate.
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
await execFileAsync(npxCommand, ["playwright", "install", "ffmpeg"], {
  env: process.env,
  timeout: 120_000,
});

if (selection === playwrightBrowserSelections.standard) {
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
