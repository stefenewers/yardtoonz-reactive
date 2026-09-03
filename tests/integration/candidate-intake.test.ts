import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { candidateFixtures } from "../../fixtures/candidates";
import {
  CandidateIntakeError,
  createCsvCandidateIntakeProvider,
  createManualCandidateIntakeProvider,
  createSeededCandidateIntakeProvider,
  importCandidates,
} from "../../src/server/candidates/intake";
import {
  createCandidateRepository,
  type CandidateRepository,
} from "../../src/server/candidates/repository";
import * as schema from "../../src/server/db/schema";
import {
  candidateIntakeResultSchema,
  type CandidateIntakeResult,
} from "../../src/shared/candidate-intake";
import { listCandidatesResponseSchema } from "../../src/shared/candidates";

const openDatabases: Database.Database[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
});

function createRepository(): CandidateRepository {
  const sqlite = new Database(":memory:");
  openDatabases.push(sqlite);
  sqlite.pragma("foreign_keys = ON");
  const database = drizzle(sqlite, { schema });
  migrate(database, {
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });
  return createCandidateRepository(database);
}

const now = "2026-09-03T12:00:00.000Z";

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

function importCsv(
  repository: CandidateRepository,
  csv: string,
): CandidateIntakeResult {
  return importCandidates({
    provider: createCsvCandidateIntakeProvider(csv),
    repository,
    now,
  });
}

function intakeError(run: () => unknown): CandidateIntakeError {
  try {
    run();
  } catch (error) {
    if (error instanceof CandidateIntakeError) return error;
    throw error;
  }
  throw new Error("expected the candidate intake to fail");
}

describe("candidate intake", () => {
  it("imports the ten seeded fixtures with scored evidence and comment excerpts", () => {
    const repository = createRepository();

    const result = candidateIntakeResultSchema.parse(
      importCandidates({
        provider: createSeededCandidateIntakeProvider(),
        repository,
        now,
      }),
    );

    expect(result.providerKind).toBe("SEEDED");
    expect(result.imported).toBe(10);
    expect(new Set(result.candidateIds).size).toBe(10);

    const response = listCandidatesResponseSchema.parse({
      candidates: repository.list(),
    });
    expect(response.candidates).toHaveLength(10);
    expect(response.candidates.every(({ status }) => status === "NEW")).toBe(
      true,
    );
    expect(
      response.candidates.every(
        ({ scores }) => scores.scoringVersion === "candidate-v1",
      ),
    ).toBe(true);

    const busStop = repository.get("cand_bus-stop-001");
    expect(busStop?.commentExcerpts).toEqual([
      "Mi cyaan 😂",
      "The timing weak me",
      "🤣🤣",
    ]);
    expect(busStop?.scores.overall).toBeGreaterThan(0);
  });

  it("refuses a repeated seeded import and preserves existing candidates", () => {
    const repository = createRepository();
    const first = importCandidates({
      provider: createSeededCandidateIntakeProvider(),
      repository,
      now,
    });
    expect(first.imported).toBe(10);

    const error = intakeError(() =>
      importCandidates({
        provider: createSeededCandidateIntakeProvider(),
        repository,
        now,
      }),
    );

    expect(error.code).toBe("DUPLICATE_ID");
    expect(repository.list()).toHaveLength(10);
  });

  it("imports CSV rows, generates missing ids, and preserves seeded data", () => {
    const repository = createRepository();
    repository.seed(candidateFixtures, now);
    const before = repository.list();

    const csv = [
      csvHeader,
      'cand_csv-011,TIKTok,Demo CSV upload,"Vendor change, full committee",2026-09-01T10:00:00.000Z,2026-09-03T12:00:00.000Z,15000,1200,Big lol 😂;;Weak,Keep the counter choreography,true,true,true,true,true,true',
      ",YOUTUBE,Authorized demo contributor,Phone speaker surprise,,2026-09-03T12:00:00.000Z,9000,700,The panic 😂,One face and the dashboard,true,true,false,true,true,false",
    ].join("\n");

    const result = importCsv(repository, csv);

    expect(result.providerKind).toBe("CSV");
    expect(result.imported).toBe(2);
    expect(result.candidateIds[0]).toBe("cand_csv-011");
    expect(result.candidateIds[1]).toMatch(/^cand_/);

    expect(repository.list()).toHaveLength(12);
    const imported = repository.get("cand_csv-011");
    expect(imported?.platform).toBe("TIKTOK");
    expect(imported?.caption).toBe("Vendor change, full committee");
    expect(imported?.metrics).toEqual({ views: 15000, likes: 1200 });
    expect(imported?.commentExcerpts).toEqual(["Big lol 😂", "Weak"]);
    expect(imported?.adaptationNote).toBe("Keep the counter choreography");
    expect(imported?.scores.yardToonzFit.score).toBe(100);
    expect(imported?.scores.overall).toBeGreaterThan(0);
    expect(imported?.status).toBe("NEW");

    const generated = repository.get(result.candidateIds[1]!);
    expect(generated?.platform).toBe("YOUTUBE");
    expect(generated?.publishedAt).toBeUndefined();
    expect(generated?.scores.yardToonzFit.score).toBe(67);

    expect(before.map((candidate) => repository.get(candidate.id))).toEqual(
      before,
    );
  });

  it("treats a header-only CSV import as a no-op that preserves data", () => {
    const repository = createRepository();
    repository.seed(candidateFixtures, now);
    const before = repository.list();

    const result = importCsv(repository, csvHeader);

    expect(result.imported).toBe(0);
    expect(result.candidateIds).toEqual([]);
    expect(repository.list()).toEqual(before);
  });

  it("rejects malformed CSV input and preserves existing data", () => {
    const repository = createRepository();
    repository.seed(candidateFixtures, now);
    const before = repository.list();

    const unterminated = intakeError(() =>
      importCsv(repository, `${csvHeader}\n"cand_bad,TIKTOK`),
    );
    expect(unterminated.code).toBe("INVALID_CSV");

    const missingColumn = intakeError(() =>
      importCsv(
        repository,
        `${csvHeader.replace("caption,", "")}\ncand_bad-2,TIKTOK,Demo CSV upload`,
      ),
    );
    expect(missingColumn.code).toBe("INVALID_CSV");
    expect(missingColumn.issues[0]).toContain("caption");

    const unknownColumn = intakeError(() =>
      importCsv(
        repository,
        `${csvHeader},mysteryColumn\ncand_bad-3,TIKTOK,Demo CSV upload,Wait for it,,${now},10,20,lol,Note,true,true,true,true,true,true,extra`,
      ),
    );
    expect(unknownColumn.code).toBe("INVALID_CSV");
    expect(unknownColumn.issues[0]).toContain("mysteryColumn");

    expect(repository.list()).toEqual(before);
  });

  it("rejects rows with invalid values and preserves existing data", () => {
    const repository = createRepository();
    repository.seed(candidateFixtures, now);
    const before = repository.list();

    const csv = [
      csvHeader,
      "cand_bad-1,FACEBOOK,Demo CSV upload,Wait for it,,2026-09-03T12:00:00.000Z,10,20,lol,Note,true,true,true,true,true,true",
      "cand_bad-2,TIKTOK,Demo CSV upload,Wait for it,,2026-09-03T12:00:00.000Z,10,20,lol,Note,true,true,true,maybe,true,true",
    ].join("\n");

    const error = intakeError(() => importCsv(repository, csv));

    expect(error.code).toBe("INVALID_RECORD");
    expect(error.issues.join("\n")).toContain("platform");
    expect(error.issues.join("\n")).toContain("authorizedAudio");
    expect(repository.list()).toEqual(before);
  });

  it("imports a manual entry with a generated id and scoring evidence", () => {
    const repository = createRepository();

    const result = importCandidates({
      provider: createManualCandidateIntakeProvider({
        platform: "INSTAGRAM",
        sourceLabel: "Editor submission",
        caption: "Pow arrives exactly when the queue gives up.",
        observedAt: now,
        metrics: {},
        commentExcerpts: ["Mi cyaan 😂"],
        adaptationNote: "Hold the side-eye before the payoff.",
        fitChecklist: {
          clearPremise: true,
          recognizableScenario: true,
          payoffWithinEightSeconds: true,
          authorizedAudio: true,
          visuallySimple: true,
          culturallyRelevant: true,
        },
      }),
      repository,
      now,
    });

    expect(result.providerKind).toBe("MANUAL");
    expect(result.imported).toBe(1);

    const candidate = repository.get(result.candidateIds[0]!);
    expect(candidate?.status).toBe("NEW");
    expect(candidate?.metrics).toEqual({});
    expect(candidate?.scores.viralMomentum.score).toBe(0);
    expect(candidate?.scores.yardToonzFit.score).toBe(100);
    expect(candidate?.scores.overall).toBeGreaterThan(0);
  });

  it("rejects an invalid manual entry without persisting anything", () => {
    const repository = createRepository();

    const error = intakeError(() =>
      importCandidates({
        provider: createManualCandidateIntakeProvider({
          platform: "TIKTOK",
          caption: "Missing required editorial fields",
        }),
        repository,
        now,
      }),
    );

    expect(error.code).toBe("INVALID_RECORD");
    expect(error.issues.length).toBeGreaterThan(0);
    expect(repository.list()).toEqual([]);
  });

  it("refuses an import that would overwrite an approved candidate", () => {
    const repository = createRepository();
    repository.seed(candidateFixtures, now);
    repository.approve("cand_bus-stop-001", "2026-09-03T12:05:00.000Z");

    const csv = [
      csvHeader,
      "cand_bus-stop-001,TIKTOK,Demo CSV upload,Replacement attempt,,2026-09-03T12:00:00.000Z,10,10,lol,Note,true,true,true,true,true,true",
    ].join("\n");

    const error = intakeError(() => importCsv(repository, csv));

    expect(error.code).toBe("DUPLICATE_ID");
    const preserved = repository.get("cand_bus-stop-001");
    expect(preserved?.status).toBe("APPROVED");
    expect(preserved?.caption).toBe(
      "The bus finally arrives just as everybody gives up waiting.",
    );
    expect(repository.list()).toHaveLength(10);
  });
});
