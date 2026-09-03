import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

import { mediaToolPaths } from "../../src/lib/media-tools";

const execFileAsync = promisify(execFile);

// This spec owns a seeded candidate that no other e2e spec touches, so the
// shared demo database never carries one spec's approval into another's flow.
const ownedCaption = "Fresh laundry meets the first sudden drop of rain.";
const evidenceDir = path.join("test-results", "walkthrough");
// Playwright always runs from the repo root (same cwd as global-setup),
// and __dirname does not exist in ES module scope.
const repoRoot = process.cwd();

interface CandidateSummary {
  id: string;
  caption: string;
  status: "NEW" | "APPROVED" | "REJECTED";
}

interface ProbeOutput {
  format: { duration: string };
  streams: Array<{ codec_type?: string }>;
}

let fixtureDirectory: string;
let fixturePath: string;
let workerProcess: ChildProcess | undefined;
let workerOutput = "";

function tailWorkerOutput(): string {
  return workerOutput.slice(-4_000);
}

async function stopWorker(): Promise<void> {
  const worker = workerProcess;
  if (!worker || worker.exitCode !== null || !worker.pid) return;

  // npm spawns tsx as a child, so signal the whole detached process group;
  // killing only npm would orphan the worker mid-suite.
  try {
    if (process.platform !== "win32") {
      process.kill(-worker.pid, "SIGTERM");
    } else {
      worker.kill("SIGTERM");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      try {
        if (process.platform !== "win32" && worker.pid) {
          process.kill(-worker.pid, "SIGKILL");
        } else {
          worker.kill("SIGKILL");
        }
      } catch {
        // Already gone.
      }
      resolve();
    }, 5_000);
    worker.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

test.beforeAll(async () => {
  // Fixture generation plus a cold npm spawn can outlast the default hook
  // timeout; this sets the hook's own budget (Playwright 1.59 pattern).
  test.setTimeout(120_000);

  await mkdir(evidenceDir, { recursive: true });

  // The authorized source fixture mirrors the runbook demo clip: a short MP4
  // with a real audio stream, long enough for a valid 5-8 second segment.
  fixtureDirectory = await mkdtemp(
    path.join(tmpdir(), "yardtoonz-walkthrough-"),
  );
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

  // The walkthrough exercises the real demo-day command, which must boot the
  // worker against the same local database and artifact root as the server.
  workerProcess = spawn("npm", ["run", "worker"], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  workerProcess.stdout?.on("data", (chunk: Buffer) => {
    workerOutput = (workerOutput + chunk.toString()).slice(-8_000);
  });
  workerProcess.stderr?.on("data", (chunk: Buffer) => {
    workerOutput = (workerOutput + chunk.toString()).slice(-8_000);
  });
  workerProcess.once("exit", (code) => {
    workerOutput += `\n[worker exited early with code ${code}]`;
  });

  // Sanity wait only: the fresh-heartbeat proof belongs to the test body,
  // where the generous test timeout applies instead of the hook timeout.
  const startedDeadline = Date.now() + 15_000;
  while (
    Date.now() < startedDeadline &&
    workerProcess?.exitCode === null &&
    !workerOutput.includes("Worker started")
  ) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
});
test.afterAll(async () => {
  await stopWorker();
  await rm(fixtureDirectory, { recursive: true, force: true });
});

test.use({ video: "on" });

test("runbook walkthrough: approved candidate to approved, downloadable cartoon", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  await test.step("run the demo-day worker and confirm a fresh heartbeat", async () => {
    try {
      await expect
        .poll(
          async () => {
            if (workerProcess && workerProcess.exitCode !== null) {
              throw new Error(
                `npm run worker exited during startup:\n${tailWorkerOutput()}`,
              );
            }
            const health = await request.get("/api/health");
            const body = (await health.json()) as {
              checks?: { worker?: { diagnostic?: string } };
            };
            return body.checks?.worker?.diagnostic;
          },
          { timeout: 60_000 },
        )
        .toBe("fresh");
    } catch (error) {
      let databaseDiagnostics = "";
      try {
        const { default: Sqlite } = await import("better-sqlite3");
        const probe = new Sqlite(path.join(repoRoot, ".data", "yardtoonz.db"), {
          readonly: true,
        });
        const rows = probe
          .prepare("SELECT worker_id, observed_at FROM worker_heartbeats")
          .all();
        probe.close();
        databaseDiagnostics = `\nheartbeats visible from the test process: ${JSON.stringify(rows)}`;
      } catch (probeError) {
        databaseDiagnostics = `\n(test-process database probe failed: ${
          probeError instanceof Error ? probeError.message : String(probeError)
        })`;
      }
      throw new Error(
        `worker heartbeat never became fresh; worker output:\n${tailWorkerOutput()}${databaseDiagnostics}`,
        { cause: error },
      );
    }
  });

  await page.goto("/");

  await test.step("import and seed the deterministic demo candidates", async () => {
    await page.getByRole("button", { name: "Load demo candidates" }).click();
    await expect(page.getByText("10 candidates")).toBeVisible();
    await page.screenshot({
      path: path.join(evidenceDir, "01-inbox-seeded.png"),
      fullPage: true,
    });
  });

  await test.step("restore the owned candidate for repeatable runs", async () => {
    // demo:reset is the demo-day way to restore this state between full runs;
    // inside the shared parallel suite the equivalent safe move is restoring
    // only this spec's candidate so a CI retry starts from the same state.
    const listResponse = await request.get("/api/candidates");
    expect(listResponse.ok()).toBe(true);
    const list = (await listResponse.json()) as {
      candidates: CandidateSummary[];
    };
    const owned = list.candidates.find(
      (candidate) => candidate.caption === ownedCaption,
    );
    expect(
      owned,
      "seeded demo candidates should include the owned caption",
    ).toBeTruthy();
    if (owned && owned.status !== "NEW") {
      const restore = await request.patch(`/api/candidates/${owned.id}`, {
        data: { status: "NEW" },
      });
      expect(restore.ok()).toBe(true);
      await page.reload();
      await expect(page.getByText("10 candidates")).toBeVisible();
    }
  });

  await test.step("evaluate the candidate and approve it for production", async () => {
    await page.getByRole("button", { name: new RegExp(ownedCaption) }).click();
    await expect(
      page.getByRole("heading", { name: ownedCaption }),
    ).toBeVisible();
    await expect(
      page.getByText("Viral momentum", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Humor response", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Yard Toonz fit", { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Approve for production" }).click();
    await expect(
      page.getByRole("heading", { name: "Confirm source rights" }),
    ).toBeVisible();
  });

  await test.step("pass the rights-confirmation hard gate", async () => {
    const continueButton = page.getByRole("button", {
      name: "Confirm rights and continue",
    });
    await expect(continueButton).toBeDisabled();
    await expect(
      page.getByText("Confirm authorization to continue to clip upload."),
    ).toBeVisible();

    await page
      .getByRole("checkbox", { name: /I confirm Yard Toonz is authorized/ })
      .check();
    await expect(continueButton).toBeEnabled();
    await continueButton.click();

    await expect(
      page.getByText("Linked to the persisted candidate confirmation."),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(evidenceDir, "02-rights-confirmed.png"),
      fullPage: true,
    });
  });

  await test.step("upload the authorized source and pick a valid segment", async () => {
    const startButton = page.getByRole("button", { name: "Start production" });
    await expect(startButton).toBeDisabled();
    await expect(
      page.getByText("Upload the authorized source MP4 to continue."),
    ).toBeVisible();

    await page
      .getByLabel("Authorized source clip (MP4)")
      .setInputFiles(fixturePath);

    // The probed facts are server-side evidence, not client decoration.
    await expect(page.getByText("6.3s")).toBeVisible();
    await expect(page.getByText("Present", { exact: true })).toBeVisible();
    await expect(startButton).toBeEnabled();

    const endInput = page.getByLabel("End (seconds)");
    await endInput.fill("9");
    await expect(
      page.getByText(/at most 8 seconds long/).first(),
    ).toBeVisible();
    await expect(startButton).toBeDisabled();
    await endInput.fill("6");
    await expect(startButton).toBeEnabled();

    await page.screenshot({
      path: path.join(evidenceDir, "03-upload-segment.png"),
      fullPage: true,
    });
  });

  await test.step("queue the mock job and hand over to the job monitor", async () => {
    await page.getByRole("button", { name: "Start production" }).click();

    await expect(
      page.getByRole("heading", { name: "Job monitor" }),
    ).toBeVisible();
    await expect(page.getByLabel("Production stage timeline")).toBeVisible();
    await expect(page.getByText("Image provider").locator("..")).toContainText(
      "Mock",
    );
    await expect(
      page.getByText("Animation provider").locator(".."),
    ).toContainText("Mock");
    await page.screenshot({
      path: path.join(evidenceDir, "04-job-queued.png"),
      fullPage: true,
    });
  });

  await test.step("worker drives every stage to completion", async () => {
    // The worker claims one stage per poll tick, so the full mock pipeline
    // takes several seconds; the monitor polls every 3 seconds meanwhile.
    await expect(page.getByText(/^COMPLETE/)).toBeVisible({
      timeout: 150_000,
    });
    await expect(
      page.getByRole("heading", { name: "Output review" }),
    ).toBeVisible();

    const lineage = page.getByRole("list", {
      name: "Artifact lineage from source to final video",
    });
    await expect(lineage.getByRole("listitem")).toHaveCount(7);

    await expect(page.getByText(/^6\.\ds$/)).toBeVisible();
    await expect(page.getByText("Present", { exact: true })).toBeVisible();
    await expect(page.getByTestId("output-preview")).toBeVisible();
    await page.screenshot({
      path: path.join(evidenceDir, "05-output-complete.png"),
      fullPage: true,
    });
  });

  await test.step("preview streams the final video artifact", async () => {
    const previewSrc = await page
      .getByTestId("output-preview")
      .getAttribute("src");
    expect(previewSrc).toBeTruthy();
    const previewResponse = await page.request.get(previewSrc!);
    expect(previewResponse.ok()).toBe(true);
    expect(previewResponse.headers()["content-type"]).toContain("video/mp4");
  });

  await test.step("record the human output approval", async () => {
    await page.getByRole("button", { name: "Approve output" }).click();
    await expect(page.getByText("Output approved")).toBeVisible();
    await page.screenshot({
      path: path.join(evidenceDir, "06-output-approved.png"),
      fullPage: true,
    });
  });

  await test.step("download the MP4 and prove it is a playable cartoon", async () => {
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("download-final").click();
    const download = await downloadPromise;
    const downloadPath = path.join(evidenceDir, "downloaded-final.mp4");
    await download.saveAs(downloadPath);

    const probe = await execFileAsync(mediaToolPaths.ffprobe, [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      downloadPath,
    ]);
    await writeFile(
      path.join(evidenceDir, "downloaded-final-probe.json"),
      probe.stdout,
      "utf8",
    );
    const parsed = JSON.parse(probe.stdout) as ProbeOutput;
    const durationSeconds = Number.parseFloat(parsed.format.duration);
    expect(durationSeconds).toBeGreaterThanOrEqual(5.5);
    expect(durationSeconds).toBeLessThanOrEqual(6.5);
    expect(parsed.streams.some((stream) => stream.codec_type === "audio")).toBe(
      true,
    );
  });
});
