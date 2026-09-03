import { describe, expect, it } from "vitest";

import {
  buildMockDirectorTreatment,
  confidenceForGaps,
  defaultRecommendedSegmentSeconds,
  directorEvidenceGapMessages,
  directorTreatmentInputSchema,
  directorTreatmentSchema,
  evidenceWeights,
  mockDirectorConfidenceCeiling,
  type DirectorTreatmentInput,
} from "../../src/domain/director";
import { candidateFixtures } from "../../fixtures/candidates";

const validTreatment = {
  humorMechanism:
    "Expectation subversion: the routine the audience knows breaks at the last beat.",
  audienceReactionEvidence: [
    { source: "comment", quote: "Mi cyaan 😂", weight: 0.9 },
  ],
  recommendedSegment: { startSeconds: 0, endSeconds: 6 },
  setupTimestamp: 1.5,
  payoffTimestamp: 4.2,
  adaptationConcept:
    "Single continuous clay scene in the Yard Toonz style: hold the side-eye.",
  claymationPrompt:
    "Claymation keyframe, hand-molded plasticine characters, 9:16 framing.",
  motionPrompt: "Slow push-in with subtle stop-motion jitter.",
  socialCaption: "The bus finally arrives. Rebuilt in clay by Yard Toonz.",
  confidence: 0.8,
  risks: ["Without a transcript, audio jokes may be missed."],
  evidenceGaps: [],
} as const;

const fullInput: DirectorTreatmentInput = {
  candidateId: "cand_bus-stop-001",
  caption: "The bus finally arrives just as everybody gives up waiting.",
  metrics: { views: 94000, likes: 8100, comments: 950, shares: 2600 },
  commentExcerpts: ["Mi cyaan 😂", "The timing weak me", "Too accurate"],
  adaptationNote:
    "Hold on the queue's synchronized side-eye before the payoff.",
  transcript: "Everybody wait on the bus... bus done come now.",
  sourceVideoMetadata: { durationSeconds: 6.3, audioPresent: true },
  keyframes: [{ sourceTimestampSeconds: 3.15 }],
};

function parseFailureTreatment(patch: Record<string, unknown>): unknown {
  return directorTreatmentSchema.safeParse({
    ...validTreatment,
    ...patch,
  });
}

function expectParseFailure(result: unknown): void {
  expect(
    (result as { success: boolean }).success,
    JSON.stringify(result, null, 2),
  ).toBe(false);
}

describe("director treatment schema", () => {
  it("accepts a fully populated treatment at every boundary value", () => {
    const parsed = directorTreatmentSchema.parse({
      ...validTreatment,
      audienceReactionEvidence: [
        { source: "comment", quote: "weak", weight: 0 },
        {
          source: "metric",
          quote: "Received engagement metrics: views 1",
          weight: 1,
        },
      ],
      confidence: 1,
      risks: [],
      evidenceGaps: [],
    });
    expect(parsed.recommendedSegment).toEqual({
      startSeconds: 0,
      endSeconds: 6,
    });
  });

  it("accepts confidence zero and empty risk lists", () => {
    const result = directorTreatmentSchema.safeParse({
      ...validTreatment,
      confidence: 0,
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ["humorMechanism", ""],
    ["humorMechanism", "   "],
    ["adaptationConcept", ""],
    ["claymationPrompt", ""],
    ["motionPrompt", ""],
    ["socialCaption", ""],
  ])("rejects an empty %s", (field, value) => {
    expectParseFailure(parseFailureTreatment({ [field]: value }));
  });

  it("rejects strings beyond the documented maxima", () => {
    expectParseFailure(
      parseFailureTreatment({ humorMechanism: "a".repeat(2001) }),
    );
    expectParseFailure(
      parseFailureTreatment({ socialCaption: "a".repeat(2201) }),
    );
    const captionAtLimit = directorTreatmentSchema.safeParse({
      ...validTreatment,
      socialCaption: "a".repeat(2200),
    });
    expect(captionAtLimit.success).toBe(true);
  });

  it("rejects evidence entries with unknown sources, empty quotes, or out-of-range weights", () => {
    expectParseFailure(
      parseFailureTreatment({
        audienceReactionEvidence: [
          { source: "transcript", quote: "x", weight: 0.5 },
        ],
      }),
    );
    expectParseFailure(
      parseFailureTreatment({
        audienceReactionEvidence: [
          { source: "comment", quote: "  ", weight: 0.5 },
        ],
      }),
    );
    expectParseFailure(
      parseFailureTreatment({
        audienceReactionEvidence: [
          { source: "comment", quote: "x", weight: -0.01 },
        ],
      }),
    );
    expectParseFailure(
      parseFailureTreatment({
        audienceReactionEvidence: [
          { source: "comment", quote: "x", weight: 1.01 },
        ],
      }),
    );
  });

  it("rejects a recommended segment that ends before or at its start", () => {
    expectParseFailure(
      parseFailureTreatment({
        recommendedSegment: { startSeconds: 6, endSeconds: 6 },
      }),
    );
    expectParseFailure(
      parseFailureTreatment({
        recommendedSegment: { startSeconds: 4, endSeconds: 2 },
      }),
    );
    expectParseFailure(
      parseFailureTreatment({
        recommendedSegment: { startSeconds: -0.1, endSeconds: 6 },
      }),
    );
  });

  it("rejects setup or payoff markers outside the recommended segment", () => {
    expectParseFailure(parseFailureTreatment({ setupTimestamp: 7 }));
    expectParseFailure(parseFailureTreatment({ payoffTimestamp: 7 }));
    expectParseFailure(parseFailureTreatment({ setupTimestamp: -1 }));
  });

  it("rejects a payoff that precedes the setup", () => {
    expectParseFailure(
      parseFailureTreatment({ setupTimestamp: 4, payoffTimestamp: 2 }),
    );
  });

  it("allows markers exactly on the segment boundaries in setup order", () => {
    const result = directorTreatmentSchema.safeParse({
      ...validTreatment,
      setupTimestamp: 0,
      payoffTimestamp: 6,
    });
    expect(result.success).toBe(true);
  });

  it("rejects confidence outside zero-to-one", () => {
    expectParseFailure(parseFailureTreatment({ confidence: -0.01 }));
    expectParseFailure(parseFailureTreatment({ confidence: 1.01 }));
  });

  it("rejects risk or gap lists containing empty strings", () => {
    expectParseFailure(parseFailureTreatment({ risks: [""] }));
    expectParseFailure(parseFailureTreatment({ evidenceGaps: [""] }));
  });
});

describe("director input schema", () => {
  it("rejects an empty candidate id or caption", () => {
    expect(
      directorTreatmentInputSchema.safeParse({
        ...fullInput,
        candidateId: "",
      }).success,
    ).toBe(false);
    expect(
      directorTreatmentInputSchema.safeParse({ ...fullInput, caption: " " })
        .success,
    ).toBe(false);
  });

  it("rejects negative engagement metrics through the shared contract", () => {
    const result = directorTreatmentInputSchema.safeParse({
      ...fullInput,
      metrics: { views: -1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys on inputs, metadata, and keyframes", () => {
    expect(
      directorTreatmentInputSchema.safeParse({
        ...fullInput,
        surprise: true,
      }).success,
    ).toBe(false);
    expect(
      directorTreatmentInputSchema.safeParse({
        ...fullInput,
        sourceVideoMetadata: { durationSeconds: 6, audioPresent: true, x: 1 },
      }).success,
    ).toBe(false);
  });

  it("rejects non-positive durations and negative keyframe timestamps", () => {
    expect(
      directorTreatmentInputSchema.safeParse({
        ...fullInput,
        sourceVideoMetadata: { durationSeconds: 0, audioPresent: true },
      }).success,
    ).toBe(false);
    expect(
      directorTreatmentInputSchema.safeParse({
        ...fullInput,
        keyframes: [{ sourceTimestampSeconds: -1 }],
      }).success,
    ).toBe(false);
  });
});

describe("mock director missing-evidence rules", () => {
  it("populates every gap and degrades confidence when only a caption arrives", () => {
    const treatment = buildMockDirectorTreatment({
      candidateId: "cand_bus-stop-001",
      caption: fullInput.caption,
      metrics: {},
      commentExcerpts: [],
    });

    expect(treatment.evidenceGaps).toEqual([
      directorEvidenceGapMessages.commentExcerpts,
      directorEvidenceGapMessages.metrics,
      directorEvidenceGapMessages.transcript,
      directorEvidenceGapMessages.sourceVideoMetadata,
      directorEvidenceGapMessages.keyframes,
    ]);
    expect(treatment.confidence).toBe(0.25);
    expect(
      treatment.audienceReactionEvidence.map((evidence) => evidence.source),
    ).toEqual(["caption"]);
    expect(treatment.audienceReactionEvidence[0]?.quote).toBe(
      fullInput.caption,
    );
  });

  it("quotes every received comment verbatim and never invents others", () => {
    const treatment = buildMockDirectorTreatment(fullInput);
    const received = new Set([...fullInput.commentExcerpts, fullInput.caption]);

    const quotes = treatment.audienceReactionEvidence.map(
      (evidence) => evidence.quote,
    );
    for (const quote of quotes) {
      if (
        treatment.audienceReactionEvidence.find(
          (evidence) => evidence.quote === quote,
        )?.source !== "metric"
      ) {
        expect(received.has(quote)).toBe(true);
      }
    }
    expect(quotes).toContain("Mi cyaan 😂");
    expect(quotes).toContain("The timing weak me");
  });

  it("restates received metrics exactly and adds no numbers of its own", () => {
    const treatment = buildMockDirectorTreatment(fullInput);
    const metricEvidence = treatment.audienceReactionEvidence.find(
      (evidence) => evidence.source === "metric",
    );

    expect(metricEvidence?.quote).toBe(
      "Received engagement metrics: views 94000, likes 8100, comments 950, shares 2600",
    );
    expect(metricEvidence?.weight).toBe(evidenceWeights.metric);
  });

  it("reaches the confidence ceiling only with every evidence category present", () => {
    const treatment = buildMockDirectorTreatment(fullInput);

    expect(treatment.evidenceGaps).toEqual([]);
    expect(treatment.confidence).toBe(mockDirectorConfidenceCeiling);
  });

  it.each([
    ["commentExcerpts", directorEvidenceGapMessages.commentExcerpts, 0.7],
    ["metrics", directorEvidenceGapMessages.metrics, 0.75],
    ["transcript", directorEvidenceGapMessages.transcript, 0.8],
    [
      "sourceVideoMetadata",
      directorEvidenceGapMessages.sourceVideoMetadata,
      0.9,
    ],
    ["keyframes", directorEvidenceGapMessages.keyframes, 0.9],
  ] as const)(
    "degrades confidence by exactly one penalty when %s is absent",
    (category, expectedMessage, expectedConfidence) => {
      const input = { ...fullInput };
      if (category === "commentExcerpts") input.commentExcerpts = [];
      if (category === "metrics") input.metrics = {};
      if (category === "transcript") delete input.transcript;
      if (category === "sourceVideoMetadata") delete input.sourceVideoMetadata;
      if (category === "keyframes") delete input.keyframes;

      const treatment = buildMockDirectorTreatment(input);

      expect(treatment.evidenceGaps).toEqual([expectedMessage]);
      expect(treatment.confidence).toBe(expectedConfidence);
    },
  );

  it("treats an explicit zero metric as supplied data, not absence", () => {
    const treatment = buildMockDirectorTreatment({
      candidateId: "cand_bus-stop-001",
      caption: fullInput.caption,
      metrics: { comments: 0 },
      commentExcerpts: [],
    });

    expect(treatment.evidenceGaps).not.toContain(
      directorEvidenceGapMessages.metrics,
    );
    expect(
      treatment.audienceReactionEvidence.some((evidence) =>
        evidence.quote.includes("comments 0"),
      ),
    ).toBe(true);
  });

  it("weights laughter comments above plain comments", () => {
    const treatment = buildMockDirectorTreatment(fullInput);

    const laughter = treatment.audienceReactionEvidence.find(
      (evidence) => evidence.quote === "Mi cyaan 😂",
    );
    const plain = treatment.audienceReactionEvidence.find(
      (evidence) => evidence.quote === "Too accurate",
    );

    expect(laughter?.weight).toBe(evidenceWeights.commentWithLaughter);
    expect(plain?.weight).toBe(evidenceWeights.comment);
  });

  it("recommends the first six seconds by default and flags shorter sources", () => {
    const withLongSource = buildMockDirectorTreatment({
      ...fullInput,
      sourceVideoMetadata: { durationSeconds: 30, audioPresent: true },
    });
    expect(withLongSource.recommendedSegment).toEqual({
      startSeconds: 0,
      endSeconds: defaultRecommendedSegmentSeconds,
    });

    const withShortSource = buildMockDirectorTreatment({
      ...fullInput,
      sourceVideoMetadata: { durationSeconds: 3, audioPresent: true },
    });
    expect(withShortSource.recommendedSegment).toEqual({
      startSeconds: 0,
      endSeconds: 3,
    });
    expect(withShortSource.risks[0]).toContain("5-second minimum");
    expect(withShortSource.setupTimestamp).toBeLessThanOrEqual(3);
    expect(withShortSource.payoffTimestamp).toBeLessThanOrEqual(3);
    expect(withShortSource.payoffTimestamp).toBeGreaterThan(
      withShortSource.setupTimestamp,
    );
  });

  it("clamps the segment end to the source duration", () => {
    const treatment = buildMockDirectorTreatment({
      ...fullInput,
      sourceVideoMetadata: { durationSeconds: 5.5, audioPresent: true },
    });
    expect(treatment.recommendedSegment).toEqual({
      startSeconds: 0,
      endSeconds: 5.5,
    });
  });

  it("grounds the adaptation concept in the received editorial note", () => {
    const treatment = buildMockDirectorTreatment(fullInput);
    expect(treatment.adaptationConcept).toContain(fullInput.adaptationNote!);
  });
});

describe("mock director determinism", () => {
  it("returns a byte-identical treatment for repeated identical calls", () => {
    const first = buildMockDirectorTreatment(fullInput);
    const second = buildMockDirectorTreatment(fullInput);
    expect(second).toEqual(first);
  });

  it("keys variants to the candidate id across every seed fixture", () => {
    const mechanisms = new Set<string>();
    for (const fixture of candidateFixtures) {
      const input: DirectorTreatmentInput = {
        candidateId: fixture.id,
        caption: fixture.caption,
        metrics: fixture.metrics,
        commentExcerpts: fixture.commentExcerpts,
        adaptationNote: fixture.adaptationNote,
      };
      const first = buildMockDirectorTreatment(input);
      const second = buildMockDirectorTreatment(input);
      expect(second).toEqual(first);
      mechanisms.add(first.humorMechanism);
    }
    expect(mechanisms.size).toBeGreaterThan(1);
  });

  it("is independent of call order", () => {
    const other: DirectorTreatmentInput = {
      candidateId: "cand-rain-laundry-003",
      caption: "Fresh laundry meets the first sudden drop of rain.",
      metrics: {},
      commentExcerpts: [],
    };

    const before = buildMockDirectorTreatment(fullInput);
    buildMockDirectorTreatment(other);
    const after = buildMockDirectorTreatment(fullInput);
    expect(after).toEqual(before);
  });
});

describe("confidence helper", () => {
  it("clamps confidence at zero when every category is missing twice over", () => {
    const gaps = Object.keys(
      directorEvidenceGapMessages,
    ) as (keyof typeof directorEvidenceGapMessages)[];
    expect(confidenceForGaps([...gaps, ...gaps])).toBeGreaterThanOrEqual(0);
  });

  it("never exposes fractional float dust", () => {
    const value = confidenceForGaps(["commentExcerpts"]);
    expect(Number.isInteger(value * 100)).toBe(true);
  });
});

describe("treatment parse round-trip", () => {
  it("accepts the builder output through the public contract", () => {
    const treatment = buildMockDirectorTreatment(fullInput);
    expect(directorTreatmentSchema.safeParse(treatment).success).toBe(true);
  });

  it("rejects hand-built treatments whose payoff escapes the segment", () => {
    const treatment = buildMockDirectorTreatment(fullInput);
    const result = directorTreatmentSchema.safeParse({
      ...treatment,
      payoffTimestamp: treatment.recommendedSegment.endSeconds + 10,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain("payoffTimestamp");
    }
  });
});
