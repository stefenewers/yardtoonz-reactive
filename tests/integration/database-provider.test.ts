import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { candidateFixtures } from "../../fixtures/candidates";
import { createCandidateRepository } from "../../src/server/candidates/repository";
import { createDatabaseProvider } from "../../src/server/db/client";
import { resetDemoData } from "../../src/server/db/reset";

const migrationsFolder = path.resolve(process.cwd(), "drizzle");
const demoEnvironment = {
  DATABASE_URL: "file:./.data/yardtoonz.db",
  ARTIFACT_ROOT: "./.data/artifacts",
} as const;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createWorkingDirectory(): Promise<string> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "yardtoonz-db-provider-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

interface StatusCountRow {
  status: string;
  n: number;
}

describe("createDatabaseProvider", () => {
  it("returns the same connection while the database file is untouched", async () => {
    const directory = await createWorkingDirectory();
    const provider = createDatabaseProvider(demoEnvironment.DATABASE_URL, {
      workingDirectory: directory,
      migrationsFolder,
    });

    const first = provider.getConnection();
    const second = provider.getConnection();
    expect(second).toBe(first);
  });

  it("reopens after demo reset so a running server never serves pre-reset rows", async () => {
    const directory = await createWorkingDirectory();
    const provider = createDatabaseProvider(demoEnvironment.DATABASE_URL, {
      workingDirectory: directory,
      migrationsFolder,
    });

    const before = provider.getConnection();
    // The candidate service seeds fixtures on every cold connection; mirror
    // that here so the rehearsal mutation below touches real rows.
    expect(
      createCandidateRepository(before.database).seed(
        candidateFixtures,
        "2026-09-03T12:00:00.000Z",
      ),
    ).toBe(candidateFixtures.length);
    // A rehearsal mutates state (for example approving a candidate) before
    // the operator resets; a stale handle would keep showing that mutation.
    before.sqlite
      .prepare(
        "UPDATE candidates SET status = 'APPROVED' WHERE id = (SELECT id FROM candidates LIMIT 1)",
      )
      .run();
    const approvedBefore = before.sqlite
      .prepare("SELECT COUNT(*) AS n FROM candidates WHERE status = 'APPROVED'")
      .get() as { n: number };
    expect(approvedBefore.n).toBe(1);

    await resetDemoData(demoEnvironment, {
      workingDirectory: directory,
      migrationsFolder,
    });

    const after = provider.getConnection();
    expect(after).not.toBe(before);
    const statuses = after.sqlite
      .prepare(
        "SELECT status, COUNT(*) AS n FROM candidates GROUP BY status ORDER BY status",
      )
      .all() as StatusCountRow[];
    expect(statuses).toEqual([{ status: "NEW", n: 10 }]);
  });

  it("memoizes a single connection for in-memory databases", () => {
    const provider = createDatabaseProvider("file::memory:", {
      migrationsFolder,
    });
    expect(provider.getConnection()).toBe(provider.getConnection());
  });
});
