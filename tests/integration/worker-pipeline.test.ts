import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";

import { candidateFixtures } from "../../fixtures/candidates";
import {
  createLocalArtifactStore,
  generateArtifactStorageKey,
  type ArtifactStore,
} from "../../src/lib/artifact-store";
import { mediaToolPaths } from "../../src/lib/media-tools";
import { createCandidateRepository } from "../../src/server/candidates/repository";
import * as schema from "../../src/server/db/schema";
import {
  artifacts,
  directorTreatments,
  productions,
  productionStages,
} from "../../src/server/db/schema";
import {
  createDefaultStageExecutors,
  WorkerStageError,
  type PipelineStageName,
  type StageExecutor,
} from "../../src/server/productions/pipeline";
import type { ImageProvider } from "../../src/lib/providers";
import { createProductionRepository } from "../../src/server/productions/repository";
import { createProductionWorkerRepository } from "../../src/server/productions/worker-repository";
import {
  runWorkerTick,
  selectDefaultStageExecutor,
} from "../../src/worker/runner";

const execFileAsync = promisify(execFile);

const SEGMENT = { startSeconds: 0, endSeconds: 6, durationSeconds: 6 };
const NOW = new Date("2026-09-03T12:03:00.000Z");
const WORKER_ID = "worker-test";

let fixtureBytes: Uint8Array;

beforeAll(async () => {
  // A 6.3-second 320x240 test source with a 440 Hz tone: long enough to cover
  // the 6-second segment and carrying a real audio track.
  const fixtureDirectory = await mkdtemp(
    path.join(tmpdir(), "yardtoonz-worker-src-"),
  );
  const fixturePath = path.join(fixtureDirectory, "authorized-source.mp4");
  try {
    await execFileAsync(mediaToolPaths.ffmpeg, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x240:rate=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100",
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
    fixtureBytes = new Uint8Array(await readFile(fixturePath));
  } finally {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

interface Harness {
  database: ReturnType<typeof drizzle<typeof schema>>;
  store: ArtifactStore;
  candidates: ReturnType<typeof createCandidateRepository>;
  productions: ReturnType<typeof createProductionRepository>;
  worker: ReturnType<typeof createProductionWorkerRepository>;
  executors?: Partial<Record<PipelineStageName, StageExecutor>>;
}

const openDatabases: Database.Database[] = [];
const artifactRoots: string[] = [];

afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close();
  await Promise.all(
    artifactRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

function createHarness(): Harness {
  const sqlite = new Database(":memory:");
  openDatabases.push(sqlite);
  sqlite.pragma("foreign_keys = ON");
  const database = drizzle(sqlite, { schema });
  migrate(database, {
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });

  const artifactRoot = mkdtempSync(
    path.join(tmpdir(), "yardtoonz-worker-art-"),
  );
  artifactRoots.push(artifactRoot);
  const store = createLocalArtifactStore({ rootDirectory: artifactRoot });

  return {
    database,
    store,
    candidates: createCandidateRepository(database),
    productions: createProductionRepository(database),
    worker: createProductionWorkerRepository(database, store),
  };
}

/** Seeds an approved candidate with confirmed rights and a queued production whose source is stored. */
async function seedAndQueue(
  harness: Harness,
  animationProvider: "MOCK" | "RUNWAY" = "MOCK",
  imageProvider: ImageProvider = "MOCK",
): Promise<string> {
  harness.candidates.seed(candidateFixtures, "2026-09-03T12:00:00.000Z");
  const candidateId = candidateFixtures[0]!.id;
  harness.candidates.approve(candidateId, "2026-09-03T12:01:00.000Z");
  harness.candidates.confirmRights({
    candidateId,
    confirmedAt: "2026-09-03T12:02:00.000Z",
    confirmationTextVersion: "rights-v1",
  });

  const id = harness.productions.createDraft({
    candidateId,
    segment: SEGMENT,
    imageProvider,
    animationProvider,
    now: NOW,
  });
  // Links the candidate's persisted rights row onto the production so the
  // start gate can verify it atomically.
  harness.productions.confirmRights(id, NOW);

  const storageKey = generateArtifactStorageKey(id, "source.mp4");
  const stored = await harness.store.save({
    bytes: fixtureBytes,
    storageKey,
    mimeType: "video/mp4",
  });
  harness.productions.recordSourceUpload(
    id,
    {
      storageKey: stored.storageKey,
      mimeType: "video/mp4",
      byteSize: fixtureBytes.byteLength,
      sha256: stored.sha256,
      metadata: { durationSeconds: 6.3, audioPresent: true },
    },
    NOW,
  );

  harness.productions.start(id, NOW);
  return id;
}

/** Runs worker ticks until the production reaches the terminal status. */
async function runUntil(
  harness: Harness,
  id: string,
  terminal: "COMPLETE" | "FAILED",
  maxTicks = 14,
): Promise<void> {
  for (let index = 0; index < maxTicks; index += 1) {
    await runWorkerTick({
      database: harness.database,
      store: harness.store,
      options: { workerId: WORKER_ID, executors: harness.executors },
    });
    const row = harness.database
      .select({ status: productions.status })
      .from(productions)
      .where(eq(productions.id, id))
      .get();
    if (row?.status === terminal) return;
  }
  throw new Error(
    `Production did not reach ${terminal} within ${maxTicks} ticks`,
  );
}

function artifactRows(harness: Harness, id: string) {
  return harness.database
    .select()
    .from(artifacts)
    .where(eq(artifacts.productionId, id))
    .all();
}

interface ProbeStream {
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
}

async function ffprobeJson(filePath: string): Promise<{
  streams: ProbeStream[];
  format: { duration: string };
}> {
  const { stdout } = await execFileAsync(mediaToolPaths.ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,codec_name,width,height",
    "-of",
    "json",
    filePath,
  ]);
  return JSON.parse(stdout) as {
    streams: ProbeStream[];
    format: { duration: string };
  };
}

describe("worker media pipeline", () => {
  it(
    "runs the end-to-end mock job to COMPLETE with FFprobe-verified 9:16 audio output",
    { timeout: 120_000 },
    async () => {
      const harness = createHarness();
      const id = await seedAndQueue(harness);

      await runUntil(harness, id, "COMPLETE");

      const rows = artifactRows(harness, id);
      expect(rows.map((row) => row.kind).sort()).toEqual(
        [
          "SOURCE_VIDEO",
          "EXTRACTED_CLIP",
          "EXTRACTED_AUDIO",
          "KEYFRAME",
          "STYLED_FRAME",
          "SILENT_ANIMATION",
          "FINAL_VIDEO",
        ].sort(),
      );

      // Every artifact's bytes are present and match the persisted digest.
      for (const row of rows) {
        const integrity = await harness.store.inspect(row.storageKey);
        expect(integrity.sha256).toBe(row.sha256);
        expect(integrity.byteSize).toBe(row.byteSize);
      }

      // Mock attribution: the styled frame is honestly labeled, never AI.
      const styledRow = rows.find((row) => row.kind === "STYLED_FRAME")!;
      expect(JSON.parse(styledRow.metadataJson)).toMatchObject({
        styledBy: "MOCK",
      });
      expect(styledRow.provider).toBe("MOCK");

      // Independent FFprobe verification of the final deliverable.
      const finalRow = rows.find((row) => row.kind === "FINAL_VIDEO")!;
      const finalPath = await harness.store.resolve(finalRow.storageKey);
      const probe = await ffprobeJson(finalPath);
      const videoStreams = probe.streams.filter(
        (stream) => stream.codec_type === "video",
      );
      const audioStreams = probe.streams.filter(
        (stream) => stream.codec_type === "audio",
      );
      expect(videoStreams).toHaveLength(1);
      expect(audioStreams).toHaveLength(1);
      expect(audioStreams[0]!.codec_name).toBe("aac");

      const { width, height } = videoStreams[0]!;
      expect(width).toBeDefined();
      expect(height).toBeDefined();
      // 9:16 portrait exactly (any resolution; the ratio is the contract).
      expect(width! * 16).toBe(height! * 9);

      const durationSeconds = Number(probe.format.duration);
      expect(
        Math.abs(durationSeconds - SEGMENT.durationSeconds),
      ).toBeLessThanOrEqual(0.1);

      // Stage rows all completed on the first attempt.
      const stageRows = harness.database
        .select()
        .from(productionStages)
        .where(eq(productionStages.productionId, id))
        .all();
      for (const stage of stageRows) {
        expect(stage.status).toBe("COMPLETE");
        expect(stage.attempt).toBe(1);
      }
    },
  );

  it("grants a stage lease to exactly one worker until it expires", async () => {
    const harness = createHarness();
    const id = await seedAndQueue(harness);
    const stage = harness.database
      .select()
      .from(productionStages)
      .where(eq(productionStages.productionId, id))
      .all()
      .find((row) => row.name === "EXTRACT_MEDIA")!;

    const claim = (workerId: string) =>
      harness.worker.claimStage({
        stageRowId: stage.id,
        stageName: "EXTRACT_MEDIA",
        productionId: id,
        workerId,
        now: NOW,
        leaseMs: 60_000,
      });

    expect(claim("worker-b")).toBe(true);
    expect(claim("worker-c")).toBe(false);

    // Expire worker-b's lease: the stage returns to the claimable pool.
    harness.database
      .update(productionStages)
      .set({ workerLeaseExpiresAt: new Date(NOW.getTime() - 1_000) })
      .where(eq(productionStages.id, stage.id))
      .run();
    expect(claim("worker-c")).toBe(true);
  });

  it(
    "retries a failed stage without duplicating or rewriting upstream artifacts",
    { timeout: 120_000 },
    async () => {
      const harness = createHarness();
      const id = await seedAndQueue(harness);
      harness.executors = {
        ANIMATE_IMAGE: () =>
          Promise.reject(
            new WorkerStageError("MEDIA_PROCESSING_FAILED", "boom"),
          ),
      };
      await runUntil(harness, id, "FAILED");

      const failedProduction = harness.database
        .select()
        .from(productions)
        .where(eq(productions.id, id))
        .get()!;
      expect(failedProduction.status).toBe("FAILED");
      expect(failedProduction.errorCode).toBe("MEDIA_PROCESSING_FAILED");
      expect(failedProduction.activeStage).toBe("ANIMATE_IMAGE");

      const failedRows = artifactRows(harness, id);
      // Five upstream artifacts exist when ANIMATE_IMAGE fails (no
      // SILENT_ANIMATION or FINAL_VIDEO yet); all five must survive the retry.
      const upstreamSnapshot = failedRows
        .filter((row) => row.kind !== "SILENT_ANIMATION")
        .map((row) => ({ kind: row.kind, id: row.id, sha256: row.sha256 }));
      expect(upstreamSnapshot).toHaveLength(5);

      await harness.worker.retryFailedStage(id, new Date());

      // A second retry on the re-armed (non-FAILED) job is rejected.
      await expect(
        harness.worker.retryFailedStage(id, new Date()),
      ).rejects.toMatchObject({ code: "ILLEGAL_TRANSITION" });

      const reProduction = harness.database
        .select()
        .from(productions)
        .where(eq(productions.id, id))
        .get()!;
      expect(reProduction.status).toBe("ANIMATING");
      expect(reProduction.errorCode).toBeNull();
      expect(reProduction.attempt).toBe(2);

      // The failed stage has a fresh attempt row; the old one stays FAILED.
      const animateRows = harness.database
        .select()
        .from(productionStages)
        .where(eq(productionStages.productionId, id))
        .all()
        .filter((row) => row.name === "ANIMATE_IMAGE")
        .sort((a, b) => a.attempt - b.attempt);
      expect(animateRows.map((row) => [row.attempt, row.status])).toEqual([
        [1, "FAILED"],
        [2, "WAITING"],
      ]);

      // Resume with the default executors and finish the job.
      harness.executors = undefined;
      await runUntil(harness, id, "COMPLETE");

      const finalRows = artifactRows(harness, id);
      expect(finalRows).toHaveLength(7);
      for (const snapshot of upstreamSnapshot) {
        const row = finalRows.find(
          (candidate) => candidate.kind === snapshot.kind,
        )!;
        expect(row.id).toBe(snapshot.id);
        expect(row.sha256).toBe(snapshot.sha256);
      }
    },
  );

  it(
    "attributes RUNWAY productions to the RUNWAY provider with request lineage",
    { timeout: 120_000 },
    async () => {
      const harness = createHarness();
      const id = await seedAndQueue(harness, "RUNWAY");

      // The default mock animation executor stands in for the real Runway
      // executor here: same artifact contract, no network. The point is the
      // production's persisted provider selection, not the media source.
      const defaults = createDefaultStageExecutors();
      harness.executors = {
        ANIMATE_IMAGE: async (context) => {
          const result = await defaults.ANIMATE_IMAGE(context);
          return {
            artifacts: result.artifacts.map((artifact) => ({
              ...artifact,
              providerRequestId: "runway-e2e-1",
            })),
          };
        },
      };
      await runUntil(harness, id, "COMPLETE");

      const animationRow = artifactRows(harness, id).find(
        (row) => row.kind === "SILENT_ANIMATION",
      )!;
      // Honest attribution from the production's selection, with request
      // lineage persisted on the artifact row.
      expect(animationRow.provider).toBe("RUNWAY");
      expect(animationRow.providerRequestId).toBe("runway-e2e-1");

      // The styled frame still attributes to the image provider selection.
      const styledRow = artifactRows(harness, id).find(
        (row) => row.kind === "STYLED_FRAME",
      )!;
      expect(styledRow.provider).toBe("MOCK");
    },
  );

  it("persists the provider request ID when a stage fails for reconciliation", async () => {
    const harness = createHarness();
    const id = await seedAndQueue(harness, "RUNWAY");
    const stage = harness.database
      .select()
      .from(productionStages)
      .where(eq(productionStages.productionId, id))
      .all()
      .find((row) => row.name === "EXTRACT_MEDIA")!;

    expect(
      harness.worker.claimStage({
        stageRowId: stage.id,
        stageName: "EXTRACT_MEDIA",
        productionId: id,
        workerId: WORKER_ID,
        now: NOW,
        leaseMs: 60_000,
      }),
    ).toBe(true);
    // The runner moves the job into a worker-owned phase before executing;
    // failStage's FAIL transition requires that state.
    harness.worker.beginExtraction({
      productionId: id,
      workerId: WORKER_ID,
      now: NOW,
    });

    harness.worker.failStage({
      productionId: id,
      stageRowId: stage.id,
      workerId: WORKER_ID,
      errorCode: "PROVIDER_UNKNOWN_OUTCOME",
      safeErrorMessage: "A media processing step failed for this stage.",
      providerRequestId: "runway-fail-1",
      now: new Date(NOW.getTime() + 1_000),
    });

    const failedStage = harness.database
      .select()
      .from(productionStages)
      .where(eq(productionStages.id, stage.id))
      .get()!;
    expect(failedStage.status).toBe("FAILED");
    expect(failedStage.providerRequestId).toBe("runway-fail-1");
    expect(failedStage.errorCode).toBe("PROVIDER_UNKNOWN_OUTCOME");
  });

  it("selects live executors only for jobs persisted with live selections", () => {
    const defaults = createDefaultStageExecutors();
    const liveExecutor: StageExecutor = async () => ({ artifacts: [] });
    const factories = {
      createOpenAIImageExecutor: () => liveExecutor,
      createRunwayAnimationExecutor: () => liveExecutor,
    };

    expect(
      selectDefaultStageExecutor(
        "ANIMATE_IMAGE",
        { imageProvider: "MOCK", animationProvider: "RUNWAY" },
        defaults,
        factories,
      ),
    ).toBe(liveExecutor);
    // MOCK productions never touch the live factories.
    expect(
      selectDefaultStageExecutor(
        "ANIMATE_IMAGE",
        {
          imageProvider: "MOCK",
          animationProvider: "MOCK",
        },
        defaults,
        {
          createRunwayAnimationExecutor: () => {
            throw new Error("must not construct a Runway executor");
          },
        },
      ),
    ).toBe(defaults.ANIMATE_IMAGE);
    // Other stages always use the defaults, even under live selections.
    expect(
      selectDefaultStageExecutor(
        "STYLE_IMAGE",
        { imageProvider: "MOCK", animationProvider: "RUNWAY" },
        defaults,
        factories,
      ),
    ).toBe(defaults.STYLE_IMAGE);
    // A live selection with no executor configured fails fast.
    expect(() =>
      selectDefaultStageExecutor(
        "ANIMATE_IMAGE",
        { imageProvider: "MOCK", animationProvider: "RUNWAY" },
        defaults,
      ),
    ).toThrow(WorkerStageError);
  });

  it(
    "refuses to retry when an upstream artifact no longer matches its digest",
    { timeout: 120_000 },
    async () => {
      const harness = createHarness();
      const id = await seedAndQueue(harness);
      harness.executors = {
        ANIMATE_IMAGE: () =>
          Promise.reject(
            new WorkerStageError("MEDIA_PROCESSING_FAILED", "boom"),
          ),
      };
      await runUntil(harness, id, "FAILED");

      const clipRow = artifactRows(harness, id).find(
        (row) => row.kind === "EXTRACTED_CLIP",
      )!;
      await writeFile(
        await harness.store.resolve(clipRow.storageKey),
        Buffer.from("corrupted"),
      );

      await expect(
        harness.worker.retryFailedStage(id, new Date()),
      ).rejects.toMatchObject({ code: "UPSTREAM_ARTIFACTS_REQUIRED" });

      const stillFailed = harness.database
        .select({ status: productions.status })
        .from(productions)
        .where(eq(productions.id, id))
        .get()!;
      expect(stillFailed.status).toBe("FAILED");
    },
  );
});

describe("persisted provider combinations", () => {
  // Real FFmpeg fixtures so downstream stages and validation exercise
  // genuine media even though the live providers themselves are stubbed.
  let styledPngBytes: Uint8Array;
  let runwayVideoBytes: Uint8Array;

  beforeAll(async () => {
    const fixtureDirectory = await mkdtemp(
      path.join(tmpdir(), "yardtoonz-provider-fixtures-"),
    );
    try {
      const pngPath = path.join(fixtureDirectory, "styled.png");
      await execFileAsync(mediaToolPaths.ffmpeg, [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=360x640:rate=24",
        "-frames:v",
        "1",
        pngPath,
      ]);
      styledPngBytes = new Uint8Array(await readFile(pngPath));

      const videoPath = path.join(fixtureDirectory, "runway-out.mp4");
      await execFileAsync(mediaToolPaths.ffmpeg, [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=360x640:rate=24",
        "-t",
        "6",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        videoPath,
      ]);
      runwayVideoBytes = new Uint8Array(await readFile(videoPath));
    } finally {
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    for (const key of [
      "OPENAI_API_KEY",
      "OPENAI_IMAGE_MODEL",
      "RUNWAY_API_KEY",
      "RUNWAY_MODEL",
    ]) {
      delete process.env[key];
    }
    vi.unstubAllGlobals();
  });

  const OPENAI_REQUEST_ID = "req_openai_e2e";
  const RUNWAY_TASK_ID = "task_runway_e2e";

  /** Stubs both live-provider endpoints so no test ever touches the network. */
  function useLiveProviderEnv(): void {
    process.env.OPENAI_API_KEY = "test-key-not-a-secret";
    process.env.OPENAI_IMAGE_MODEL = "gpt-image-test";
    process.env.RUNWAY_API_KEY = "test-key-not-a-secret";
    process.env.RUNWAY_MODEL = "gen4-turbo-test";
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        if (url.endsWith("/images/edits")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  b64_json: Buffer.from(styledPngBytes).toString("base64"),
                },
              ],
            }),
            {
              status: 200,
              headers: { "x-request-id": OPENAI_REQUEST_ID },
            },
          );
        }
        if (url === "https://api.dev.runwayml.com/v1/image_to_video") {
          return new Response(
            JSON.stringify({ id: RUNWAY_TASK_ID, estimatedCost: {} }),
            { status: 200 },
          );
        }
        if (url.startsWith("https://api.dev.runwayml.com/v1/tasks/")) {
          return new Response(
            JSON.stringify({
              id: RUNWAY_TASK_ID,
              status: "SUCCEEDED",
              output: ["https://runway.test/output.mp4"],
            }),
            { status: 200 },
          );
        }
        if (url === "https://runway.test/output.mp4") {
          return new Response(new Uint8Array(runwayVideoBytes), {
            status: 200,
          });
        }
        throw new Error(`Unexpected provider fetch in test: ${url}`);
      },
    );
  }

  /** Asserts honest artifact + stage attribution and request lineage for a finished job. */
  function expectAttribution(
    harness: Harness,
    id: string,
    imageProvider: ImageProvider,
    animationProvider: "MOCK" | "RUNWAY",
  ): void {
    const rows = artifactRows(harness, id);

    const styled = rows.find((row) => row.kind === "STYLED_FRAME")!;
    expect(styled.provider).toBe(imageProvider);
    expect(styled.providerRequestId ?? null).toBe(
      imageProvider === "OPENAI" ? OPENAI_REQUEST_ID : null,
    );
    expect(JSON.parse(styled.metadataJson)).toMatchObject({
      styledBy: imageProvider,
    });

    const animation = rows.find((row) => row.kind === "SILENT_ANIMATION")!;
    expect(animation.provider).toBe(animationProvider);
    expect(animation.providerRequestId ?? null).toBe(
      animationProvider === "RUNWAY" ? RUNWAY_TASK_ID : null,
    );

    // The API views surface the same lineage for attribution display.
    const detail = harness.productions.getDetail(id)!;
    const styledView = detail.artifacts.find(
      (artifact) => artifact.kind === "STYLED_FRAME",
    )!;
    expect(styledView.providerRequestId).toBe(
      imageProvider === "OPENAI" ? OPENAI_REQUEST_ID : undefined,
    );
    const animationView = detail.artifacts.find(
      (artifact) => artifact.kind === "SILENT_ANIMATION",
    )!;
    expect(animationView.providerRequestId).toBe(
      animationProvider === "RUNWAY" ? RUNWAY_TASK_ID : undefined,
    );
    const styleStage = detail.stages.find(
      (stage) => stage.name === "STYLE_IMAGE",
    )!;
    expect(styleStage.providerRequestId).toBe(
      imageProvider === "OPENAI" ? OPENAI_REQUEST_ID : undefined,
    );
    const animateStage = detail.stages.find(
      (stage) => stage.name === "ANIMATE_IMAGE",
    )!;
    expect(animateStage.providerRequestId).toBe(
      animationProvider === "RUNWAY" ? RUNWAY_TASK_ID : undefined,
    );
  }

  it(
    "completes MOCK/MOCK end to end with mock attribution",
    { timeout: 120_000 },
    async () => {
      const harness = createHarness();
      const id = await seedAndQueue(harness, "MOCK", "MOCK");

      await runUntil(harness, id, "COMPLETE");

      expectAttribution(harness, id, "MOCK", "MOCK");
    },
  );

  it(
    "completes OPENAI/MOCK end to end through the live image adapter",
    { timeout: 120_000 },
    async () => {
      useLiveProviderEnv();
      const harness = createHarness();
      const id = await seedAndQueue(harness, "MOCK", "OPENAI");

      await runUntil(harness, id, "COMPLETE");

      expectAttribution(harness, id, "OPENAI", "MOCK");
    },
  );

  it(
    "completes MOCK/RUNWAY end to end through the Runway adapter",
    { timeout: 120_000 },
    async () => {
      useLiveProviderEnv();
      const harness = createHarness();
      const id = await seedAndQueue(harness, "RUNWAY", "MOCK");

      await runUntil(harness, id, "COMPLETE");

      expectAttribution(harness, id, "MOCK", "RUNWAY");
    },
  );

  it(
    "completes OPENAI/RUNWAY end to end through both live adapters",
    { timeout: 120_000 },
    async () => {
      useLiveProviderEnv();
      const harness = createHarness();
      const id = await seedAndQueue(harness, "RUNWAY", "OPENAI");

      await runUntil(harness, id, "COMPLETE");

      expectAttribution(harness, id, "OPENAI", "RUNWAY");
    },
  );

  it(
    "fails the STYLE_IMAGE stage cleanly when OPENAI is selected without credentials",
    { timeout: 60_000 },
    async () => {
      // The environment intentionally lacks OPENAI_* settings.
      const harness = createHarness();
      const id = await seedAndQueue(harness, "MOCK", "OPENAI");

      await runUntil(harness, id, "FAILED");

      const job = harness.database
        .select({
          status: productions.status,
          errorCode: productions.errorCode,
        })
        .from(productions)
        .where(eq(productions.id, id))
        .get()!;
      expect(job.status).toBe("FAILED");
      expect(job.errorCode).toBe("PROVIDER_REQUEST_FAILED");

      const styleStage = harness.database
        .select({
          name: productionStages.name,
          status: productionStages.status,
        })
        .from(productionStages)
        .where(eq(productionStages.productionId, id))
        .all()
        .find((stage) => stage.name === "STYLE_IMAGE")!;
      expect(styleStage.status).toBe("FAILED");

      // The mock executors never ran: no styled frame exists to recover.
      expect(
        artifactRows(harness, id).some((row) => row.kind === "STYLED_FRAME"),
      ).toBe(false);
    },
  );
});

describe("treatment prompt routing", () => {
  const treatment = {
    candidateId: candidateFixtures[0]!.id,
    humorMechanism: "Expectation subversion.",
    audienceReactionEvidence: [],
    recommendedSegment: { startSeconds: 0, endSeconds: 6 },
    setupTimestamp: 1.5,
    payoffTimestamp: 4.2,
    adaptationConcept: "Clay re-staging of the setup and payoff.",
    claymationPrompt: "TREATMENT CLAY PROMPT",
    motionPrompt: "TREATMENT MOTION PROMPT",
    socialCaption: "Caption.",
    confidence: 0.8,
    risks: [],
    evidenceGaps: [],
  };

  function seedTreatment(harness: ReturnType<typeof createHarness>): void {
    harness.database
      .insert(directorTreatments)
      .values({
        id: "treatment-routing",
        candidateId: candidateFixtures[0]!.id,
        provider: "MOCK",
        treatmentJson: JSON.stringify(treatment),
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
  }

  it(
    "passes the persisted treatment prompts to the STYLE_IMAGE and ANIMATE_IMAGE executor contexts",
    { timeout: 120_000 },
    async () => {
      const harness = createHarness();
      const id = await seedAndQueue(harness, "RUNWAY", "OPENAI");
      seedTreatment(harness);

      const defaults = createDefaultStageExecutors();
      const styleContexts: {
        claymationPrompt: string | null | undefined;
        motionPrompt: string | null | undefined;
      }[] = [];
      const animateContexts: {
        claymationPrompt: string | null | undefined;
        motionPrompt: string | null | undefined;
      }[] = [];
      harness.executors = {
        STYLE_IMAGE: async (context) => {
          styleContexts.push({
            claymationPrompt: context.claymationPrompt,
            motionPrompt: context.motionPrompt,
          });
          return defaults.STYLE_IMAGE(context);
        },
        ANIMATE_IMAGE: async (context) => {
          animateContexts.push({
            claymationPrompt: context.claymationPrompt,
            motionPrompt: context.motionPrompt,
          });
          return defaults.ANIMATE_IMAGE(context);
        },
      };

      await runUntil(harness, id, "COMPLETE");

      expect(styleContexts).toHaveLength(1);
      expect(styleContexts[0]).toEqual({
        claymationPrompt: "TREATMENT CLAY PROMPT",
        motionPrompt: "TREATMENT MOTION PROMPT",
      });
      expect(animateContexts).toHaveLength(1);
      expect(animateContexts[0]).toEqual({
        claymationPrompt: "TREATMENT CLAY PROMPT",
        motionPrompt: "TREATMENT MOTION PROMPT",
      });
    },
  );

  it(
    "leaves treatment prompts null when the candidate has no persisted treatment",
    { timeout: 120_000 },
    async () => {
      const harness = createHarness();
      const id = await seedAndQueue(harness);

      const defaults = createDefaultStageExecutors();
      const contexts: {
        claymationPrompt: string | null | undefined;
        motionPrompt: string | null | undefined;
      }[] = [];
      harness.executors = {
        STYLE_IMAGE: async (context) => {
          contexts.push({
            claymationPrompt: context.claymationPrompt,
            motionPrompt: context.motionPrompt,
          });
          return defaults.STYLE_IMAGE(context);
        },
      };

      await runUntil(harness, id, "COMPLETE");

      expect(contexts).toHaveLength(1);
      expect(contexts[0]).toEqual({
        claymationPrompt: null,
        motionPrompt: null,
      });
    },
  );
});
