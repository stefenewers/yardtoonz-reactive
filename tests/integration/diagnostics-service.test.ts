import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildAttributionAudit } from "../../src/domain/diagnostics";
import { candidateFixtures } from "../../fixtures/candidates";
import { parseServerEnvironment } from "../../src/lib/env-schema";
import { createCandidateRepository } from "../../src/server/candidates/repository";
import * as schema from "../../src/server/db/schema";
import { createDiagnosticsService } from "../../src/server/diagnostics/service";
import { createProductionRepository } from "../../src/server/productions/repository";

const openDatabases: Database.Database[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
});

function createDatabase() {
  const sqlite = new Database(":memory:");
  openDatabases.push(sqlite);
  sqlite.pragma("foreign_keys = ON");
  const database = drizzle(sqlite, { schema });
  migrate(database, {
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });
  return database;
}

/** Live selection with every credential present; values are test dummies. */
const environment = parseServerEnvironment({
  IMAGE_PROVIDER: "OPENAI",
  ANIMATION_PROVIDER: "RUNWAY",
  DIRECTOR_PROVIDER: "OPENAI",
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_IMAGE_MODEL: "gpt-image-test",
  OPENAI_DIRECTOR_MODEL: "gpt-test",
  RUNWAY_API_KEY: "test-runway-key",
  RUNWAY_MODEL: "gen4-test",
});

const segment = {
  startSeconds: 1,
  endSeconds: 7,
  durationSeconds: 6,
};

const now = new Date("2026-09-03T12:03:00.000Z");
const sha = "a".repeat(64);

/**
 * Seeds one production (OPENAI image + RUNWAY animation) with an uploaded
 * source, one attributed OPENAI artifact, and one UNATTRIBUTED RUNWAY
 * artifact — the audit failure shape the surface exists to expose.
 */
function seedProduction(database: ReturnType<typeof createDatabase>): string {
  const candidates = createCandidateRepository(database);
  candidates.seed(candidateFixtures, "2026-09-03T12:00:00.000Z");
  const candidateId = candidateFixtures[0]!.id;
  candidates.approve(candidateId, "2026-09-03T12:01:00.000Z");
  candidates.confirmRights({
    candidateId,
    confirmedAt: "2026-09-03T12:02:00.000Z",
    confirmationTextVersion: "rights-v1",
  });

  const productions = createProductionRepository(database);
  const productionId = productions.createDraft({
    candidateId,
    segment,
    imageProvider: "OPENAI",
    animationProvider: "RUNWAY",
    now,
  });
  productions.recordSourceUpload(
    productionId,
    {
      storageKey: `tests/${productionId}/source.mp4`,
      mimeType: "video/mp4",
      byteSize: 2048,
      sha256: sha,
      metadata: { source: "integration-fixture" },
    },
    now,
  );

  // The worker would have armed the live stages before recording their
  // outputs; the artifacts table requires the stage rows to exist.
  database
    .insert(schema.productionStages)
    .values([
      {
        id: `${productionId}-STYLE_IMAGE`,
        productionId,
        name: "STYLE_IMAGE",
        status: "COMPLETE",
        attempt: 1,
        providerRequestId: "img_req_openai_1",
        startedAt: new Date("2026-09-03T12:03:30.000Z"),
        completedAt: new Date("2026-09-03T12:04:00.000Z"),
        createdAt: new Date("2026-09-03T12:03:00.000Z"),
        updatedAt: new Date("2026-09-03T12:04:00.000Z"),
      },
      {
        id: `${productionId}-ANIMATE_IMAGE`,
        productionId,
        name: "ANIMATE_IMAGE",
        status: "RUNNING",
        attempt: 1,
        startedAt: new Date("2026-09-03T12:04:30.000Z"),
        createdAt: new Date("2026-09-03T12:03:00.000Z"),
        updatedAt: new Date("2026-09-03T12:04:30.000Z"),
      },
    ])
    .run();

  // Live-provider writes: the worker records these with the provider's
  // request lineage; one omits it so the audit has a failure to show.
  database
    .insert(schema.artifacts)
    .values([
      {
        id: "art-attributed",
        productionId,
        productionStageId: `${productionId}-STYLE_IMAGE`,
        kind: "STYLED_FRAME",
        storageKey: `tests/${productionId}/styled.png`,
        mimeType: "image/png",
        byteSize: 1024,
        sha256: sha,
        parentArtifactIdsJson: JSON.stringify([]),
        provider: "OPENAI",
        providerRequestId: "img_req_openai_1",
        metadataJson: JSON.stringify({}),
        createdAt: new Date("2026-09-03T12:04:00.000Z"),
      },
      {
        id: "art-unattributed",
        productionId,
        productionStageId: `${productionId}-ANIMATE_IMAGE`,
        kind: "SILENT_ANIMATION",
        storageKey: `tests/${productionId}/animated.mp4`,
        mimeType: "video/mp4",
        byteSize: 4096,
        sha256: sha,
        parentArtifactIdsJson: JSON.stringify([]),
        provider: "RUNWAY",
        providerRequestId: null,
        metadataJson: JSON.stringify({}),
        createdAt: new Date("2026-09-03T12:05:00.000Z"),
      },
    ])
    .run();

  return productionId;
}

describe("diagnostics service over the persisted store", () => {
  it("aggregates environment credential presence without leaking values", () => {
    const database = createDatabase();
    const service = createDiagnosticsService(database, environment);

    const snapshot = service.getSnapshot();

    expect(snapshot.environment.credentials).toEqual({
      OPENAI_API_KEY: true,
      OPENAI_IMAGE_MODEL: true,
      OPENAI_DIRECTOR_MODEL: true,
      RUNWAY_API_KEY: true,
      RUNWAY_MODEL: true,
    });
    expect(JSON.stringify(snapshot)).not.toContain("test-openai-key");
    expect(JSON.stringify(snapshot)).not.toContain("test-runway-key");
  });

  it("lists persisted jobs newest first with stages and artifacts", () => {
    const database = createDatabase();
    const productionId = seedProduction(database);
    const service = createDiagnosticsService(database, environment);

    const snapshot = service.getSnapshot();

    expect(snapshot.jobs).toHaveLength(1);
    const job = snapshot.jobs[0]!;
    expect(job.id).toBe(productionId);
    expect(job.imageProvider).toBe("OPENAI");
    expect(job.animationProvider).toBe("RUNWAY");
    expect(job.stages.map((stage) => stage.name)).toContain("INGEST_SOURCE");
    expect(
      job.stages.find((stage) => stage.name === "INGEST_SOURCE")?.status,
    ).toBe("COMPLETE");
    // Chronological: the uploaded source, then the two provider writes.
    expect(job.artifacts.map((artifact) => artifact.id)).toEqual([
      `${productionId}-source`,
      "art-attributed",
      "art-unattributed",
    ]);
  });

  it("exposes the attribution audit failure for a live artifact without a request ID", () => {
    const database = createDatabase();
    seedProduction(database);
    const service = createDiagnosticsService(database, environment);
    const snapshot = service.getSnapshot();

    const audit = buildAttributionAudit(snapshot.jobs);

    expect(audit.totals).toEqual({
      artifacts: 3,
      liveAttributed: 1,
      local: 1,
      unattributedLive: 1,
    });
    expect(audit.complete).toBe(false);
    expect(
      audit.rows.find((row) => row.artifactId === "art-unattributed")
        ?.verdictLabel,
    ).toBe("Missing request ID");
    expect(
      audit.rows.find((row) => row.artifactId === "art-attributed")
        ?.providerRequestId,
    ).toBe("img_req_openai_1");
  });

  it("re-reads the store on every snapshot (polling persistence)", () => {
    const database = createDatabase();
    const service = createDiagnosticsService(database, environment);

    expect(service.getSnapshot().jobs).toHaveLength(0);
    seedProduction(database);
    expect(service.getSnapshot().jobs).toHaveLength(1);
  });
});
