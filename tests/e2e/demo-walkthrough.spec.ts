import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

import { mediaToolPaths } from "../../src/lib/media-tools";

const execFileAsync = promisify(execFile);

// This spec owns the pinned demo candidate that no other e2e spec touches,
// so the shared demo database never carries one spec's approval into
// another's flow.
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

interface DirectorTreatmentResponse {
  treatment: {
    id: string;
    candidateId: string;
    provider: "MOCK" | "OPENAI";
    model?: string;
    treatment: {
      recommendedSegment: { startSeconds: number; endSeconds: number };
      setupTimestamp: number;
      payoffTimestamp: number;
      adaptationConcept: string;
      socialCaption: string;
      confidence: number;
    };
  };
}

interface QaReportResponse {
  report: {
    overallStatus: "PASS" | "WARN" | "FAIL";
    score: number;
    checks: Array<{ key: string; status: "PASS" | "WARN" | "FAIL" }>;
  };
}

interface ProbeOutput {
  format: { duration: string };
  streams: Array<{ codec_type?: string; width?: number; height?: number }>;
}

let candidateId: string;
let directorResponse: DirectorTreatmentResponse;
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
  // A cold npm spawn can outlast the default hook timeout; this sets the
  // hook's own budget (Playwright 1.59 pattern).
  test.setTimeout(120_000);

  await mkdir(evidenceDir, { recursive: true });

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
});

test.use({ video: "on" });

test("agentic walkthrough: nine demo beats to an approved, downloadable cartoon", async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
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

  await test.step("beat 1 — load ranked trend candidates", async () => {
    await page.getByRole("button", { name: "Load demo candidates" }).click();
    await expect(page.getByText("10 candidates")).toBeVisible();
    await page.screenshot({
      path: path.join(evidenceDir, "01-inbox-ranked.png"),
      fullPage: true,
    });

    // Restore the owned candidate for repeatable runs. demo:reset is the
    // demo-day way to restore this state between full runs; inside the
    // shared parallel suite the equivalent safe move is restoring only
    // this spec's candidate so a CI retry starts from the same state.
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
    candidateId = owned!.id;
    if (owned!.status !== "NEW") {
      const restore = await request.patch(`/api/candidates/${candidateId}`, {
        data: { status: "NEW" },
      });
      expect(restore.ok()).toBe(true);
      await page.reload();
      await page.getByRole("button", { name: "Load demo candidates" }).click();
      await expect(page.getByText("10 candidates")).toBeVisible();
    }

    // The wow-layer one-click action lands on the pinned walkthrough
    // candidate with its owner-cleared source clip.
    await page.getByRole("button", { name: "Use demo candidate" }).click();
    await expect(
      page.getByRole("heading", { name: ownedCaption }),
    ).toBeVisible();

    // The Control Center reads the persisted trace: intake recorded the
    // Trend Scout and Humor Analyst as COMPLETE with evidence in the same
    // transaction that created the candidate.
    const cards = page.getByRole("list", { name: "Agent cards" });
    await expect(
      cards.getByRole("listitem", { name: "Trend Scout: Complete" }),
    ).toBeVisible();
    await expect(
      cards.getByRole("listitem", { name: "Humor Analyst: Complete" }),
    ).toBeVisible();
    await expect(
      cards.getByRole("listitem", { name: "YardToonz Director: Waiting" }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(evidenceDir, "02-control-center-intake.png"),
      fullPage: true,
    });
  });

  await test.step("beat 2 — open the candidate and run the laughter evidence analysis", async () => {
    await page.getByRole("button", { name: "Run the humor analysis" }).click();
    const panel = page.locator(".analyst-panel");
    await expect(
      panel.locator("dl > div").filter({ hasText: "Corpus" }),
    ).toContainText("10 comments");
    await expect(
      panel.locator("dl > div").filter({ hasText: "Coverage" }),
    ).toContainText("of comments carried laughter");
    await expect(panel.getByText("Evidence read only")).toBeVisible();
    await page.screenshot({
      path: path.join(evidenceDir, "03-humor-analysis.png"),
      fullPage: true,
    });
  });

  await test.step("beat 3 — ask the Director Agent for a treatment", async () => {
    // The demo operator asks the Director through its API; the persisted,
    // idempotent create-or-get treatment is the demo spine's handoff.
    const treatmentResponse = await request.post("/api/director/treatments", {
      data: { candidateId },
    });
    expect(treatmentResponse.ok()).toBe(true);
    const created =
      (await treatmentResponse.json()) as DirectorTreatmentResponse;
    expect(created.treatment.provider).toBe("MOCK");
    expect(created.treatment.candidateId).toBe(candidateId);
    directorResponse = created;

    // The Control Center picks up the persisted run: decision, confidence,
    // provider, and model are attributed on the card.
    const cards = page.getByRole("list", { name: "Agent cards" });
    const directorCard = cards.getByRole("listitem", {
      name: "YardToonz Director: Complete",
    });
    await expect(directorCard).toBeVisible({ timeout: 15_000 });
    await expect(
      directorCard.getByText(created.treatment.treatment.adaptationConcept),
    ).toBeVisible();
    await expect(
      directorCard
        .locator("dl.agent-attribution > div")
        .filter({ hasText: "Model" }),
    ).toContainText(created.treatment.model!);
    await expect(
      directorCard
        .locator("dl.agent-attribution > div")
        .filter({ hasText: "Provider" }),
    ).toContainText("Mock");

    // The Director's completion visibly hands off to the human gate.
    await expect(page.getByText("Media generation is gated.")).toBeVisible();

    // A refresh shows the same persisted history, never a blank slate.
    await page.reload();
    await page.getByRole("button", { name: "Load demo candidates" }).click();
    await expect(page.getByText("10 candidates")).toBeVisible();
    await page.getByRole("button", { name: "Use demo candidate" }).click();
    await expect(
      page.getByRole("list", { name: "Agent cards" }).getByRole("listitem", {
        name: "YardToonz Director: Complete",
      }),
    ).toBeVisible({ timeout: 15_000 });
    await page.screenshot({
      path: path.join(evidenceDir, "04-director-treatment.png"),
      fullPage: true,
    });
  });

  await test.step("beat 5 — pass the rights-confirmation hard gate", async () => {
    await page.getByRole("button", { name: "Approve for production" }).click();
    await expect(
      page.getByRole("heading", { name: "Confirm source rights" }),
    ).toBeVisible();

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
      path: path.join(evidenceDir, "05-rights-confirmed.png"),
      fullPage: true,
    });
  });

  await test.step("beat 4 — accept the Director's recommended segment", async () => {
    const recommended = directorResponse.treatment.treatment.recommendedSegment;
    await expect(page.getByLabel("Start (seconds)")).toHaveValue(
      String(recommended.startSeconds),
    );
    await expect(page.getByLabel("End (seconds)")).toHaveValue(
      String(recommended.endSeconds),
    );

    // Setup/payoff markers render only when the treatment reached the
    // setup screen, so their presence is the visible prefill proof.
    await expect(
      page.getByRole("img", { name: /Setup and payoff markers/ }),
    ).toBeVisible();
    await expect(
      page.getByText(
        new RegExp(
          `Setup at ${directorResponse.treatment.treatment.setupTimestamp.toFixed(1)}s, payoff at ${directorResponse.treatment.treatment.payoffTimestamp.toFixed(1)}s`,
        ),
      ),
    ).toBeVisible();
    await expect(page.getByLabel("Creative direction (optional)")).toHaveValue(
      directorResponse.treatment.treatment.adaptationConcept,
    );

    // One click loads the committed owner-cleared 6-second fixture.
    await page.getByRole("button", { name: "Use demo clip" }).click();
    const facts = page.locator('dl[aria-label="Probed source facts"]');
    await expect(facts).toContainText("6.0s");
    await expect(facts).toContainText("360 × 640");
    await expect(facts).toContainText("Present");
    await expect(
      page.getByText(/Segment 0\.0s\u20136\.0s \(6\.0s\) selected\./),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(evidenceDir, "06-segment-prefilled.png"),
      fullPage: true,
    });
  });

  let previewSrc: string | null;

  await test.step("queue the mock job on the real worker", async () => {
    const startButton = page.getByRole("button", { name: "Start production" });
    await expect(startButton).toBeEnabled();
    await startButton.click();

    await expect(
      page.getByRole("heading", { name: "Job monitor" }),
    ).toBeVisible();
    await expect(page.getByLabel("Production stage timeline")).toBeVisible();
    await expect(page.getByText("Image provider").locator("..")).toContainText(
      "Mock",
    );

    // Media generation is queued behind the human gate; the QA Inspector
    // owns the last pipeline stage and is still waiting at queue time.
    await expect(
      page
        .getByRole("list", { name: "Agent cards" })
        .getByRole("listitem", { name: "QA Inspector: Waiting" }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(evidenceDir, "07-job-queued.png"),
      fullPage: true,
    });
  });

  await test.step("beat 6 — watch the agent timeline run the media agents", async () => {
    // The worker claims one stage per poll tick, so the full mock pipeline
    // takes several seconds; the monitor polls every 3 seconds meanwhile.
    await expect(page.getByText(/^COMPLETE/)).toBeVisible({
      timeout: 150_000,
    });
    const cards = page.getByRole("list", { name: "Agent cards" });
    await expect(
      cards.getByRole("listitem", { name: "Clay Artist: Complete" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      cards.getByRole("listitem", { name: "Animator: Complete" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      cards.getByRole("listitem", { name: "QA Inspector: Complete" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      cards
        .getByRole("listitem", { name: "Clay Artist: Complete" })
        .locator("dl.agent-attribution > div")
        .filter({ hasText: "Provider" }),
    ).toContainText("Mock");
    await expect(
      cards
        .getByRole("listitem", { name: "Animator: Complete" })
        .locator("dl.agent-attribution > div")
        .filter({ hasText: "Provider" }),
    ).toContainText("Mock");
    await expect(page.getByText("Every media agent finished")).toBeVisible();
    await page.screenshot({
      path: path.join(evidenceDir, "08-agent-timeline.png"),
      fullPage: true,
    });
  });

  await test.step("beat 7 — see the original frame become claymation", async () => {
    const chain = page.getByRole("list", {
      name: "Keyframe, clay frame, animation, and final video",
    });
    await expect(chain).toBeVisible();
    await expect(chain.getByRole("listitem")).toHaveCount(4);

    const beforeAfter = page.getByTestId("before-after");
    await expect(beforeAfter).toBeVisible();
    await expect(
      beforeAfter.getByText("Before · source keyframe"),
    ).toBeVisible();
    await expect(beforeAfter.getByText("After · clay frame")).toBeVisible();
    await page.screenshot({
      path: path.join(evidenceDir, "09-claymation-reveal.png"),
      fullPage: true,
    });
  });

  await test.step("beat 8 — preview the animated output with original audio", async () => {
    await expect(
      page.getByRole("heading", { name: "Output review" }),
    ).toBeVisible();
    await expect(
      page.getByText(/^6\.\ds$/),
      "the probed output duration should be 6.0–6.9 seconds",
    ).toBeVisible();

    const facts = page.locator('dl[aria-label="Output facts"]');
    await expect(facts).toContainText("360 × 640");
    await expect(facts).toContainText("H264");
    await expect(facts).toContainText("Present");

    const lineage = page.getByRole("list", {
      name: "Artifact lineage from source to final video",
    });
    await expect(lineage.getByRole("listitem")).toHaveCount(7);

    previewSrc = await page.getByTestId("output-preview").getAttribute("src");
    expect(previewSrc).toBeTruthy();
    const previewResponse = await page.request.get(previewSrc!);
    expect(previewResponse.ok()).toBe(true);
    expect(previewResponse.headers()["content-type"]).toContain("video/mp4");
    await page.screenshot({
      path: path.join(evidenceDir, "10-output-preview.png"),
      fullPage: true,
    });
  });

  await test.step("beat 9 — approve and download video + caption package", async () => {
    await page.getByRole("button", { name: "Approve output" }).click();
    await expect(page.getByText("Output approved")).toBeVisible();
    await page.screenshot({
      path: path.join(evidenceDir, "11-output-approved.png"),
      fullPage: true,
    });

    // The QA Inspector's persisted report: the deterministic checks
    // registry judges the production, and nothing may FAIL.
    const productionId = /\/api\/productions\/([^/]+)\/artifacts\//.exec(
      previewSrc!,
    )?.[1];
    expect(productionId, "preview URL should name the production").toBeTruthy();
    const qaResponse = await request.post(
      `/api/productions/${productionId}/qa-report`,
    );
    expect(qaResponse.ok()).toBe(true);
    const qa = (await qaResponse.json()) as QaReportResponse;
    expect(
      qa.report.checks.every((check) => check.status !== "FAIL"),
      `QA report should have no failing checks: ${JSON.stringify(qa.report.checks)}`,
    ).toBe(true);
    expect(qa.report.score).toBeGreaterThanOrEqual(90);

    // Download the MP4 and prove it is a playable 9:16 cartoon.
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
    const videoStream = parsed.streams.find(
      (stream) => stream.codec_type === "video",
    );
    expect(videoStream?.width).toBe(360);
    expect(videoStream?.height).toBe(640);
    expect(parsed.streams.some((stream) => stream.codec_type === "audio")).toBe(
      true,
    );

    // The caption package ships the Director's social caption.
    const captionPromise = page.waitForEvent("download");
    await page.getByTestId("download-caption").click();
    const captionDownload = await captionPromise;
    expect(captionDownload.suggestedFilename()).toBe(
      `yardtoonz-caption-${productionId}.txt`,
    );
    const captionPath = path.join(evidenceDir, "downloaded-caption.txt");
    await captionDownload.saveAs(captionPath);
    const captionText = await readFile(captionPath, "utf8");
    expect(captionText).toBe(
      directorResponse.treatment.treatment.socialCaption,
    );

    // Attribution and the rights record ship with the output view.
    const attribution = page.getByTestId("attribution-panel");
    await expect(attribution).toBeVisible();
    await expect(
      attribution.getByText("Authorized demo contributor"),
    ).toBeVisible();
    await expect(page.getByTestId("caption-social")).toHaveText(
      directorResponse.treatment.treatment.socialCaption,
    );
    await expect(page.getByTestId("rights-record")).toContainText(
      "text version 2026-09-03",
    );
    await page.screenshot({
      path: path.join(evidenceDir, "12-caption-package.png"),
      fullPage: true,
    });
  });
});
