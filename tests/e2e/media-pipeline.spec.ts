import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

import { mediaToolPaths } from "../../src/lib/media-tools";

const execFileAsync = promisify(execFile);
let fixtureDirectory: string;
let fixturePath: string;

test.beforeAll(async () => {
  fixtureDirectory = await mkdtemp(path.join(tmpdir(), "yardtoonz-e2e-"));
  fixturePath = path.join(fixtureDirectory, "authorized-source.mp4");
  await execFileAsync(mediaToolPaths.ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x240:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=523:sample_rate=44100",
    "-t",
    "6.3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    fixturePath,
  ]);
});

test.afterAll(async () => {
  await rm(fixtureDirectory, { recursive: true, force: true });
});

test("authorized MP4 becomes a previewable and downloadable mock cartoon", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load demo candidates" }).click();
  await page
    .getByRole("button", {
      name: /The bus finally arrives just as everybody gives up waiting/,
    })
    .click();
  await page.getByRole("button", { name: "Approve for production" }).click();
  await page
    .getByRole("checkbox", { name: /I confirm Yard Toonz is authorized/ })
    .check();
  await page
    .getByRole("button", { name: "Confirm rights and continue" })
    .click();
  await expect(page.getByText("Rights confirmed")).toBeVisible();

  const createButton = page.getByRole("button", { name: "Create cartoon" });
  await expect(createButton).toBeDisabled();
  await expect(page.getByRole("checkbox")).toBeChecked();
  await page.getByLabel("Source MP4").setInputFiles(fixturePath);
  await expect(page.getByText("authorized-source.mp4")).toBeVisible();
  await expect(createButton).toBeEnabled();
  await createButton.click();

  await expect(
    page.getByRole("heading", { name: "Preview your mock" }),
  ).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.locator("video")).toHaveAttribute(
    "src",
    /artifacts\/final$/,
  );
  await expect(
    page.getByText("Audio", { exact: true }).locator(".."),
  ).toContainText("Restored");
  await expect(page.getByText("Image provider").locator("..")).toContainText(
    "MOCK",
  );
  await expect(
    page.getByText("Animation provider").locator(".."),
  ).toContainText("MOCK");
  await expect(
    page.getByRole("link", { name: "Download MP4" }),
  ).toHaveAttribute("href", /artifacts\/final\?download=1$/);
});
