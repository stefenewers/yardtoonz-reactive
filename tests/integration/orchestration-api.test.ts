import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { candidateFixtures } from "../../fixtures/candidates";
import {
  listRunsResponseSchema,
  runDetailResponseSchema,
} from "../../src/shared/orchestration";

/**
 * Same env-harness as the trace API suite: DATABASE_URL is fixed in
 * beforeAll, before any `@/lib/env`-importing module loads, and every
 * module is imported dynamically so the singleton binds to this suite's
 * temporary database.
 */
let fixtureDirectory: string;
let firstRunId: string;
const candidateId = candidateFixtures[0]!.id;

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(path.join(tmpdir(), "yardtoonz-orch-api-"));
  process.env.DATABASE_URL = `file:${path.join(
    fixtureDirectory,
    "orchestration-api.sqlite",
  )}`;

  const { getCandidateRepository } = await import(
    "../../src/server/candidates/service"
  );
  const candidates = getCandidateRepository();
  candidates.seed(candidateFixtures, "2026-09-03T12:00:00.000Z");
  candidates.approve(candidateId, "2026-09-03T12:01:00.000Z");
  candidates.confirmRights({
    candidateId,
    confirmedAt: "2026-09-03T12:02:00.000Z",
    confirmationTextVersion: "rights-v1",
  });
});

afterAll(async () => {
  await rm(fixtureDirectory, { recursive: true, force: true });
});

function runsUrl(): string {
  return "http://localhost/api/orchestration/runs";
}

function runUrl(runId: string): string {
  return `http://localhost/api/orchestration/runs/${runId}`;
}

describe("orchestration run API", () => {
  it("starts a run with 201 and a validated run detail payload", async () => {
    const { POST } = await import("../../src/app/api/orchestration/runs/route");
    const response = await POST(
      new Request(runsUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateId }),
      }),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as unknown;
    const parsed = runDetailResponseSchema.parse(body);
    expect(parsed.run.candidateId).toBe(candidateId);
    expect(parsed.run.status).toBe("RUNNING");
    expect(parsed.run.currentStepKey).toBe("yardtoonz-director");
    expect(parsed.timeline.totalCount).toBe(6);
    expect(parsed.timeline.completedCount).toBe(2);
    firstRunId = parsed.run.id;
  });

  it("returns the same active run with 200 on a second start (idempotency)", async () => {
    const { POST } = await import("../../src/app/api/orchestration/runs/route");
    const response = await POST(
      new Request(runsUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateId }),
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as unknown;
    const parsed = runDetailResponseSchema.parse(body);
    expect(parsed.run.id).toBe(firstRunId);
  });

  it("rejects unknown candidates with 404 and malformed bodies with 400", async () => {
    const { POST } = await import("../../src/app/api/orchestration/runs/route");

    const unknown = await POST(
      new Request(runsUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateId: "cand_missing" }),
      }),
    );
    expect(unknown.status).toBe(404);
    await expect(unknown.json()).resolves.toMatchObject({
      error: { code: "CANDIDATE_NOT_FOUND" },
    });

    const malformed = await POST(
      new Request(runsUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nope: true }),
      }),
    );
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
  });

  it("lists the candidate's runs newest first", async () => {
    const { GET } = await import("../../src/app/api/orchestration/runs/route");
    const response = await GET(
      new Request(
        `${runsUrl()}?candidateId=${encodeURIComponent(candidateId)}`,
      ),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as unknown;
    const parsed = listRunsResponseSchema.parse(body);
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0]!.id).toBe(firstRunId);
  });

  it("serves run detail and 404 for unknown runs", async () => {
    const { GET } = await import(
      "../../src/app/api/orchestration/runs/[id]/route"
    );

    const found = await GET(new Request(runUrl(firstRunId)), {
      params: Promise.resolve({ id: firstRunId }),
    });
    expect(found.status).toBe(200);
    const body = (await found.json()) as unknown;
    const parsed = runDetailResponseSchema.parse(body);
    expect(parsed.run.id).toBe(firstRunId);
    expect(
      parsed.timeline.steps.find(
        (step) => step.agentKey === "yardtoonz-director",
      )?.handoffIn?.kind,
    ).toBe("ANALYSIS_BRIEF");

    const missing = await GET(new Request(runUrl("orun_missing")), {
      params: Promise.resolve({ id: "orun_missing" }),
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: "RUN_NOT_FOUND" },
    });
  });

  it("refuses resuming a RUNNING run with 409", async () => {
    const { POST } = await import(
      "../../src/app/api/orchestration/runs/[id]/resume/route"
    );
    const response = await POST(new Request(runUrl(`${firstRunId}/resume`)), {
      params: Promise.resolve({ id: firstRunId }),
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RESUME_NOT_ALLOWED" },
    });
  });

  it("cancels an active run and then refuses further cancellation with 409", async () => {
    const { POST } = await import(
      "../../src/app/api/orchestration/runs/[id]/cancel/route"
    );
    const cancelled = await POST(
      new Request(runUrl(`${firstRunId}/cancel`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Operator stopped the run." }),
      }),
      { params: Promise.resolve({ id: firstRunId }) },
    );

    expect(cancelled.status).toBe(200);
    const body = (await cancelled.json()) as unknown;
    const parsed = runDetailResponseSchema.parse(body);
    expect(parsed.run.status).toBe("CANCELLED");
    expect(parsed.run.completedAt).not.toBeNull();

    const again = await POST(
      new Request(runUrl(`${firstRunId}/cancel`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "again" }),
      }),
      { params: Promise.resolve({ id: firstRunId }) },
    );
    expect(again.status).toBe(409);
    await expect(again.json()).resolves.toMatchObject({
      error: { code: "CANCEL_NOT_ALLOWED" },
    });
  });

  it("rejects list queries without a candidate id with 400", async () => {
    const { GET } = await import("../../src/app/api/orchestration/runs/route");
    const response = await GET(new Request(runsUrl()));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
  });
});
