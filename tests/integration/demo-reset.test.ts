import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { candidateFixtures } from "../../fixtures/candidates";
import { createCandidateRepository } from "../../src/server/candidates/repository";
import { openDatabase } from "../../src/server/db/client";
import { resetDemoData } from "../../src/server/db/reset";

const migrationsFolder = path.resolve(process.cwd(), "drizzle");
const fixedNow = "2026-09-03T12:00:00.000Z";
const demoEnvironment = {
  DATABASE_URL: "file:./.data/yardtoonz.db",
  ARTIFACT_ROOT: "./.data/artifacts",
} as const;

const temporaryDirectories: string[] = [];
const openConnections: Database.Database[] = [];

afterEach(async () => {
  for (const connection of openConnections.splice(0)) {
    if (connection.open) connection.close();
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createWorkingDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "yardtoonz-demo-reset-"));
  temporaryDirectories.push(directory);
  return directory;
}

function openReadonly(databaseFile: string): Database.Database {
  const sqlite = new Database(databaseFile, { readonly: true });
  openConnections.push(sqlite);
  return sqlite;
}

interface TableNameRow {
  name: string;
}

interface CountRow {
  count: number;
}

function userTables(sqlite: Database.Database): string[] {
  return (
    sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name",
      )
      .all() as TableNameRow[]
  ).map(({ name }) => name);
}

function tableCount(sqlite: Database.Database, table: string): number {
  return (
    sqlite.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as CountRow
  ).count;
}

// Deterministic full-state snapshot used to prove that a reset returns the
// database to exactly the seeded state, not merely a similar-looking one.
function canonicalDump(sqlite: Database.Database): string {
  return JSON.stringify(
    userTables(sqlite).map((name) => ({
      name,
      rows: sqlite.prepare(`SELECT * FROM "${name}" ORDER BY 1`).all(),
    })),
  );
}

function readPackageScripts(): Record<string, string> {
  const file = path.resolve(process.cwd(), "package.json");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as {
    scripts?: Record<string, string>;
  };
  return parsed.scripts ?? {};
}

describe("demo reset", () => {
  it("restores the exact seeded state after a mutated demo run", async () => {
    const workingDirectory = await createWorkingDirectory();
    const artifactRoot = path.join(workingDirectory, ".data/artifacts");

    const first = await resetDemoData(demoEnvironment, {
      migrationsFolder,
      now: fixedNow,
      workingDirectory,
    });
    const baseline = openReadonly(first.databaseFile);
    const seededDump = canonicalDump(baseline);
    baseline.close();

    // Drive a demo in flight through the same APIs the app uses.
    const mutated = openDatabase(demoEnvironment.DATABASE_URL, {
      migrationsFolder,
      workingDirectory,
    });
    openConnections.push(mutated.sqlite);
    const repository = createCandidateRepository(mutated.database);
    const candidateId = candidateFixtures[0]!.id;
    repository.approve(candidateId, "2026-09-03T13:00:00.000Z");
    repository.confirmRights({
      candidateId,
      confirmedAt: "2026-09-03T13:01:00.000Z",
      confirmationTextVersion: "rights-v1",
    });
    mutated.sqlite
      .prepare(
        `INSERT INTO productions (
          id, candidate_id, rights_confirmation_id, status,
          image_provider, animation_provider,
          segment_start_ms, segment_end_ms, segment_duration_ms,
          attempt, created_at, updated_at
        ) VALUES ('prod-demo', ?, (SELECT id FROM rights_confirmations
          WHERE candidate_id = ?), 'QUEUED', 'MOCK', 'MOCK',
          0, 6000, 6000, 1, ?, ?)`,
      )
      .run(
        candidateId,
        candidateId,
        Date.parse("2026-09-03T13:02:00.000Z"),
        Date.parse("2026-09-03T13:02:00.000Z"),
      );
    mutated.sqlite
      .prepare(
        `INSERT INTO production_stages (id, production_id, name, created_at, updated_at)
         VALUES ('stage-demo', 'prod-demo', 'INGEST_SOURCE', ?, ?)`,
      )
      .run(
        Date.parse("2026-09-03T13:03:00.000Z"),
        Date.parse("2026-09-03T13:03:00.000Z"),
      );
    mutated.sqlite
      .prepare(
        `INSERT INTO editorial_decisions (id, candidate_id, subject, decision, decided_at)
         VALUES ('decision-demo', ?, 'CANDIDATE', 'APPROVED', ?)`,
      )
      .run(candidateId, Date.parse("2026-09-03T13:00:00.000Z"));
    mutated.sqlite
      .prepare(
        "INSERT INTO worker_heartbeats (worker_id, observed_at) VALUES ('worker-demo', ?)",
      )
      .run(Date.parse("2026-09-03T13:04:00.000Z"));

    // Demo artifacts written under the artifact root must not survive either.
    await mkdir(path.join(artifactRoot, "productions/prod-demo"), {
      recursive: true,
    });
    await writeFile(
      path.join(artifactRoot, "productions/prod-demo/output.mp4"),
      "demo artifact bytes",
    );

    // Prove the mutations actually landed before resetting.
    expect(canonicalDump(mutated.sqlite)).not.toEqual(seededDump);

    const second = await resetDemoData(demoEnvironment, {
      migrationsFolder,
      now: fixedNow,
      workingDirectory,
    });

    expect(second.seededCandidates).toBe(candidateFixtures.length);
    const restored = openReadonly(second.databaseFile);
    expect(canonicalDump(restored)).toEqual(seededDump);
    expect(tableCount(restored, "candidates")).toBe(candidateFixtures.length);
    expect(tableCount(restored, "productions")).toBe(0);
    expect(tableCount(restored, "production_stages")).toBe(0);
    expect(tableCount(restored, "editorial_decisions")).toBe(0);
    expect(tableCount(restored, "worker_heartbeats")).toBe(0);
    expect(existsSync(path.join(artifactRoot, "productions"))).toBe(false);
  });

  it("is safe to run twice in a row and leaves the same clean state", async () => {
    const workingDirectory = await createWorkingDirectory();
    const artifactRoot = path.join(workingDirectory, ".data/artifacts");

    // The first run must work without a prior .data directory, matching the
    // fresh-checkout state the e2e global setup guarantees.
    expect(existsSync(path.join(workingDirectory, ".data"))).toBe(false);

    const first = await resetDemoData(demoEnvironment, {
      migrationsFolder,
      now: fixedNow,
      workingDirectory,
    });
    expect(first.seededCandidates).toBe(candidateFixtures.length);
    const afterFirst = openReadonly(first.databaseFile);
    const firstDump = canonicalDump(afterFirst);

    const second = await resetDemoData(demoEnvironment, {
      migrationsFolder,
      now: fixedNow,
      workingDirectory,
    });
    // The second run reseeds from scratch (fresh database, not a skipped seed).
    expect(second.seededCandidates).toBe(candidateFixtures.length);

    const afterSecond = openReadonly(second.databaseFile);
    expect(canonicalDump(afterSecond)).toEqual(firstDump);
    expect(tableCount(afterSecond, "candidates")).toBe(
      candidateFixtures.length,
    );
    for (const table of userTables(afterSecond)) {
      if (table === "candidates" || table === "candidate_comments") continue;
      expect(tableCount(afterSecond, table)).toBe(0);
    }
    // The artifact root is recreated empty and ready for the next demo.
    expect(existsSync(artifactRoot)).toBe(true);
  });

  it("keeps the demo:reset npm script wired to the reset script", () => {
    const scripts = readPackageScripts();
    expect(scripts["demo:reset"]).toBe("npm run db:reset");
    expect(scripts["db:reset"]).toBe("tsx scripts/reset-demo.ts");
    expect(
      existsSync(path.resolve(process.cwd(), "scripts/reset-demo.ts")),
    ).toBe(true);
  });

  it("runs as a standalone process exactly as demo day invokes it", async () => {
    const repoRoot = process.cwd();
    const databaseFile = path.join(repoRoot, ".data/demo-reset-cli.db");
    const cliArtifactRoot = path.join(
      repoRoot,
      ".data/demo-reset-cli-artifacts",
    );

    try {
      const run = spawnSync("npm", ["run", "demo:reset"], {
        cwd: repoRoot,
        env: {
          ...process.env,
          DATABASE_URL: "file:./.data/demo-reset-cli.db",
          ARTIFACT_ROOT: "./.data/demo-reset-cli-artifacts",
          NO_COLOR: "1",
        },
        encoding: "utf8",
      });

      expect(run.status).toBe(0);
      expect(run.stdout).toMatch(/seeded 10 candidate fixtures/);

      const sqlite = openReadonly(databaseFile);
      expect(tableCount(sqlite, "candidates")).toBe(10);
      expect(tableCount(sqlite, "productions")).toBe(0);
      expect(existsSync(cliArtifactRoot)).toBe(true);
    } finally {
      await rm(databaseFile, { force: true });
      await rm(`${databaseFile}-wal`, { force: true });
      await rm(`${databaseFile}-shm`, { force: true });
      await rm(cliArtifactRoot, { force: true, recursive: true });
    }
  });
});
