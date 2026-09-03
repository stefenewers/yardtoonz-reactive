import { execFile } from "node:child_process";
import { promisify } from "node:util";

process.env.AWS_EXECUTION_ENV ??= "AWS_Lambda_nodejs20.x";

const { default: chromium } = await import("@sparticuz/chromium");
chromium.setGraphicsMode = false;

const executablePath = await chromium.executablePath();
const { stdout } = await promisify(execFile)(executablePath, ["--version"], {
  env: process.env,
  timeout: 30_000,
});

console.log(`Playwright Chromium ready: ${stdout.trim()} at ${executablePath}`);
