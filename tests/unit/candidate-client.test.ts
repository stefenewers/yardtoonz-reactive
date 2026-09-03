import { describe, expect, it } from "vitest";

import {
  candidateListSchema,
  formatMetric,
  scoreLabel,
} from "../../src/domain/candidate";
import { createMockCandidateClient } from "../../src/lib/candidate-client";

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
