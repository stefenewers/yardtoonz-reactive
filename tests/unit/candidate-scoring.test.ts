import { describe, expect, it } from "vitest";

import {
  scoreCandidate,
  scoreHumorResponse,
  scoreViralMomentum,
  scoreYardToonzFit,
} from "../../src/domain/scoring";

const completeFit = {
  clearPremise: true,
  recognizableScenario: true,
  payoffWithinEightSeconds: true,
  authorizedAudio: true,
  visuallySimple: true,
  culturallyRelevant: true,
} as const;

describe("candidate scoring", () => {
  it("keeps missing metrics missing and lowers confidence without source age", () => {
    const result = scoreViralMomentum({
      metrics: { views: 10_000 },
      observedAt: "2026-09-03T12:00:00.000Z",
    });

    expect(result.inputsUsed).toEqual(["views"]);
    expect(result.explanation).toContain(
      "4 optional metrics were not supplied",
    );
    expect(result.explanation).toContain("confidence is lower");
  });

  it("counts configured laughter but not generic praise", () => {
    const result = scoreHumorResponse([
      "Great clip",
      "Love this",
      "Mi cyaan 😂",
    ]);

    expect(result.score).toBeGreaterThan(0);
    expect(result.explanation).toContain("1 of 3");
    expect(scoreHumorResponse(["Great clip", "Love this"]).score).toBe(0);
  });

  it("scores brand fit only from the explicit checklist", () => {
    const result = scoreYardToonzFit({
      ...completeFit,
      authorizedAudio: false,
      visuallySimple: false,
    });

    expect(result.score).toBe(67);
    expect(result.explanation).toContain("4 of 6");
  });

  it("uses the locked 40/30/30 overall weighting", () => {
    const result = scoreCandidate({
      metrics: { views: 10_000, likes: 1_000 },
      publishedAt: "2026-09-03T10:00:00.000Z",
      observedAt: "2026-09-03T12:00:00.000Z",
      commentExcerpts: ["😂"],
      fitChecklist: completeFit,
    });

    expect(result.overall).toBe(
      Math.round(
        result.viralMomentum.score * 0.4 +
          result.humorResponse.score * 0.3 +
          result.yardToonzFit.score * 0.3,
      ),
    );
    expect(result.scoringVersion).toBe("candidate-v1");
  });
});
