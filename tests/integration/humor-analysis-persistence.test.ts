import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { candidateFixtures } from "../../fixtures/candidates";
import { createHumorAnalysisRequestSchema } from "../../src/domain/humor-analysis";

let fixtureDirectory: string;

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(
    path.join(tmpdir(), "yardtoonz-humor-analysis-"),
  );
  process.env.DATABASE_URL = `file:${path.join(
    fixtureDirectory,
    "humor-analysis.sqlite",
  )}`;

  const { getCandidateRepository } = await import(
    "../../src/server/candidates/service"
  );
  const candidates = getCandidateRepository();
  candidates.seed(candidateFixtures, "2026-09-03T12:00:00.000Z");
});

afterAll(async () => {
  await rm(fixtureDirectory, { recursive: true, force: true });
});

const candidateId = candidateFixtures[0]!.id;

async function freshService() {
  const { getHumorAnalysisService } = await import(
    "../../src/server/humor-analysis/service"
  );
  return getHumorAnalysisService();
}

describe("humor analysis persistence", () => {
  it("rejects empty path ids at the contract level", () => {
    expect(() =>
      createHumorAnalysisRequestSchema.parse({ candidateId: "" }),
    ).toThrow();
  });

  it("persists an analysis derived from the candidate's corpus", async () => {
    const service = await freshService();
    const result = service.analyze(candidateId);
    expect(result.outcome).toBe("CREATED");
    if (result.outcome !== "CREATED") return;

    const { analysis } = result;
    expect(analysis.id).toBe(`ha_${candidateId}`);
    expect(analysis.candidateId).toBe(candidateId);
    expect(analysis.corpusSource).toBe("DEMO_CORPUS");
    expect(analysis.analysis.corpusSize).toBe(10);
    expect(analysis.analysis.confidence).toBeLessThanOrEqual(0.95);
  });

  it("refreshes in place on repeated asks instead of duplicating", async () => {
    const service = await freshService();
    const first = service.analyze(candidateId);
    const second = service.analyze(candidateId);
    expect(first.outcome).toBe("CREATED");
    expect(second.outcome).toBe("CREATED");
    if (first.outcome !== "CREATED" || second.outcome !== "CREATED") return;
    expect(second.analysis).toEqual(first.analysis);
  });

  it("serves reads from a fresh service through the same database", async () => {
    const service = await freshService();
    const byCandidate = service.getForCandidate(candidateId);
    expect(byCandidate).toBeDefined();
    if (!byCandidate) return;

    const byId = service.get(byCandidate.id);
    expect(byId).toEqual(byCandidate);
  });

  it("reports CANDIDATE_NOT_FOUND for unknown candidates", async () => {
    const service = await freshService();
    expect(service.analyze("cand_missing-999").outcome).toBe(
      "CANDIDATE_NOT_FOUND",
    );
    expect(service.getForCandidate("cand_missing-999")).toBeUndefined();
  });

  it("keeps candidates without excerpts on the honest persisted path", async () => {
    const noExcerpt = candidateFixtures.find(
      (candidate) => candidate.commentExcerpts.length === 0,
    );
    if (!noExcerpt) return;

    const service = await freshService();
    const result = service.analyze(noExcerpt.id);
    expect(result.outcome).toBe("CREATED");
    if (result.outcome !== "CREATED") return;
    expect(result.analysis.corpusSource).toBe("PERSISTED_EXCERPTS");
    expect(result.analysis.analysis.corpusSize).toBe(0);
    expect(result.analysis.analysis.evidenceGaps.length).toBeGreaterThan(0);
  });

  it("persists rows that still satisfy the resource schema on read", async () => {
    const { createDatabaseProvider } = await import(
      "../../src/server/db/client"
    );
    const provider = createDatabaseProvider(process.env.DATABASE_URL!);
    const database = provider.getConnection().database;
    const { createHumorAnalysisRepository } = await import(
      "../../src/server/humor-analysis/repository"
    );
    const repository = createHumorAnalysisRepository(database);

    const read = repository.getAnalysisForCandidate(candidateId);
    expect(read).toBeDefined();
    if (!read) return;
    expect(read.analysis.summary.laughterCommentCount).toBeGreaterThan(0);
  });
});
