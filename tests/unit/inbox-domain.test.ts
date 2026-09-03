import { describe, expect, it } from "vitest";

import type { Candidate } from "../../src/domain/candidate";
import {
  defaultInboxSort,
  formatSourceAge,
  healthDisplay,
  humanizeProvider,
  nextSortState,
  overallWeightingSummary,
  platformLabels,
  providerModeLabel,
  sortCandidates,
  sortDescription,
} from "../../src/domain/inbox";

function makeCandidate(input: {
  id: string;
  overall: number;
  viralMomentum?: number;
  status?: Candidate["status"];
  publishedAt?: string;
}): Candidate {
  const viralMomentum = input.viralMomentum ?? input.overall;
  return {
    id: input.id,
    platform: "TIKTOK",
    sourceLabel: `Source ${input.id}`,
    caption: `Caption for ${input.id}`,
    publishedAt: input.publishedAt,
    metrics: { views: 1_000, likes: 100 },
    commentExcerpts: [],
    scores: {
      viralMomentum: {
        score: viralMomentum,
        explanation: "viral momentum explanation",
        inputsUsed: ["views"],
      },
      humorResponse: {
        score: input.overall,
        explanation: "humor explanation",
        inputsUsed: [],
      },
      yardToonzFit: {
        score: input.overall,
        explanation: "fit explanation",
        inputsUsed: ["clearPremise"],
      },
      overall: input.overall,
      scoringVersion: "candidate-v1",
    },
    status: input.status ?? "NEW",
  };
}

describe("candidate sorting", () => {
  it("ranks by overall score, highest first by default", () => {
    const ranked = sortCandidates([
      makeCandidate({ id: "low", overall: 60 }),
      makeCandidate({ id: "high", overall: 90 }),
      makeCandidate({ id: "middle", overall: 75 }),
    ]);

    expect(ranked.map(({ id }) => id)).toEqual(["high", "middle", "low"]);
  });

  it("sorts by component score in the requested direction", () => {
    const candidates = [
      makeCandidate({ id: "a", overall: 90, viralMomentum: 50 }),
      makeCandidate({ id: "b", overall: 60, viralMomentum: 95 }),
    ];

    expect(
      sortCandidates(candidates, {
        sort: "viralMomentum",
        order: "desc",
      }).map(({ id }) => id),
    ).toEqual(["b", "a"]);
    expect(
      sortCandidates(candidates, {
        sort: "viralMomentum",
        order: "asc",
      }).map(({ id }) => id),
    ).toEqual(["a", "b"]);
  });

  it("breaks ties deterministically by id", () => {
    const tied = [
      makeCandidate({ id: "b", overall: 80 }),
      makeCandidate({ id: "a", overall: 80 }),
    ];

    expect(sortCandidates(tied).map(({ id }) => id)).toEqual(["a", "b"]);
  });
});

describe("sort state transitions", () => {
  it("toggles direction on the active column", () => {
    expect(nextSortState("overall", defaultInboxSort)).toEqual({
      field: "overall",
      order: "asc",
    });
    expect(
      nextSortState("overall", { field: "overall", order: "asc" }),
    ).toEqual({ field: "overall", order: "desc" });
  });

  it("starts a new column at highest first", () => {
    expect(
      nextSortState("humorResponse", { field: "overall", order: "asc" }),
    ).toEqual({ field: "humorResponse", order: "desc" });
  });

  it("describes the active sort for the live region", () => {
    expect(sortDescription(defaultInboxSort)).toBe(
      "sorted by overall score, highest first",
    );
    expect(sortDescription({ field: "yardToonzFit", order: "asc" })).toBe(
      "sorted by Yard Toonz fit, lowest first",
    );
  });
});

describe("source age formatting", () => {
  const nowMs = Date.parse("2026-09-03T12:00:00.000Z");

  it("reports missing, invalid, and future timestamps honestly", () => {
    expect(formatSourceAge(undefined, nowMs)).toBe("Age not supplied");
    expect(formatSourceAge("not-a-date", nowMs)).toBe("Age not supplied");
    expect(formatSourceAge("2026-09-03T15:00:00.000Z", nowMs)).toBe(
      "Age not supplied",
    );
  });

  it("formats hours, days, and weeks", () => {
    expect(formatSourceAge("2026-09-03T09:00:00.000Z", nowMs)).toBe("3h");
    expect(formatSourceAge("2026-09-01T12:00:00.000Z", nowMs)).toBe("2d");
    expect(formatSourceAge("2026-08-13T12:00:00.000Z", nowMs)).toBe("3w");
  });
});

describe("provider display", () => {
  it("humanizes each provider honestly, including live mode", () => {
    expect(humanizeProvider("MOCK")).toBe("Mock");
    expect(humanizeProvider("OPENAI")).toBe("OpenAI (live)");
    expect(humanizeProvider("RUNWAY")).toBe("Runway (live)");
  });

  it("labels mock, live, and hybrid configurations", () => {
    expect(providerModeLabel("MOCK", "MOCK")).toBe("Mock mode");
    expect(providerModeLabel("OPENAI", "RUNWAY")).toBe("Live mode");
    expect(providerModeLabel("OPENAI", "MOCK")).toBe("Hybrid mode");
    expect(providerModeLabel("MOCK", "RUNWAY")).toBe("Hybrid mode");
  });

  it("covers every platform label", () => {
    expect(Object.keys(platformLabels).sort()).toEqual([
      "INSTAGRAM",
      "OTHER",
      "TIKTOK",
      "YOUTUBE",
    ]);
  });
});

describe("overall weighting and health display", () => {
  it("states the 40/30/30 weighting from the scoring constants", () => {
    expect(overallWeightingSummary()).toBe(
      "Overall = 40% viral momentum + 30% humor response + 30% Yard Toonz fit",
    );
  });

  it("maps health to bounded, human-readable categories", () => {
    expect(healthDisplay({ status: "ok" }, false)).toEqual({
      label: "System ready",
      tone: "ok",
    });
    expect(healthDisplay({ status: "degraded" }, false)).toEqual({
      label: "System degraded",
      tone: "degraded",
    });
    expect(healthDisplay(undefined, true)).toEqual({
      label: "Health unavailable",
      tone: "unavailable",
    });
    expect(healthDisplay(undefined, false)).toEqual({
      label: "Checking health…",
      tone: "pending",
    });
  });
});
