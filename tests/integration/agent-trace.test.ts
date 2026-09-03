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
import {
  listAgentRunsByCandidate,
  listAgentRunsByProduction,
} from "../../src/server/agents/trace";
import { createCandidateRepository } from "../../src/server/candidates/repository";
import { openDatabase } from "../../src/server/db/client";
import * as schema from "../../src/server/db/schema";
import { productionStages, productions } from "../../src/server/db/schema";
import {
  getArtifactRecordId,
  WorkerStageError,
  type PipelineStageName,
  type StageExecutor,
} from "../../src/server/productions/pipeline";
import { createProductionRepository } from "../../src/server/productions/repository";
import { createProductionWorkerRepository } from "../../src/server/productions/worker-repository";
import { runWorkerTick } from "../../src/worker/runner";

const execFileAsync = promisify(execFile);

const SEGMENT = { startSeconds: 0, endSeconds: 6, durationSeconds: 6 };
const NOW = new Date("2026-09-03T12:03:00.000Z");
const WORKER_ID = "worker-test";
const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "drizzle");

let fixtureBytes: Uint8Array;

beforeAll(async () => {
  // A 6.3-second 320x240 test source with a 440 Hz tone: long enough to cover
  // the 6-second segment and carrying a real audio track.
  const fixtureDirectory = await mkdtemp(
    path.join(tmpdir(), "yardtoonz-trace-src-"),
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
  migrate(database, { migrationsFolder: MIGRATIONS_FOLDER });

  const artifactRoot = mkdtempSync(path.join(tmpdir(), "yardtoonz-trace-art-"));
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

async function seedAndQueue(harness: Harness): Promise<string> {
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

function stageRowOf(harness: Harness, id: string, name: string) {
  const row = harness.database
    .select()
    .from(productionStages)
    .where(eq(productionStages.productionId, id))
    .all()
    .find((stage) => stage.name === name);
  if (!row) throw new Error(`Expected a ${name} stage row`);
  return row;
}

function runOf(
  runs: ReturnType<typeof listAgentRunsByCandidate>,
  agentKey: string,
) {
  const run = runs.find((candidate) => candidate.agentKey === agentKey);
  if (!run) throw new Error(`Expected a ${agentKey} trace row`);
  return run;
}

describe("agent trace persistence", () => {
  it("keeps trace rows readable across a fresh connection to the same database file", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "yardtoonz-trace-reopen-"),
    );
    const databaseUrl = `file:${path.join(directory, "agent-trace.sqlite")}`;

    // First connection: seed intake and confirm the two analyst rows exist.
    const first = openDatabase(databaseUrl, {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
    openDatabases.push(first.sqlite);
    const candidateId = candidateFixtures[0]!.id;
    createCandidateRepository(first.database).seed(
      candidateFixtures,
      "2026-09-03T12:00:00.000Z",
    );
    const before = listAgentRunsByCandidate(first.database, candidateId);
    expect(before.map((run) => run.agentKey)).toEqual([
      "trend-scout",
      "humor-analyst",
    ]);
    first.sqlite.close();

    // Fresh file-backed connection — the deleted-inode lesson: a brand-new
    // connection to the same path must still see every persisted row.
    const second = openDatabase(databaseUrl, {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
    openDatabases.push(second.sqlite);
    const after = listAgentRunsByCandidate(second.database, candidateId);
    expect(after.map((run) => run.agentKey)).toEqual([
      "trend-scout",
      "humor-analyst",
    ]);
    expect(after[0]!.id).toBe(before[0]!.id);
    expect(after[0]!.decision).toBe(before[0]!.decision);
    expect(after[0]!.inputEvidence.platform).toBe(
      before[0]!.inputEvidence.platform,
    );
    expect(after[1]!.inputEvidence.commentCount).toBe(
      before[1]!.inputEvidence.commentCount,
    );

    await rm(directory, { recursive: true, force: true });
  });
});

describe("agent trace transitions", () => {
  it("records complete pipeline runs with measured elapsed, provider, model, and artifact ids", async () => {
    const harness = createHarness();
    const id = await seedAndQueue(harness);
    await runUntil(harness, id, "COMPLETE");

    const candidateId = candidateFixtures[0]!.id;
    const runs = listAgentRunsByCandidate(harness.database, candidateId);
    expect(runs.map((run) => run.agentKey)).toEqual([
      "trend-scout",
      "humor-analyst",
      "clay-artist",
      "animator",
      "qa-inspector",
    ]);

    // Clay Artist: the style stage's own wall time, provider selection, and
    // exactly the artifact the stage persisted.
    const styledStage = stageRowOf(harness, id, "STYLE_IMAGE");
    const clay = runOf(runs, "clay-artist");
    expect(clay.state).toBe("COMPLETE");
    expect(clay.attempt).toBe(1);
    expect(clay.provider).toBe("MOCK");
    expect(clay.model).toBe("mock-style-v1");
    expect(clay.candidateId).toBe(candidateId);
    expect(clay.productionId).toBe(id);
    expect(clay.inputEvidence.fingerprint).toBe(styledStage.inputFingerprint);
    expect(clay.decision).toBe(
      "Styled the keyframe with the MOCK image provider.",
    );
    expect(clay.confidence).toBeUndefined();
    expect(styledStage.startedAt).not.toBeNull();
    expect(styledStage.completedAt).not.toBeNull();
    expect(clay.elapsedMs).toBe(
      styledStage.completedAt!.getTime() - styledStage.startedAt!.getTime(),
    );
    expect(clay.artifactIds).toEqual([getArtifactRecordId(id, "STYLED_FRAME")]);

    // Animator: motion model label from the deterministic mock metadata.
    const animator = runOf(runs, "animator");
    expect(animator.state).toBe("COMPLETE");
    expect(animator.provider).toBe("MOCK");
    expect(animator.model).toBe("mock-zoompan-v1");
    expect(animator.artifactIds).toEqual([
      getArtifactRecordId(id, "SILENT_ANIMATION"),
    ]);

    // QA Inspector: deterministic check, certain pass, no provider claimed,
    // validation scalars quoted from the persisted report.
    const qa = runOf(runs, "qa-inspector");
    expect(qa.state).toBe("COMPLETE");
    expect(qa.provider).toBeUndefined();
    expect(qa.model).toBeUndefined();
    expect(qa.confidence).toBe(1);
    expect(qa.artifactIds).toEqual([]);
    expect(qa.inputEvidence.playable).toBe(true);
    expect(qa.inputEvidence.audioPresent).toBe(true);
    expect(typeof qa.inputEvidence.width).toBe("number");
    expect(qa.decision).toContain("9:16");

    // The production-scoped view carries only the pipeline agents, in order.
    const productionRuns = listAgentRunsByProduction(harness.database, id);
    expect(productionRuns.map((run) => run.agentKey)).toEqual([
      "clay-artist",
      "animator",
      "qa-inspector",
    ]);
    expect(productionRuns.every((run) => run.candidateId === candidateId)).toBe(
      true,
    );
  });

  it("records the failed transition with the bounded safe message and no artifacts", async () => {
    const harness = createHarness();
    harness.executors = {
      STYLE_IMAGE: async () => {
        throw new WorkerStageError("MEDIA_PROCESSING_FAILED", "boom");
      },
    };
    const id = await seedAndQueue(harness);
    await runUntil(harness, id, "FAILED");

    const runs = listAgentRunsByCandidate(
      harness.database,
      candidateFixtures[0]!.id,
    );
    const clay = runOf(runs, "clay-artist");
    expect(clay.state).toBe("FAILED");
    expect(clay.decision).toBe(
      "A media processing step failed for this stage.",
    );
    expect(clay.inputEvidence.errorCode).toBe("MEDIA_PROCESSING_FAILED");
    expect(clay.artifactIds).toEqual([]);
    expect(clay.elapsedMs).toBeGreaterThanOrEqual(0);
    // The animator never ran, so it never produced a trace row.
    expect(runs.some((run) => run.agentKey === "animator")).toBe(false);
  });
});
