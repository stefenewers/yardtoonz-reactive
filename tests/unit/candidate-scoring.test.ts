import { describe, expect, it } from "vitest";

import {
  scoreCandidate,
  scoreHumorResponse,
  scoreOverall,
  scoreViralMomentum,
  scoreYardToonzFit,
  scoringWeights,
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
  it("keeps partial metrics missing rather than treating them as zero", () => {
    const partialMetrics = scoreViralMomentum({
      metrics: { views: 10_000 },
      observedAt: "2026-09-03T12:00:00.000Z",
    });
    const suppliedZeroMetrics = scoreViralMomentum({
      metrics: { views: 10_000, likes: 0 },
      observedAt: "2026-09-03T12:00:00.000Z",
    });

    expect(partialMetrics.inputsUsed).toEqual(["views"]);
    expect(partialMetrics.explanation).toContain(
      "4 optional metrics were not supplied",
    );
    expect(partialMetrics.explanation).toContain("confidence is lower");
    expect(partialMetrics.score).toBeGreaterThan(suppliedZeroMetrics.score);
  });

  it("normalizes complete metrics to the supplied source age", () => {
    const result = scoreViralMomentum({
      metrics: {
        views: 50_000,
        likes: 5_000,
        comments: 1_000,
        shares: 1_000,
        saves: 1_000,
      },
      publishedAt: "2026-09-03T10:00:00.000Z",
      observedAt: "2026-09-03T12:00:00.000Z",
    });

    expect(result.inputsUsed).toHaveLength(5);
    expect(result.explanation).toContain(
      "normalized across 2 source-age hours",
    );
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

  it("explains when comment evidence is absent", () => {
    const result = scoreHumorResponse([]);

    expect(result).toEqual({
      score: 0,
      explanation:
        "No comment evidence was supplied, so humor response could not be measured.",
      inputsUsed: [],
    });
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
    expect(scoringWeights).toEqual({
      viralMomentum: 0.4,
      humorResponse: 0.3,
      yardToonzFit: 0.3,
    });
    expect(
      scoreOverall({
        viralMomentum: 100,
        humorResponse: 0,
        yardToonzFit: 0,
      }),
    ).toBe(40);
    expect(
      scoreOverall({
        viralMomentum: 0,
        humorResponse: 100,
        yardToonzFit: 0,
      }),
    ).toBe(30);
  });

  it("bounds component and overall scores and validates chronology", () => {
    const result = scoreCandidate({
      metrics: {
        views: Number.MAX_SAFE_INTEGER,
        likes: Number.MAX_SAFE_INTEGER,
        comments: Number.MAX_SAFE_INTEGER,
        shares: Number.MAX_SAFE_INTEGER,
        saves: Number.MAX_SAFE_INTEGER,
      },
      publishedAt: "2026-09-03T10:00:00.000Z",
      observedAt: "2026-09-03T12:00:00.000Z",
      commentExcerpts: ["😂", "🤣", "lmao", "dead", "weak"],
      fitChecklist: completeFit,
    });

    expect(result.viralMomentum.score).toBeLessThanOrEqual(100);
    expect(result.humorResponse.score).toBeLessThanOrEqual(100);
    expect(result.yardToonzFit.score).toBeLessThanOrEqual(100);
    expect(result.overall).toBeLessThanOrEqual(100);
    expect(() =>
      scoreViralMomentum({
        metrics: { views: 1 },
        publishedAt: "2026-09-03T13:00:00.000Z",
        observedAt: "2026-09-03T12:00:00.000Z",
      }),
    ).toThrow("publishedAt must not be after observedAt");
  });
});
