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

test("authorized MP4 passes the setup gates and queues a persisted production", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load demo candidates" }).click();
  // This spec owns a different seeded candidate than foundation.spec.ts so
  // the shared demo database never carries one spec's approval into the
  // other's flow.
  await page
    .getByRole("button", {
      name: /A confident domino slam lands on the wrong end of the table/,
    })
    .click();
  await page.getByRole("button", { name: "Approve for production" }).click();
  await page
    .getByRole("checkbox", { name: /I confirm Yard Toonz is authorized/ })
    .check();
  await page
    .getByRole("button", { name: "Confirm rights and continue" })
    .click();

  // The setup panel only offers the upload surface once a persisted
  // production exists and the candidate's rights confirmation is linked.
  await expect(
    page.getByText("Linked to the persisted candidate confirmation."),
  ).toBeVisible();

  const startButton = page.getByRole("button", { name: "Start production" });
  await expect(startButton).toBeDisabled();
  await expect(
    page.getByText("Upload the authorized source MP4 to continue."),
  ).toBeVisible();

  await page
    .getByLabel("Authorized source clip (MP4)")
    .setInputFiles(fixturePath);

  // Server-side probe results become visible facts on the setup panel.
  await expect(page.getByText("6.3s")).toBeVisible();
  await expect(page.getByText("Present", { exact: true })).toBeVisible();
  await expect(startButton).toBeEnabled();

  // The 5-8 second selector explains why an invalid draft stays locked.
  const endInput = page.getByLabel("End (seconds)");
  await endInput.fill("9");
  await expect(page.getByText(/at most 8 seconds long/).first()).toBeVisible();
  await expect(startButton).toBeDisabled();
  await endInput.fill("6");
  await expect(startButton).toBeEnabled();

  await startButton.click();

  await expect(
    page.getByRole("heading", { name: "Production queued" }),
  ).toBeVisible();
  await expect(page.getByText("All gates passed")).toBeVisible();
  await expect(page.getByText("Image provider").locator("..")).toContainText(
    "Mock",
  );
  await expect(
    page.getByText("Animation provider").locator(".."),
  ).toContainText("Mock");
});
