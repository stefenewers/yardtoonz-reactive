import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { candidateFixtures } from "../../fixtures/candidates";
import { agentTraceResponseSchema } from "../../src/shared/agents";

/**
 * This suite binds the service singletons to a fresh temporary database by
 * setting DATABASE_URL in beforeAll, before any `@/lib/env`-importing module
 * is loaded. The env module parses `process.env` at import time and caches
 * the result, so service modules must only be imported dynamically — a
 * static import anywhere in the graph would freeze the default
 * `file:./.data/yardtoonz.db` path before this file can point the suite at
 * its own database.
 */
let fixtureDirectory: string;

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(path.join(tmpdir(), "yardtoonz-trace-api-"));
  process.env.DATABASE_URL = `file:${path.join(
    fixtureDirectory,
    "agent-trace-api.sqlite",
  )}`;

  const { getCandidateRepository } = await import(
    "../../src/server/candidates/service"
  );
  const candidates = getCandidateRepository();
  candidates.seed(candidateFixtures, "2026-09-03T12:00:00.000Z");

  // The Director's own writer: a created treatment adds the third row.
  const { getDirectorTreatmentService } = await import(
    "../../src/server/director/service"
  );
  const outcome = await getDirectorTreatmentService().create({
    candidateId: candidateFixtures[0]!.id,
  });
  if (outcome === "CANDIDATE_NOT_FOUND") {
    throw new Error("Expected the seeded candidate to accept a treatment");
  }
});

afterAll(async () => {
  await rm(fixtureDirectory, { recursive: true, force: true });
});

describe("agent trace API", () => {
  it("returns the candidate's ordered trace including the Director row", async () => {
    const { GET } = await import("../../src/app/api/agent-trace/route");
    const candidateId = candidateFixtures[0]!.id;
    const response = await GET(
      new Request(
        `http://localhost/api/agent-trace?candidateId=${encodeURIComponent(candidateId)}`,
      ),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as unknown;
    const parsed = agentTraceResponseSchema.parse(body);
    expect(parsed.runs.map((run) => run.agentKey)).toEqual([
      "trend-scout",
      "humor-analyst",
      "yardtoonz-director",
    ]);
    const director = parsed.runs[2]!;
    expect(director.state).toBe("COMPLETE");
    expect(director.provider).toBe("MOCK");
    expect(director.confidence).toBeGreaterThan(0);
    expect(director.decision).toBeTruthy();
    expect(director.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("rejects unknown subjects and malformed queries", async () => {
    const { GET } = await import("../../src/app/api/agent-trace/route");

    const unknownCandidate = await GET(
      new Request("http://localhost/api/agent-trace?candidateId=cand_missing"),
    );
    expect(unknownCandidate.status).toBe(404);
    const candidateError = (await unknownCandidate.json()) as {
      error?: { code?: string };
    };
    expect(candidateError.error?.code).toBe("CANDIDATE_NOT_FOUND");

    const unknownProduction = await GET(
      new Request("http://localhost/api/agent-trace?productionId=prod_missing"),
    );
    expect(unknownProduction.status).toBe(404);
    const productionError = (await unknownProduction.json()) as {
      error?: { code?: string };
    };
    expect(productionError.error?.code).toBe("PRODUCTION_NOT_FOUND");

    for (const query of ["candidateId=cand_1&productionId=prod_1", ""]) {
      const response = await GET(
        new Request(`http://localhost/api/agent-trace?${query}`),
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe("INVALID_REQUEST");
    }
  });
});
