import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { candidateFixtures } from "../../fixtures/candidates";
import { createCandidateRepository } from "../../src/server/candidates/repository";
import * as schema from "../../src/server/db/schema";
import {
  approveCandidateResponseSchema,
  confirmRightsResponseSchema,
  listCandidatesResponseSchema,
} from "../../src/shared/candidates";

const openDatabases: Database.Database[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
});

function createRepository() {
  const sqlite = new Database(":memory:");
  openDatabases.push(sqlite);
  sqlite.pragma("foreign_keys = ON");
  const database = drizzle(sqlite, { schema });
  migrate(database, {
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });
  return createCandidateRepository(database);
}

describe("candidate repository happy path", () => {
  it("seeds ten scored candidates once and lists them by overall score", () => {
    const repository = createRepository();
    const now = "2026-09-03T12:00:00.000Z";

    expect(repository.seed(candidateFixtures, now)).toBe(10);
    expect(repository.seed(candidateFixtures, now)).toBe(0);

    const response = listCandidatesResponseSchema.parse({
      candidates: repository.list(),
    });
    expect(response.candidates).toHaveLength(10);
    expect(response.candidates[0]?.scores.overall).toBeGreaterThanOrEqual(
      response.candidates[1]?.scores.overall ?? 0,
    );
    expect(response.candidates.every(({ status }) => status === "NEW")).toBe(
      true,
    );
  });

  it("persists approval and rights confirmation with typed responses", () => {
    const repository = createRepository();
    repository.seed(candidateFixtures, "2026-09-03T12:00:00.000Z");
    const candidateId = candidateFixtures[0]!.id;

    const candidate = repository.approve(
      candidateId,
      "2026-09-03T12:01:00.000Z",
    );
    const approval = approveCandidateResponseSchema.parse({ candidate });
    expect(approval.candidate.status).toBe("APPROVED");

    const rightsConfirmation = repository.confirmRights({
      candidateId,
      confirmedAt: "2026-09-03T12:02:00.000Z",
      confirmationTextVersion: "rights-v1",
    });
    const response = confirmRightsResponseSchema.parse({ rightsConfirmation });
    expect(response.rightsConfirmation).toEqual({
      candidateId,
      confirmed: true,
      confirmedAt: "2026-09-03T12:02:00.000Z",
      confirmationTextVersion: "rights-v1",
    });
  });

  it("refuses rights confirmation before approval", () => {
    const repository = createRepository();
    repository.seed(candidateFixtures, "2026-09-03T12:00:00.000Z");

    expect(
      repository.confirmRights({
        candidateId: candidateFixtures[0]!.id,
        confirmedAt: "2026-09-03T12:02:00.000Z",
        confirmationTextVersion: "rights-v1",
      }),
    ).toBe("NOT_APPROVED");
  });
});
