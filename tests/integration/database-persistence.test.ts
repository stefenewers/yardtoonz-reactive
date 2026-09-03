import Database from "better-sqlite3";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { candidateFixtures } from "../../fixtures/candidates";
import { createCandidateRepository } from "../../src/server/candidates/repository";
import {
  openDatabase,
  resolveSqliteFilename,
  type DatabaseConnection,
} from "../../src/server/db/client";
import { resetDemoData } from "../../src/server/db/reset";

const migrationsFolder = path.resolve(process.cwd(), "drizzle");
const temporaryDirectories: string[] = [];
const openConnections: DatabaseConnection[] = [];

interface TableNameRow {
  name: string;
}

interface CountRow {
  count: number;
}

afterEach(async () => {
  for (const connection of openConnections.splice(0)) {
    if (connection.sqlite.open) connection.sqlite.close();
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "yardtoonz-db-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function openFreshDatabase(): Promise<DatabaseConnection> {
  const workingDirectory = await createTemporaryDirectory();
  const connection = openDatabase("file:./state/yardtoonz.db", {
    migrationsFolder,
    workingDirectory,
  });
  openConnections.push(connection);
  return connection;
}

function seedApprovedCandidate(connection: DatabaseConnection): {
  candidateId: string;
  rightsConfirmationId: string;
} {
  const repository = createCandidateRepository(connection.database);
  const candidateId = candidateFixtures[0]!.id;
  repository.seed(candidateFixtures, "2026-09-03T12:00:00.000Z");
  repository.approve(candidateId, "2026-09-03T12:01:00.000Z");
  repository.confirmRights({
    candidateId,
    confirmedAt: "2026-09-03T12:02:00.000Z",
    confirmationTextVersion: "rights-v1",
  });
  const rights = connection.sqlite
    .prepare("SELECT id FROM rights_confirmations WHERE candidate_id = ?")
    .get(candidateId) as { id: string };
  return { candidateId, rightsConfirmationId: rights.id };
}

function insertProduction(
  sqlite: Database.Database,
  input: {
    candidateId: string;
    id: string;
    rightsConfirmationId: string;
  },
): void {
  sqlite
    .prepare(
      `INSERT INTO productions (
        id, candidate_id, rights_confirmation_id, status,
        image_provider, animation_provider,
        segment_start_ms, segment_end_ms, segment_duration_ms,
        attempt, created_at, updated_at
      ) VALUES (?, ?, ?, 'RIGHTS_CONFIRMED', 'MOCK', 'MOCK', 0, 6000, 6000, 1, ?, ?)`,
    )
    .run(
      input.id,
      input.candidateId,
      input.rightsConfirmationId,
      Date.parse("2026-09-03T12:03:00.000Z"),
      Date.parse("2026-09-03T12:03:00.000Z"),
    );
}

async function createLegacyMigrationFolder(): Promise<string> {
  const directory = await createTemporaryDirectory();
  const legacyFolder = path.join(directory, "drizzle");
  await mkdir(path.join(legacyFolder, "meta"), { recursive: true });
  await copyFile(
    path.join(migrationsFolder, "0000_wet_archangel.sql"),
    path.join(legacyFolder, "0000_wet_archangel.sql"),
  );
  const journal = JSON.parse(
    await readFile(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as { entries: unknown[]; version: string; dialect: string };
  await writeFile(
    path.join(legacyFolder, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }),
  );
  return legacyFolder;
}

describe("SQLite persistence", () => {
  it("creates every required table on a fresh database with durable pragmas", async () => {
    const connection = await openFreshDatabase();
    const tables = connection.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name",
      )
      .all() as TableNameRow[];

    expect(tables.map(({ name }) => name)).toEqual([
      "artifacts",
      "candidate_comments",
      "candidates",
      "director_treatments",
      "editorial_decisions",
      "feed_runs",
      "production_stages",
      "productions",
      "rights_confirmations",
      "storyboards",
      "worker_heartbeats",
    ]);
    expect(connection.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(connection.sqlite.pragma("busy_timeout", { simple: true })).toBe(
      5000,
    );
    expect(connection.sqlite.pragma("journal_mode", { simple: true })).toBe(
      "wal",
    );
  });

  it("upgrades the candidate migration without losing editorial decisions", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const legacyMigrations = await createLegacyMigrationFolder();
    const databaseUrl = "file:./state/yardtoonz.db";
    const legacyConnection = openDatabase(databaseUrl, {
      migrationsFolder: legacyMigrations,
      workingDirectory,
    });
    legacyConnection.sqlite
      .prepare(
        `INSERT INTO candidates (
          id, platform, source_label, caption, observed_at, metrics_json,
          fit_checklist_json, scores_json, status, created_at, updated_at
        ) VALUES ('legacy-candidate', 'OTHER', 'Legacy candidate', 'Legacy caption',
          '2026-09-03T12:00:00.000Z', '{}', '{}', '{}', 'APPROVED',
          '2026-09-03T12:00:00.000Z', '2026-09-03T12:01:00.000Z')`,
      )
      .run();
    legacyConnection.sqlite
      .prepare(
        `INSERT INTO editorial_decisions (
          id, candidate_id, decision, decided_at
        ) VALUES ('legacy-decision', 'legacy-candidate', 'APPROVED',
          '2026-09-03T12:01:00.000Z')`,
      )
      .run();
    legacyConnection.sqlite.close();

    const upgraded = openDatabase(databaseUrl, {
      migrationsFolder,
      workingDirectory,
    });
    openConnections.push(upgraded);
    const decision = upgraded.sqlite
      .prepare(
        "SELECT subject, production_id AS productionId, decision FROM editorial_decisions",
      )
      .get() as {
      subject: string;
      productionId: string | null;
      decision: string;
    };
    expect(decision).toEqual({
      subject: "CANDIDATE",
      productionId: null,
      decision: "APPROVED",
    });
  });

  it("rejects orphaned or cross-production stage and artifact records", async () => {
    const connection = await openFreshDatabase();
    const { candidateId, rightsConfirmationId } =
      seedApprovedCandidate(connection);
    insertProduction(connection.sqlite, {
      id: "production-1",
      candidateId,
      rightsConfirmationId,
    });
    insertProduction(connection.sqlite, {
      id: "production-2",
      candidateId,
      rightsConfirmationId,
    });

    expect(() =>
      connection.sqlite
        .prepare(
          "INSERT INTO production_stages (id, production_id, name, created_at, updated_at) VALUES ('stage-orphan', 'missing', 'INGEST_SOURCE', 1, 1)",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);

    connection.sqlite
      .prepare(
        "INSERT INTO production_stages (id, production_id, name, created_at, updated_at) VALUES ('stage-1', 'production-1', 'INGEST_SOURCE', 1, 1)",
      )
      .run();

    expect(() =>
      connection.sqlite
        .prepare(
          `INSERT INTO artifacts (
            id, production_id, production_stage_id, kind, storage_key,
            mime_type, byte_size, sha256, parent_artifact_ids_json,
            provider, metadata_json, created_at
          ) VALUES ('artifact-crossed', 'production-2', 'stage-1', 'SOURCE_VIDEO',
            'production-2/source.mp4', 'video/mp4', 10, 'sha', '[]',
            'USER_UPLOAD', '{}', 1)`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);

    connection.sqlite
      .prepare(
        `INSERT INTO artifacts (
          id, production_id, production_stage_id, kind, storage_key,
          mime_type, byte_size, sha256, parent_artifact_ids_json,
          provider, metadata_json, created_at
        ) VALUES ('artifact-1', 'production-1', 'stage-1', 'SOURCE_VIDEO',
          'production-1/source.mp4', 'video/mp4', 10, 'sha', '[]',
          'USER_UPLOAD', '{}', 1)`,
      )
      .run();
    connection.sqlite
      .prepare("DELETE FROM productions WHERE id = 'production-1'")
      .run();

    const remainingStages = connection.sqlite
      .prepare("SELECT COUNT(*) AS count FROM production_stages")
      .get() as CountRow;
    const remainingArtifacts = connection.sqlite
      .prepare("SELECT COUNT(*) AS count FROM artifacts")
      .get() as CountRow;
    expect(remainingStages.count).toBe(0);
    expect(remainingArtifacts.count).toBe(0);
  });

  it("enforces rights, segment, attempt, and decision-target invariants", async () => {
    const connection = await openFreshDatabase();
    const { candidateId, rightsConfirmationId } =
      seedApprovedCandidate(connection);

    connection.sqlite
      .prepare(
        `INSERT INTO productions (
          id, candidate_id, status, image_provider, animation_provider,
          segment_start_ms, segment_end_ms, segment_duration_ms,
          attempt, created_at, updated_at
        ) VALUES ('draft-without-rights', ?, 'DRAFT', 'MOCK', 'MOCK',
          0, 6000, 6000, 1, 1, 1)`,
      )
      .run(candidateId);
    expect(() =>
      connection.sqlite
        .prepare(
          `INSERT INTO productions (
            id, candidate_id, status, image_provider, animation_provider,
            segment_start_ms, segment_end_ms, segment_duration_ms,
            attempt, created_at, updated_at
          ) VALUES ('queued-without-rights', ?, 'QUEUED', 'MOCK', 'MOCK',
            0, 6000, 6000, 1, 1, 1)`,
        )
        .run(candidateId),
    ).toThrow(/productions_rights_gate/);

    const repository = createCandidateRepository(connection.database);
    const otherCandidateId = candidateFixtures[1]!.id;
    repository.approve(otherCandidateId, "2026-09-03T12:05:00.000Z");
    repository.confirmRights({
      candidateId: otherCandidateId,
      confirmedAt: "2026-09-03T12:06:00.000Z",
      confirmationTextVersion: "rights-v1",
    });
    const otherRights = connection.sqlite
      .prepare("SELECT id FROM rights_confirmations WHERE candidate_id = ?")
      .get(otherCandidateId) as { id: string };
    expect(() =>
      insertProduction(connection.sqlite, {
        id: "production-crossed-rights",
        candidateId,
        rightsConfirmationId: otherRights.id,
      }),
    ).toThrow(/FOREIGN KEY/);

    expect(() =>
      connection.sqlite
        .prepare(
          `INSERT INTO productions (
            id, candidate_id, rights_confirmation_id, image_provider,
            animation_provider, segment_start_ms, segment_end_ms,
            segment_duration_ms, attempt, created_at, updated_at
          ) VALUES ('invalid-segment', ?, ?, 'MOCK', 'MOCK', 0, 4000, 4000, 1, 1, 1)`,
        )
        .run(candidateId, rightsConfirmationId),
    ).toThrow(/productions_segment_bounds/);

    insertProduction(connection.sqlite, {
      id: "production-1",
      candidateId,
      rightsConfirmationId,
    });
    expect(() =>
      connection.sqlite
        .prepare(
          "INSERT INTO editorial_decisions (id, candidate_id, subject, decision, decided_at) VALUES ('output-without-production', ?, 'OUTPUT', 'APPROVED', ?)",
        )
        .run(candidateId, "2026-09-03T12:04:00.000Z"),
    ).toThrow(/editorial_decisions_subject_target/);
  });

  it("resets only configured local demo data and deterministically reseeds", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const artifactRoot = path.join(workingDirectory, ".data/artifacts");
    await mkdir(artifactRoot, { recursive: true });
    await writeFile(path.join(artifactRoot, "stale.txt"), "stale");

    const result = await resetDemoData(
      {
        DATABASE_URL: "file:./.data/yardtoonz.db",
        ARTIFACT_ROOT: "./.data/artifacts",
      },
      {
        migrationsFolder,
        now: "2026-09-03T12:00:00.000Z",
        workingDirectory,
      },
    );

    expect(result.seededCandidates).toBe(10);
    await expect(
      readFile(path.join(artifactRoot, "stale.txt")),
    ).rejects.toThrow();
    const sqlite = new Database(result.databaseFile, { readonly: true });
    const candidates = sqlite
      .prepare("SELECT COUNT(*) AS count FROM candidates")
      .get() as CountRow;
    sqlite.close();
    expect(candidates.count).toBe(10);
  });
});

describe("SQLite database URL validation", () => {
  it("resolves encoded local paths and rejects unsafe URL forms", () => {
    expect(
      resolveSqliteFilename("file:./data%20files/app.db", "/workspace"),
    ).toBe(path.resolve("/workspace/data files/app.db"));
    expect(() => resolveSqliteFilename("postgres://database")).toThrow(
      /file: scheme/,
    );
    expect(() => resolveSqliteFilename("file://remote/database.db")).toThrow(
      /local SQLite file/,
    );
    expect(() => resolveSqliteFilename("file:./app.db?mode=ro")).toThrow(
      /local SQLite file/,
    );
  });
});
