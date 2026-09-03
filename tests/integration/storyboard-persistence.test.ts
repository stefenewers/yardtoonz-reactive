import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { candidateFixtures } from "../../fixtures/candidates";

let fixtureDirectory: string;

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(
    path.join(tmpdir(), "yardtoonz-storyboard-persistence-"),
  );
  process.env.DATABASE_URL = `file:${path.join(
    fixtureDirectory,
    "storyboards.sqlite",
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

async function freshServices() {
  const { getStoryboardService } = await import(
    "../../src/server/storyboard/service"
  );
  const { getDirectorTreatmentService } = await import(
    "../../src/server/director/service"
  );
  return {
    storyboards: getStoryboardService(),
    director: getDirectorTreatmentService(),
  };
}

describe("storyboard persistence", () => {
  it("requires a treatment before a storyboard can be built", async () => {
    const { storyboards } = await freshServices();
    const result = storyboards.create(candidateId);
    expect(result.outcome).toBe("TREATMENT_NOT_FOUND");
  });

  it("persists a storyboard derived from the persisted treatment", async () => {
    const { storyboards, director } = await freshServices();

    const treatment = await director.create({ candidateId });
    if (treatment === "CANDIDATE_NOT_FOUND") {
      throw new Error("Expected a treatment, got CANDIDATE_NOT_FOUND");
    }

    const result = storyboards.create(candidateId);
    expect(result.outcome).toBe("CREATED");
    if (result.outcome !== "CREATED") return;

    const { storyboard } = result;
    expect(storyboard.id).toBe(`sb_${candidateId}`);
    expect(storyboard.candidateId).toBe(candidateId);
    expect(storyboard.treatmentId).toBe(treatment.id);
    expect(storyboard.provider).toBe("MOCK");
    expect(storyboard.plan.segment).toEqual(
      treatment.treatment.recommendedSegment,
    );
    expect(storyboard.cueSheet.cues).toHaveLength(3);
    expect(storyboard.cueSheet.totalDurationSeconds).toBeGreaterThanOrEqual(5);
    expect(storyboard.cueSheet.totalDurationSeconds).toBeLessThanOrEqual(8);
  });

  it("returns the persisted row on repeated asks instead of duplicating", async () => {
    const { storyboards } = await freshServices();
    const first = storyboards.create(candidateId);
    const second = storyboards.create(candidateId);
    expect(first.outcome).toBe("CREATED");
    expect(second.outcome).toBe("CREATED");
    if (first.outcome !== "CREATED" || second.outcome !== "CREATED") return;
    expect(second.storyboard).toEqual(first.storyboard);
  });

  it("serves reads from a fresh service through the same database", async () => {
    const { storyboards } = await freshServices();
    const byCandidate = storyboards.getForCandidate(candidateId);
    expect(byCandidate).toBeDefined();
    if (!byCandidate) return;

    const byId = storyboards.get(byCandidate.id);
    expect(byId).toEqual(byCandidate);
  });

  it("fails loudly when a persisted plan no longer satisfies constraints", async () => {
    const { createStoryboardRepository } = await import(
      "../../src/server/storyboard/repository"
    );
    const { storyboards: storyboardsTable } = await import(
      "../../src/server/db/schema"
    );
    const { createDatabaseProvider } = await import(
      "../../src/server/db/client"
    );
    const provider = createDatabaseProvider(process.env.DATABASE_URL!);
    const database = provider.getConnection().database;
    const repository = createStoryboardRepository(database);

    const { storyboards, director } = await freshServices();
    const existing = storyboards.getForCandidate(candidateId);
    if (!existing) throw new Error("Expected a persisted storyboard");

    // Tamper against a second candidate that has no storyboard yet, so the
    // out-of-band row can carry real foreign keys all the way to disk.
    const tamperCandidateId = candidateFixtures[1]!.id;
    const tamperTreatment = await director.create({
      candidateId: tamperCandidateId,
    });
    if (tamperTreatment === "CANDIDATE_NOT_FOUND") {
      throw new Error("Expected a treatment for the tamper candidate");
    }

    // The first frame no longer starts at the segment start: every frame
    // stays structurally well-formed, but coverage is incomplete — a
    // cue-sheet constraint the repository must refuse on both write and
    // read.
    const tampered = {
      ...existing.plan,
      frames: existing.plan.frames.map((frame, index) =>
        index === 0
          ? { ...frame, startSeconds: frame.startSeconds + 0.5 }
          : frame,
      ),
    };

    expect(() =>
      repository.createStoryboard({
        id: `sb_${tamperCandidateId}`,
        candidateId: tamperCandidateId,
        provider: "MOCK",
        treatmentId: tamperTreatment.id,
        plan: tampered,
        now: new Date(),
      }),
    ).toThrow(/violates cue-sheet constraints/i);

    // Bypass the guarded write with a raw insert to prove the read path
    // refuses to serve a plan persisted out-of-band.
    database
      .insert(storyboardsTable)
      .values({
        id: `sb_${tamperCandidateId}`,
        candidateId: tamperCandidateId,
        provider: "MOCK",
        treatmentId: tamperTreatment.id,
        planJson: JSON.stringify(tampered),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    expect(() =>
      repository.getStoryboardForCandidate(tamperCandidateId),
    ).toThrow(/violates cue-sheet constraints/i);
  });

  it("reports an unknown storyboard id as missing", async () => {
    const { storyboards } = await freshServices();
    expect(storyboards.get("sb_nope")).toBeUndefined();
  });
});

describe("storyboard API routes", () => {
  async function postCreate(id: string) {
    const { POST } = await import(
      "../../src/app/api/candidates/[id]/storyboard/route"
    );
    const response = await POST(new Request("http://localhost/api/x"), {
      params: Promise.resolve({ id }),
    });
    return {
      status: response.status,
      body: (await response.json()) as {
        storyboard?: { id: string };
        error?: { code?: string };
      },
    };
  }

  async function getByCandidate(id: string) {
    const { GET } = await import(
      "../../src/app/api/candidates/[id]/storyboard/route"
    );
    const response = await GET(new Request("http://localhost/api/x"), {
      params: Promise.resolve({ id }),
    });
    return {
      status: response.status,
      body: (await response.json()) as {
        storyboard?: { id: string };
        error?: { code?: string };
      },
    };
  }

  it("creates a storyboard through the candidate route", async () => {
    const { status, body } = await postCreate(candidateId);
    expect(status).toBe(200);
    expect(body.storyboard?.id).toBe(`sb_${candidateId}`);
  });

  it("returns the same storyboard on repeated POSTs", async () => {
    const first = await postCreate(candidateId);
    const second = await postCreate(candidateId);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.storyboard?.id).toBe(first.body.storyboard?.id);
  });

  it("reads the storyboard back through the candidate route", async () => {
    const { status, body } = await getByCandidate(candidateId);
    expect(status).toBe(200);
    expect(body.storyboard?.id).toBe(`sb_${candidateId}`);
  });

  it("returns 404 STORYBOARD_NOT_FOUND for an unknown candidate", async () => {
    const { status, body } = await getByCandidate("cand_missing");
    expect(status).toBe(404);
    expect(body.error?.code).toBe("STORYBOARD_NOT_FOUND");
  });

  it("returns 404 CANDIDATE_NOT_FOUND when creating for an unknown candidate", async () => {
    const { status, body } = await postCreate("cand_missing");
    expect(status).toBe(404);
    expect(body.error?.code).toBe("CANDIDATE_NOT_FOUND");
  });

  it("exposes the storyboard through the by-id route", async () => {
    const { GET } = await import("../../src/app/api/storyboards/[id]/route");
    const response = await GET(new Request("http://localhost/api/x"), {
      params: Promise.resolve({ id: `sb_${candidateId}` }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      storyboard?: { id: string; cueSheet: { cues: unknown[] } };
      error?: { code?: string };
    };
    expect(body.storyboard?.id).toBe(`sb_${candidateId}`);
    expect(body.storyboard?.cueSheet.cues).toHaveLength(3);
  });

  it("returns 404 STORYBOARD_NOT_FOUND for an unknown id", async () => {
    const { GET } = await import("../../src/app/api/storyboards/[id]/route");
    const response = await GET(new Request("http://localhost/api/x"), {
      params: Promise.resolve({ id: "sb_nope" }),
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("STORYBOARD_NOT_FOUND");
  });
});
