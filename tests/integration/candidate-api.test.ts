import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { candidateFixtures } from "../../fixtures/candidates";

import { GET as listCandidatesRoute } from "../../src/app/api/candidates/route";
import { PATCH as updateCandidateRoute } from "../../src/app/api/candidates/[id]/route";
import { POST as importCandidatesRoute } from "../../src/app/api/candidates/import/route";
import { createCandidateRepository } from "../../src/server/candidates/repository";
import type { CandidateRepository } from "../../src/server/candidates/repository";
import { openDatabase } from "../../src/server/db/client";
import * as schema from "../../src/server/db/schema";
import { importCandidatesResponseSchema } from "../../src/shared/candidate-intake";
import {
  apiErrorResponseSchema,
  approveCandidateResponseSchema,
  listCandidatesResponseSchema,
} from "../../src/shared/candidates";

const serviceState = vi.hoisted(() => ({
  repository: undefined as CandidateRepository | undefined,
}));

vi.mock("../../src/server/candidates/service", () => ({
  getCandidateRepository: () => {
    if (!serviceState.repository) {
      throw new Error("Test repository was not initialised");
    }
    return serviceState.repository;
  },
}));

const now = "2026-09-03T12:00:00.000Z";
const migrationsFolder = path.resolve(process.cwd(), "drizzle");

const openDatabases: Database.Database[] = [];
const openConnections: Database.Database[] = [];
const temporaryDirectories: string[] = [];

beforeEach(() => {
  serviceState.repository = undefined;
});

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const connection of openConnections.splice(0)) {
    if (connection.open) connection.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  serviceState.repository = undefined;
});

function createMemoryRepository(): {
  repository: CandidateRepository;
  sqlite: Database.Database;
} {
  const sqlite = new Database(":memory:");
  openDatabases.push(sqlite);
  sqlite.pragma("foreign_keys = ON");
  const database = drizzle(sqlite, { schema });
  migrate(database, { migrationsFolder });
  return { repository: createCandidateRepository(database), sqlite };
}

function openFileRepository(directory: string): {
  repository: CandidateRepository;
  sqlite: Database.Database;
} {
  const connection = openDatabase("file:./state/yardtoonz.db", {
    migrationsFolder,
    workingDirectory: directory,
  });
  openConnections.push(connection.sqlite);
  return {
    repository: createCandidateRepository(connection.database),
    sqlite: connection.sqlite,
  };
}

function useRepository(repository: CandidateRepository): void {
  serviceState.repository = repository;
}

function listRequest(query = ""): Request {
  return new Request(`http://localhost/api/candidates${query}`);
}

function updateRequest(id: string, body: unknown): Request {
  return new Request(`http://localhost/api/candidates/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function importRequest(body: unknown): Request {
  return new Request("http://localhost/api/candidates/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function routeContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

async function errorCode(response: Response): Promise<string> {
  const parsed = apiErrorResponseSchema.parse(await response.json());
  return parsed.error.code;
}

function decisionRows(
  sqlite: Database.Database,
  candidateId: string,
): { decision: string }[] {
  return sqlite
    .prepare(
      "SELECT decision FROM editorial_decisions WHERE candidate_id = ? ORDER BY decided_at",
    )
    .all(candidateId) as { decision: string }[];
}

const csvHeader = [
  "id",
  "platform",
  "sourceLabel",
  "caption",
  "publishedAt",
  "observedAt",
  "views",
  "likes",
  "commentExcerpts",
  "adaptationNote",
  "clearPremise",
  "recognizableScenario",
  "payoffWithinEightSeconds",
  "authorizedAudio",
  "visuallySimple",
  "culturallyRelevant",
].join(",");

const validCsvRows = [
  'cand_csv-011,TIKTOK,Demo CSV upload,"Vendor change, full committee",2026-09-01T10:00:00.000Z,2026-09-03T12:00:00.000Z,15000,1200,Big lol 😂;;Weak,Keep the counter choreography,true,true,true,true,true,true',
  ",YOUTUBE,Authorized demo contributor,Phone speaker surprise,,2026-09-03T12:00:00.000Z,9000,700,The panic 😂,One face and the dashboard,true,true,false,true,true,false",
].join("\n");

describe("candidate list API", () => {
  it("orders by overall score descending by default and supports component sorts", async () => {
    const { repository } = createMemoryRepository();
    repository.seed(candidateFixtures, now);
    useRepository(repository);

    const response = await listCandidatesRoute(listRequest());
    expect(response.status).toBe(200);
    const { candidates } = listCandidatesResponseSchema.parse(
      await response.json(),
    );
    expect(candidates).toHaveLength(10);
    const overalls = candidates.map(({ scores }) => scores.overall);
    expect(overalls).toEqual([...overalls].sort((left, right) => right - left));

    const ascending = await listCandidatesRoute(
      listRequest("?sort=overall&order=asc"),
    );
    const ascendingScores = listCandidatesResponseSchema
      .parse(await ascending.json())
      .candidates.map(({ scores }) => scores.overall);
    expect(ascendingScores).toEqual([...ascendingScores].sort((a, b) => a - b));

    const byFit = await listCandidatesRoute(
      listRequest("?sort=yardToonzFit&order=desc"),
    );
    const fitScores = listCandidatesResponseSchema
      .parse(await byFit.json())
      .candidates.map(({ scores }) => scores.yardToonzFit.score);
    expect(fitScores).toEqual([...fitScores].sort((a, b) => b - a));
  });

  it("filters by status and platform and rejects unknown query values", async () => {
    const { repository } = createMemoryRepository();
    repository.seed(candidateFixtures, now);
    useRepository(repository);

    const rejected = await updateCandidateRoute(
      updateRequest("cand_bus-stop-001", { status: "REJECTED" }),
      routeContext("cand_bus-stop-001"),
    );
    expect(rejected.status).toBe(200);

    const rejectedOnly = listCandidatesResponseSchema.parse(
      await (await listCandidatesRoute(listRequest("?status=REJECTED"))).json(),
    ).candidates;
    expect(rejectedOnly.map(({ id }) => id)).toEqual(["cand_bus-stop-001"]);

    const fresh = listCandidatesResponseSchema.parse(
      await (await listCandidatesRoute(listRequest("?status=NEW"))).json(),
    ).candidates;
    expect(fresh).toHaveLength(9);
    expect(fresh.every(({ status }) => status === "NEW")).toBe(true);

    const tiktok = listCandidatesResponseSchema.parse(
      await (await listCandidatesRoute(listRequest("?platform=TIKTOK"))).json(),
    ).candidates;
    expect(tiktok.map(({ id }) => id)).toEqual(["cand-market-change-006"]);

    const combined = listCandidatesResponseSchema.parse(
      await (
        await listCandidatesRoute(
          listRequest("?status=NEW&platform=TIKTOK&order=asc"),
        )
      ).json(),
    ).candidates;
    expect(combined.map(({ id }) => id)).toEqual(["cand-market-change-006"]);

    const approvedTiktok = await listCandidatesRoute(
      listRequest("?status=APPROVED&platform=TIKTOK"),
    );
    expect(
      listCandidatesResponseSchema.parse(await approvedTiktok.json())
        .candidates,
    ).toEqual([]);

    const invalidQuery = await listCandidatesRoute(
      listRequest("?status=BANNED"),
    );
    expect(invalidQuery.status).toBe(400);
    expect(await errorCode(invalidQuery)).toBe("INVALID_REQUEST");
  });
});

describe("candidate decision API", () => {
  it("rejects with a persisted reason, restores, and keeps decisions idempotent", async () => {
    const { repository, sqlite } = createMemoryRepository();
    repository.seed(candidateFixtures, now);
    useRepository(repository);

    const rejection = approveCandidateResponseSchema.parse(
      await (
        await updateCandidateRoute(
          updateRequest("cand_bus-stop-001", {
            status: "REJECTED",
            reason: "Weak payoff",
          }),
          routeContext("cand_bus-stop-001"),
        )
      ).json(),
    ).candidate;
    expect(rejection.status).toBe("REJECTED");
    expect(rejection.decisionReason).toBe("Weak payoff");
    expect(rejection.decidedAt).toBeDefined();
    expect(decisionRows(sqlite, "cand_bus-stop-001")).toEqual([
      { decision: "REJECTED" },
    ]);

    const repeat = await updateCandidateRoute(
      updateRequest("cand_bus-stop-001", { status: "REJECTED" }),
      routeContext("cand_bus-stop-001"),
    );
    expect(repeat.status).toBe(200);
    expect(decisionRows(sqlite, "cand_bus-stop-001")).toEqual([
      { decision: "REJECTED" },
    ]);

    const restored = approveCandidateResponseSchema.parse(
      await (
        await updateCandidateRoute(
          updateRequest("cand_bus-stop-001", { status: "NEW" }),
          routeContext("cand_bus-stop-001"),
        )
      ).json(),
    ).candidate;
    expect(restored.status).toBe("NEW");
    expect(restored.decisionReason).toBeUndefined();
    expect(restored.decidedAt).toBeUndefined();
    expect(decisionRows(sqlite, "cand_bus-stop-001")).toEqual([
      { decision: "REJECTED" },
    ]);

    const approval = approveCandidateResponseSchema.parse(
      await (
        await updateCandidateRoute(
          updateRequest("cand_bus-stop-001", { status: "APPROVED" }),
          routeContext("cand_bus-stop-001"),
        )
      ).json(),
    ).candidate;
    expect(approval.status).toBe("APPROVED");
    expect(decisionRows(sqlite, "cand_bus-stop-001")).toEqual([
      { decision: "REJECTED" },
      { decision: "APPROVED" },
    ]);

    const repeatApproval = await updateCandidateRoute(
      updateRequest("cand_bus-stop-001", { status: "APPROVED" }),
      routeContext("cand_bus-stop-001"),
    );
    expect(repeatApproval.status).toBe(200);
    expect(decisionRows(sqlite, "cand_bus-stop-001")).toHaveLength(2);
  });

  it("persists decisions across a repository restart without duplicating rows", async () => {
    const directory = path.join(
      tmpdir(),
      `yardtoonz-candidate-api-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(directory, { recursive: true });
    temporaryDirectories.push(directory);

    const first = openFileRepository(directory);
    first.repository.seed(candidateFixtures, now);
    useRepository(first.repository);

    const approval = await updateCandidateRoute(
      updateRequest("cand_bus-stop-001", { status: "APPROVED" }),
      routeContext("cand_bus-stop-001"),
    );
    expect(approval.status).toBe(200);

    // Simulate a process restart: drop the connection and reopen the file.
    first.sqlite.close();
    const second = openFileRepository(directory);
    useRepository(second.repository);

    const reloaded = listCandidatesResponseSchema.parse(
      await (await listCandidatesRoute(listRequest("?status=APPROVED"))).json(),
    ).candidates;
    expect(reloaded.map(({ id }) => id)).toEqual(["cand_bus-stop-001"]);

    const repeatApproval = await updateCandidateRoute(
      updateRequest("cand_bus-stop-001", { status: "APPROVED" }),
      routeContext("cand_bus-stop-001"),
    );
    expect(repeatApproval.status).toBe(200);
    expect(
      decisionRows(second.sqlite, "cand_bus-stop-001").filter(
        ({ decision }) => decision === "APPROVED",
      ),
    ).toHaveLength(1);

    const rejection = await updateCandidateRoute(
      updateRequest("cand_bus-stop-001", {
        status: "REJECTED",
        reason: "Changed our mind",
      }),
      routeContext("cand_bus-stop-001"),
    );
    expect(rejection.status).toBe(200);

    second.sqlite.close();
    const third = openFileRepository(directory);
    useRepository(third.repository);

    const rejectedAfterRestart = listCandidatesResponseSchema.parse(
      await (await listCandidatesRoute(listRequest("?status=REJECTED"))).json(),
    ).candidates;
    expect(rejectedAfterRestart.map(({ id }) => id)).toEqual([
      "cand_bus-stop-001",
    ]);
    expect(rejectedAfterRestart[0]?.decisionReason).toBe("Changed our mind");
    expect(
      decisionRows(third.sqlite, "cand_bus-stop-001").filter(
        ({ decision }) => decision === "REJECTED",
      ),
    ).toHaveLength(1);
  });

  it("maps missing candidates, conflicts, and invalid bodies to stable error codes", async () => {
    const { repository } = createMemoryRepository();
    repository.seed(candidateFixtures, now);
    useRepository(repository);

    const missingApprove = await updateCandidateRoute(
      updateRequest("cand_missing", { status: "APPROVED" }),
      routeContext("cand_missing"),
    );
    expect(missingApprove.status).toBe(404);
    expect(await errorCode(missingApprove)).toBe("CANDIDATE_NOT_FOUND");

    const missingRestore = await updateCandidateRoute(
      updateRequest("cand_missing", { status: "NEW" }),
      routeContext("cand_missing"),
    );
    expect(missingRestore.status).toBe(404);
    expect(await errorCode(missingRestore)).toBe("CANDIDATE_NOT_FOUND");

    await updateCandidateRoute(
      updateRequest("cand_bus-stop-001", { status: "APPROVED" }),
      routeContext("cand_bus-stop-001"),
    );
    const restoreApproval = await updateCandidateRoute(
      updateRequest("cand_bus-stop-001", { status: "NEW" }),
      routeContext("cand_bus-stop-001"),
    );
    expect(restoreApproval.status).toBe(409);
    expect(await errorCode(restoreApproval)).toBe(
      "CANDIDATE_DECISION_CONFLICT",
    );

    const unknownStatus = await updateCandidateRoute(
      updateRequest("cand_bus-stop-001", { status: "PENDING" }),
      routeContext("cand_bus-stop-001"),
    );
    expect(unknownStatus.status).toBe(400);
    expect(await errorCode(unknownStatus)).toBe("INVALID_REQUEST");

    const malformed = await updateCandidateRoute(
      updateRequest("cand_bus-stop-001", "{not json"),
      routeContext("cand_bus-stop-001"),
    );
    expect(malformed.status).toBe(400);
    expect(await errorCode(malformed)).toBe("INVALID_REQUEST");

    const emptyReason = await updateCandidateRoute(
      updateRequest("cand_bus-stop-001", { status: "REJECTED", reason: "   " }),
      routeContext("cand_bus-stop-001"),
    );
    expect(emptyReason.status).toBe(400);
    expect(await errorCode(emptyReason)).toBe("INVALID_REQUEST");
  });
});

describe("candidate import API", () => {
  it("imports seeded fixtures through the API and refuses duplicates", async () => {
    const { repository } = createMemoryRepository();
    useRepository(repository);

    const imported = importCandidatesResponseSchema.parse(
      await (
        await importCandidatesRoute(importRequest({ source: "SEEDED" }))
      ).json(),
    ).import;
    expect(imported.providerKind).toBe("SEEDED");
    expect(imported.imported).toBe(10);
    expect(imported.candidateIds).toHaveLength(10);

    const duplicate = await importCandidatesRoute(
      importRequest({ source: "SEEDED" }),
    );
    expect(duplicate.status).toBe(409);
    expect(await errorCode(duplicate)).toBe("DUPLICATE_ID");

    const list = listCandidatesResponseSchema.parse(
      await (await listCandidatesRoute(listRequest())).json(),
    ).candidates;
    expect(list).toHaveLength(10);
  });

  it("imports CSV rows through the API", async () => {
    const { repository } = createMemoryRepository();
    useRepository(repository);

    const imported = importCandidatesResponseSchema.parse(
      await (
        await importCandidatesRoute(
          importRequest({
            source: "CSV",
            csv: `${csvHeader}\n${validCsvRows}`,
          }),
        )
      ).json(),
    ).import;
    expect(imported.providerKind).toBe("CSV");
    expect(imported.imported).toBe(2);
    expect(imported.candidateIds[0]).toBe("cand_csv-011");

    const list = listCandidatesResponseSchema.parse(
      await (await listCandidatesRoute(listRequest())).json(),
    ).candidates;
    expect(list).toHaveLength(2);
  });

  it("maps invalid import input to stable error codes", async () => {
    const { repository } = createMemoryRepository();
    repository.seed(candidateFixtures, now);
    useRepository(repository);

    const badCsv = await importCandidatesRoute(
      importRequest({ source: "CSV", csv: "garbage" }),
    );
    expect(badCsv.status).toBe(400);
    expect(await errorCode(badCsv)).toBe("INVALID_CSV");

    const badRecord = await importCandidatesRoute(
      importRequest({
        source: "CSV",
        csv: `${csvHeader}\ncand_bad-1,FACEBOOK,Demo CSV upload,Wait for it,,2026-09-03T12:00:00.000Z,10,20,lol,Note,true,true,true,true,true,true`,
      }),
    );
    expect(badRecord.status).toBe(400);
    expect(await errorCode(badRecord)).toBe("INVALID_RECORD");

    const emptyBody = await importCandidatesRoute(
      importRequest({ source: "CSV", csv: "" }),
    );
    expect(emptyBody.status).toBe(400);
    expect(await errorCode(emptyBody)).toBe("INVALID_REQUEST");

    const unknownSource = await importCandidatesRoute(
      importRequest({ source: "BOGUS" }),
    );
    expect(unknownSource.status).toBe(400);
    expect(await errorCode(unknownSource)).toBe("INVALID_REQUEST");

    const malformed = await importCandidatesRoute(importRequest("{not json"));
    expect(malformed.status).toBe(400);
    expect(await errorCode(malformed)).toBe("INVALID_REQUEST");
  });
});
