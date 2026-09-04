import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { candidateFixtures } from "../../fixtures/candidates";
import {
  createLocalArtifactStore,
  generateArtifactStorageKey,
  type ArtifactStore,
} from "../../src/lib/artifact-store";
import { mediaToolPaths } from "../../src/lib/media-tools";
import { createCandidateRepository } from "../../src/server/candidates/repository";
import { openDatabase } from "../../src/server/db/client";
import * as schema from "../../src/server/db/schema";
import { orchestrationRuns, productions } from "../../src/server/db/schema";
import { createDirectorTreatmentRepository } from "../../src/server/director/repository";
import { createDirectorTreatmentService } from "../../src/server/director/service";
import {
  WorkerStageError,
  type PipelineStageName,
  type StageExecutor,
} from "../../src/server/productions/pipeline";
import { createProductionRepository } from "../../src/server/productions/repository";
import { createProductionWorkerRepository } from "../../src/server/productions/worker-repository";
import { createOrchestrationRunRepository } from "../../src/server/orchestration/repository";
import { createOrchestrationService } from "../../src/server/orchestration/service";
import { runWorkerTick } from "../../src/worker/runner";

const execFileAsync = promisify(execFile);

const SEGMENT = { startSeconds: 0, endSeconds: 6, durationSeconds: 6 };
const NOW = new Date("2026-09-03T12:03:00.000Z");
const WORKER_ID = "worker-test";
const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "drizzle");

let fixtureBytes: Uint8Array;

beforeAll(async () => {
  const fixtureDirectory = await mkdtemp(
    path.join(tmpdir(), "yardtoonz-orch-src-"),
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
  service: ReturnType<typeof createOrchestrationService>;
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
  migrate(database, { migrationsFolder: MIGRATIONS_FOLDER });

  const artifactRoot = mkdtempSync(path.join(tmpdir(), "yardtoonz-orch-art-"));
  artifactRoots.push(artifactRoot);
  const store = createLocalArtifactStore({ rootDirectory: artifactRoot });

  // The clock advances one minute per call so successive runs (and their
  // timestamps) stay distinct without ordering ties.
  let tick = 0;
  return {
    database,
    store,
    candidates: createCandidateRepository(database),
    productions: createProductionRepository(database),
    worker: createProductionWorkerRepository(database, store),
    service: createOrchestrationService({
      database,
      now: () => {
        tick += 1;
        return new Date(Date.UTC(2026, 8, 3, 12, 30 + tick, 0, 0));
      },
    }),
  };
}

async function seedCandidate(harness: Harness, index = 0): Promise<string> {
  harness.candidates.seed(candidateFixtures, "2026-09-03T12:00:00.000Z");
  const candidateId = candidateFixtures[index]!.id;
  harness.candidates.approve(candidateId, "2026-09-03T12:01:00.000Z");
  harness.candidates.confirmRights({
    candidateId,
    confirmedAt: "2026-09-03T12:02:00.000Z",
    confirmationTextVersion: "rights-v1",
  });
  return candidateId;
}

/** The Director row: created through the real service against this database. */
async function createTreatment(
  harness: Harness,
  candidateId: string,
): Promise<void> {
  const director = createDirectorTreatmentService({
    candidateRepository: harness.candidates,
    treatmentRepository: createDirectorTreatmentRepository(harness.database),
    database: harness.database,
    selection: "MOCK",
  });
  await director.create({ candidateId });
}

async function createQueuedProduction(
  harness: Harness,
  candidateId: string,
): Promise<string> {
  const id = harness.productions.createDraft({
    candidateId,
    segment: SEGMENT,
    imageProvider: "MOCK",
    animationProvider: "MOCK",
    now: NOW,
  });
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

describe("orchestration persistence", () => {
  it("starts idempotently and derives the run from persisted state", async () => {
    const harness = createHarness();
    const candidateId = await seedCandidate(harness);

    const first = harness.service.start(candidateId);
    if (first === "CANDIDATE_NOT_FOUND") throw new Error("Expected a run");
    expect(first.created).toBe(true);
    expect(first.run.status).toBe("RUNNING");
    expect(first.run.currentStepKey).toBe("yardtoonz-director");
    expect(first.timeline.completedCount).toBe(2);
    expect(first.timeline.steps.map((step) => step.state)).toEqual([
      "COMPLETE",
      "COMPLETE",
      "READY",
      "BLOCKED",
      "BLOCKED",
      "BLOCKED",
    ]);

    // Idempotency at the persistence layer: no duplicate row.
    const second = harness.service.start(candidateId);
    if (second === "CANDIDATE_NOT_FOUND") throw new Error("Expected a run");
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);
    expect(harness.service.listForCandidate(candidateId)).toHaveLength(1);
  });

  it("synchronizes a running run as real subsystems complete their work", async () => {
    const harness = createHarness();
    const candidateId = await seedCandidate(harness);
    const started = harness.service.start(candidateId);
    if (started === "CANDIDATE_NOT_FOUND") throw new Error("Expected a run");
    const runId = started.run.id;

    await createTreatment(harness, candidateId);
    const afterDirector = harness.service.sync(runId);
    if (afterDirector === "RUN_NOT_FOUND") throw new Error("Expected a run");
    expect(afterDirector.run.currentStepKey).toBe("clay-artist");
    expect(afterDirector.timeline.completedCount).toBe(3);
    // The clay artist receives the treatment brief produced by the Director.
    expect(afterDirector.timeline.steps[3]!.handoffIn?.kind).toBe(
      "TREATMENT_BRIEF",
    );

    const productionId = await createQueuedProduction(harness, candidateId);
    await runUntil(harness, productionId, "COMPLETE");

    const finished = harness.service.sync(runId);
    if (finished === "RUN_NOT_FOUND") throw new Error("Expected a run");
    expect(finished.run.status).toBe("COMPLETE");
    expect(finished.run.completedAt).not.toBeNull();
    expect(finished.run.currentStepKey).toBeNull();
    expect(finished.timeline.completedCount).toBe(6);
    expect(finished.timeline.complete).toBe(true);

    // Sync after terminal completion is a no-op, not a re-entry.
    const again = harness.service.sync(runId);
    if (again === "RUN_NOT_FOUND") throw new Error("Expected a run");
    expect(again.run.status).toBe("COMPLETE");
  });

  it("keeps a failed run sticky and resumes it only after recovery", async () => {
    const harness = createHarness();
    harness.executors = {
      STYLE_IMAGE: () =>
        Promise.reject(
          new WorkerStageError(
            "MEDIA_PROCESSING_FAILED",
            "synthetic style failure",
          ),
        ),
    };
    const candidateId = await seedCandidate(harness);
    await createTreatment(harness, candidateId);
    const started = harness.service.start(candidateId);
    if (started === "CANDIDATE_NOT_FOUND") throw new Error("Expected a run");
    const runId = started.run.id;

    const productionId = await createQueuedProduction(harness, candidateId);
    await runUntil(harness, productionId, "FAILED");

    const failed = harness.service.sync(runId);
    if (failed === "RUN_NOT_FOUND") throw new Error("Expected a run");
    expect(failed.run.status).toBe("FAILED");
    expect(failed.run.currentStepKey).toBe("clay-artist");
    expect(failed.run.errorCode).toBe("MEDIA_PROCESSING_FAILED");
    expect(failed.timeline.failedStepKey).toBe("clay-artist");

    // Resume before anything recovered: the failure stays sticky.
    const resumedEarly = harness.service.resume(runId);
    if (
      resumedEarly === "RUN_NOT_FOUND" ||
      resumedEarly === "RESUME_NOT_ALLOWED"
    ) {
      throw new Error("Expected a resumable run");
    }
    expect(resumedEarly.run.status).toBe("FAILED");
    expect(resumedEarly.run.currentStepKey).toBe("clay-artist");

    // The human retries the failed stage; the pipeline completes.
    await harness.worker.retryFailedStage(productionId, NOW);
    delete harness.executors.STYLE_IMAGE;
    await runUntil(harness, productionId, "COMPLETE");

    const recovered = harness.service.resume(runId);
    if (recovered === "RUN_NOT_FOUND" || recovered === "RESUME_NOT_ALLOWED") {
      throw new Error("Expected a resumable run");
    }
    expect(recovered.run.status).toBe("COMPLETE");
    expect(recovered.run.currentStepKey).toBeNull();
    expect(recovered.run.completedAt).not.toBeNull();
    expect(recovered.timeline.completedCount).toBe(6);
  });

  it("cancels only active runs and never resurrects them", async () => {
    const harness = createHarness();
    const candidateId = await seedCandidate(harness);
    const started = harness.service.start(candidateId);
    if (started === "CANDIDATE_NOT_FOUND") throw new Error("Expected a run");
    const runId = started.run.id;

    const cancelled = harness.service.cancel(
      runId,
      "Operator stopped the demo.",
    );
    if (cancelled === "RUN_NOT_FOUND" || cancelled === "CANCEL_NOT_ALLOWED") {
      throw new Error("Expected a cancellable run");
    }
    expect(cancelled.run.status).toBe("CANCELLED");
    expect(cancelled.run.completedAt).not.toBeNull();

    const second = harness.service.cancel(runId, "again");
    expect(second).toBe("CANCEL_NOT_ALLOWED");

    const resumed = harness.service.resume(runId);
    expect(resumed).toBe("RESUME_NOT_ALLOWED");

    // Subsequent sync leaves a cancelled run alone.
    const afterSync = harness.service.sync(runId);
    if (afterSync === "RUN_NOT_FOUND") throw new Error("Expected a run");
    expect(afterSync.run.status).toBe("CANCELLED");
  });

  it("rejects run operations for unknown candidates and runs", () => {
    const harness = createHarness();
    expect(harness.service.start("cand_missing")).toBe("CANDIDATE_NOT_FOUND");
    expect(harness.service.get("orch_missing")).toBe("RUN_NOT_FOUND");
    expect(harness.service.resume("orch_missing")).toBe("RUN_NOT_FOUND");
    expect(harness.service.cancel("orch_missing", "x")).toBe("RUN_NOT_FOUND");
  });

  it("lists a candidate's run history newest first", async () => {
    const harness = createHarness();
    const candidateId = await seedCandidate(harness);
    const started = harness.service.start(candidateId);
    if (started === "CANDIDATE_NOT_FOUND") throw new Error("Expected a run");

    const cancelled = harness.service.cancel(started.run.id, "reset");
    if (cancelled === "RUN_NOT_FOUND" || cancelled === "CANCEL_NOT_ALLOWED") {
      throw new Error("Expected a cancellable run");
    }

    // A completed run no longer blocks a fresh start.
    const restarted = harness.service.start(candidateId);
    if (restarted === "CANDIDATE_NOT_FOUND") throw new Error("Expected a run");
    expect(restarted.created).toBe(true);
    expect(restarted.run.id).not.toBe(started.run.id);

    const history = harness.service.listForCandidate(candidateId);
    expect(history).toHaveLength(2);
    expect(history[0]!.id).toBe(restarted.run.id);
    expect(history[1]!.id).toBe(started.run.id);
  });

  it("keeps run rows readable across a fresh connection to the same database file", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "yardtoonz-orch-reopen-"),
    );
    const databaseUrl = `file:${path.join(directory, "orchestration.sqlite")}`;

    const first = openDatabase(databaseUrl, {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
    openDatabases.push(first.sqlite);
    const candidates = createCandidateRepository(first.database);
    candidates.seed(candidateFixtures, "2026-09-03T12:00:00.000Z");
    const candidateId = candidateFixtures[0]!.id;
    candidates.approve(candidateId, "2026-09-03T12:01:00.000Z");
    candidates.confirmRights({
      candidateId,
      confirmedAt: "2026-09-03T12:02:00.000Z",
      confirmationTextVersion: "rights-v1",
    });
    const started = createOrchestrationService({
      database: first.database,
    }).start(candidateId);
    if (started === "CANDIDATE_NOT_FOUND") throw new Error("Expected a run");
    const runId = started.run.id;
    first.sqlite.close();

    // A brand-new connection to the same path must still see the row.
    const second = openDatabase(databaseUrl, {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
    openDatabases.push(second.sqlite);
    const service = createOrchestrationService({
      database: second.database,
    });
    const detail = service.get(runId);
    if (detail === "RUN_NOT_FOUND")
      throw new Error("Expected the run to persist");
    expect(detail.run.status).toBe("RUNNING");
    expect(detail.run.candidateId).toBe(candidateId);
    expect(detail.run.currentStepKey).toBe("yardtoonz-director");
    expect(detail.timeline.completedCount).toBe(2);

    await rm(directory, { recursive: true, force: true });
  });
});
