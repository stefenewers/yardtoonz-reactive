import { describe, expect, it } from "vitest";

import {
  candidateListSchema,
  formatDecisionTimestamp,
  formatMetric,
  scoreLabel,
} from "../../src/domain/candidate";
import {
  createApiCandidateClient,
  createMockCandidateClient,
} from "../../src/lib/candidate-client";

describe("candidate review contract", () => {
  it("returns a validated, ranked-ready demo set with honest missing metrics", async () => {
    const candidates = candidateListSchema.parse(
      await createMockCandidateClient().listCandidates(),
    );

    expect(candidates).toHaveLength(10);
    expect(Math.max(...candidates.map(({ scores }) => scores.overall))).toBe(
      94,
    );
    expect(candidates.some(({ metrics }) => metrics.shares === undefined)).toBe(
      true,
    );
    expect(formatMetric(undefined)).toBe("Not supplied");
  });

  it("requires approval before rights confirmation", async () => {
    const client = createMockCandidateClient();

    await expect(
      client.confirmRights({
        candidateId: "candidate-yard-call",
        confirmationTextVersion: "2026-09-03",
      }),
    ).rejects.toThrow("Approve this candidate");

    const approved = await client.approveCandidate("candidate-yard-call");
    const rights = await client.confirmRights({
      candidateId: approved.id,
      confirmationTextVersion: "2026-09-03",
    });

    expect(approved.status).toBe("APPROVED");
    expect(rights.confirmed).toBe(true);
  });

  it("gives every score a text label", () => {
    expect(scoreLabel(91)).toBe("Strong");
    expect(scoreLabel(75)).toBe("Promising");
    expect(scoreLabel(55)).toBe("Review");
  });
});

const candidatePayload = {
  id: "cand-patch-001",
  platform: "TIKTOK",
  sourceLabel: "Half Way Tree vox pop",
  caption: "A confident answer falls apart when the follow-up lands.",
  publishedAt: "2026-09-02T12:00:00.000Z",
  observedAt: "2026-09-03T12:00:00.000Z",
  metrics: { views: 94_000, likes: 8_100 },
  commentExcerpts: [],
  scores: {
    viralMomentum: {
      score: 80,
      explanation: "Supplied views and likes.",
      inputsUsed: ["views"],
    },
    humorResponse: {
      score: 75,
      explanation: "No comment evidence was supplied.",
      inputsUsed: [],
    },
    yardToonzFit: {
      score: 82,
      explanation: "Concise single-shot premise.",
      inputsUsed: ["clear premise"],
    },
    overall: 79,
    scoringVersion: "candidate-v1",
  },
  status: "NEW",
  createdAt: "2026-09-03T12:00:00.000Z",
  updatedAt: "2026-09-03T12:00:00.000Z",
};

describe("candidate decision contract", () => {
  it("rejects and restores through the persisted PATCH contract", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const candidateFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({
          candidate: {
            ...candidatePayload,
            status: "REJECTED",
            decisionReason: "Audio rights unresolved",
            decidedAt: "2026-09-03T18:29:09.000Z",
          },
        }),
        { status: 200 },
      );
    };
    const client = createApiCandidateClient(candidateFetch);

    const rejected = await client.rejectCandidate(
      "cand-patch-001",
      "  Audio rights unresolved  ",
    );
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.decisionReason).toBe("Audio rights unresolved");
    expect(rejected.decidedAt).toBe("2026-09-03T18:29:09.000Z");
    expect(calls[0]).toEqual({
      url: "/api/candidates/cand-patch-001",
      body: { status: "REJECTED", reason: "Audio rights unresolved" },
    });

    await client.restoreCandidate("cand-patch-001");
    expect(calls[1].body).toEqual({ status: "NEW" });
  });

  it("rejects without a reason by omitting the field entirely", async () => {
    const bodies: unknown[] = [];
    const candidateFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          candidate: { ...candidatePayload, status: "REJECTED" },
        }),
        { status: 200 },
      );
    };
    const client = createApiCandidateClient(candidateFetch);

    await client.rejectCandidate("cand-patch-001");
    expect(bodies[0]).toEqual({ status: "REJECTED" });
  });

  it("mock client: records a reasoned rejection and restores back to new", async () => {
    const client = createMockCandidateClient();

    const rejected = await client.rejectCandidate(
      "candidate-yard-call",
      "Off-brand audio",
    );
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.decisionReason).toBe("Off-brand audio");
    expect(rejected.decidedAt).toBeTruthy();

    // Re-rejecting mirrors the repository's idempotent no-op.
    const again = await client.rejectCandidate(
      "candidate-yard-call",
      "Different reason",
    );
    expect(again.decidedAt).toBe(rejected.decidedAt);
    expect(again.decisionReason).toBe("Off-brand audio");

    const restored = await client.restoreCandidate("candidate-yard-call");
    expect(restored.status).toBe("NEW");
    expect(restored.decisionReason).toBeUndefined();
    expect(restored.decidedAt).toBeUndefined();
  });

  it("mock client: an approved candidate keeps its approval on restore", async () => {
    const client = createMockCandidateClient();
    await client.approveCandidate("candidate-yard-call");

    await expect(
      client.restoreCandidate("candidate-yard-call"),
    ).rejects.toThrow("not allowed for the candidate's current status");
  });

  it("renders persisted decision timestamps in UTC", () => {
    expect(formatDecisionTimestamp("2026-09-03T18:29:09.000Z")).toBe(
      "Sep 3, 2026, 6:29 PM UTC",
    );
    expect(formatDecisionTimestamp("not-a-timestamp")).toBe("not-a-timestamp");
  });
});
