import { describe, expect, it } from "vitest";

import {
  evaluateSegmentDraft,
  evaluateSourceFile,
  maxSegmentSeconds,
  minSegmentSeconds,
  segmentMarkerPercents,
  segmentProblemMessages,
  sourceFactsFromMetadata,
  sourceProblemMessages,
  treatmentSetupPrefill,
} from "../../src/domain/production-setup";

describe("evaluateSegmentDraft", () => {
  it("accepts a 5-8 second segment without a probed source", () => {
    const evaluation = evaluateSegmentDraft({
      startSeconds: 2,
      endSeconds: 8,
    });
    expect(evaluation).toEqual({
      valid: true,
      segment: { startSeconds: 2, endSeconds: 8, durationSeconds: 6 },
    });
  });

  it("accepts the exact 5 and 8 second boundaries", () => {
    expect(
      evaluateSegmentDraft({ startSeconds: 0, endSeconds: minSegmentSeconds })
        .valid,
    ).toBe(true);
    expect(
      evaluateSegmentDraft({ startSeconds: 0, endSeconds: maxSegmentSeconds })
        .valid,
    ).toBe(true);
  });

  it("accepts a segment that ends inside the probed source", () => {
    const evaluation = evaluateSegmentDraft({
      startSeconds: 1,
      endSeconds: 7,
      sourceDurationSeconds: 12.4,
    });
    expect(evaluation).toEqual({
      valid: true,
      segment: { startSeconds: 1, endSeconds: 7, durationSeconds: 6 },
    });
  });

  it("rejects segments shorter than 5 seconds", () => {
    expect(evaluateSegmentDraft({ startSeconds: 0, endSeconds: 3 })).toEqual({
      valid: false,
      problems: ["SEGMENT_TOO_SHORT"],
    });
  });

  it("rejects segments longer than 8 seconds", () => {
    expect(evaluateSegmentDraft({ startSeconds: 0, endSeconds: 9 })).toEqual({
      valid: false,
      problems: ["SEGMENT_TOO_LONG"],
    });
  });

  it("rejects segments that end past the probed source duration", () => {
    expect(
      evaluateSegmentDraft({
        startSeconds: 0,
        endSeconds: 7,
        sourceDurationSeconds: 6.3,
      }),
    ).toEqual({
      valid: false,
      problems: ["EXCEEDS_SOURCE"],
    });
  });

  it("rejects ends that do not come after the start", () => {
    expect(evaluateSegmentDraft({ startSeconds: 6, endSeconds: 2 })).toEqual({
      valid: false,
      problems: ["END_NOT_AFTER_START"],
    });
    expect(evaluateSegmentDraft({ startSeconds: 4, endSeconds: 4 })).toEqual({
      valid: false,
      problems: ["END_NOT_AFTER_START"],
    });
    expect(evaluateSegmentDraft({ startSeconds: -1, endSeconds: 6 })).toEqual({
      valid: false,
      problems: ["END_NOT_AFTER_START"],
    });
  });

  it("rejects blank numeric inputs", () => {
    expect(
      evaluateSegmentDraft({ startSeconds: Number.NaN, endSeconds: 6 }),
    ).toEqual({ valid: false, problems: ["END_NOT_AFTER_START"] });
    expect(
      evaluateSegmentDraft({ startSeconds: 0, endSeconds: Number.NaN }),
    ).toEqual({ valid: false, problems: ["END_NOT_AFTER_START"] });
  });
});

describe("segmentProblemMessages", () => {
  it("explains every problem in user-facing language", () => {
    expect(segmentProblemMessages.END_NOT_AFTER_START).toContain(
      "end must come after",
    );
    expect(segmentProblemMessages.SEGMENT_TOO_SHORT).toContain("at least 5");
    expect(segmentProblemMessages.SEGMENT_TOO_LONG).toContain("at most 8");
    expect(segmentProblemMessages.EXCEEDS_SOURCE).toContain(
      "inside the uploaded source video",
    );
  });
});

describe("evaluateSourceFile", () => {
  it("accepts a non-empty MP4 within the limit", () => {
    expect(evaluateSourceFile({ type: "video/mp4", size: 1024 }, 100)).toEqual(
      [],
    );
    expect(
      evaluateSourceFile({ type: "video/mp4; codecs=avc1", size: 2048 }, 100),
    ).toEqual([]);
  });

  it("rejects wrong content types", () => {
    expect(evaluateSourceFile({ type: "video/quicktime", size: 1024 }, 100)) //
      .toEqual(["NOT_MP4"]);
  });

  it("rejects empty files", () => {
    expect(evaluateSourceFile({ type: "video/mp4", size: 0 }, 100)).toEqual([
      "EMPTY_FILE",
    ]);
  });

  it("rejects files over the configured limit", () => {
    const oversized = 2 * 1024 * 1024;
    expect(evaluateSourceFile({ type: "video/mp4", size: oversized }, 1)) //
      .toEqual(["TOO_LARGE"]);
  });
});

describe("sourceProblemMessages", () => {
  it("formats each problem with the configured limit", () => {
    const messages = sourceProblemMessages(
      ["NOT_MP4", "EMPTY_FILE", "TOO_LARGE"],
      42,
    );
    expect(messages[0]).toContain("MP4 video file");
    expect(messages[1]).toContain("empty");
    expect(messages[2]).toContain("42 MB");
  });
});

describe("sourceFactsFromMetadata", () => {
  it("reads probed values from the source artifact metadata", () => {
    expect(
      sourceFactsFromMetadata({
        durationSeconds: 12.4,
        audioPresent: true,
        width: 1080,
        height: 1920,
        videoCodec: "avc1",
      }),
    ).toEqual({
      durationSeconds: 12.4,
      audioPresent: true,
      width: 1080,
      height: 1920,
    });
  });

  it("ignores mistyped or missing entries instead of guessing", () => {
    expect(
      sourceFactsFromMetadata({
        durationSeconds: "12.4",
        audioPresent: null,
        width: 1080,
      }),
    ).toEqual({ width: 1080 });
    expect(sourceFactsFromMetadata(undefined)).toEqual({});
  });
});

describe("treatmentSetupPrefill", () => {
  it("seeds the segment inputs and creative direction from the treatment", () => {
    expect(
      treatmentSetupPrefill({
        startSeconds: 1.5,
        endSeconds: 7.5,
        setupTimestamp: 2.5,
        payoffTimestamp: 7,
        adaptationConcept: "Lean into the deadpan reaction.",
      }),
    ).toEqual({
      startInput: "1.5",
      endInput: "7.5",
      creativeDirection: "Lean into the deadpan reaction.",
    });
  });
});

describe("segmentMarkerPercents", () => {
  it("positions markers proportionally across the segment span", () => {
    expect(
      segmentMarkerPercents({
        startSeconds: 1,
        endSeconds: 5,
        setupTimestamp: 2,
        payoffTimestamp: 5,
      }),
    ).toEqual({ setupPercent: 25, payoffPercent: 100 });
  });

  it("clamps markers that fall outside the segment onto its edges", () => {
    expect(
      segmentMarkerPercents({
        startSeconds: 2,
        endSeconds: 8,
        setupTimestamp: 0.5,
        payoffTimestamp: 30,
      }),
    ).toEqual({ setupPercent: 0, payoffPercent: 100 });
  });

  it("returns zero positions instead of dividing by a zero-width span", () => {
    expect(
      segmentMarkerPercents({
        startSeconds: 3,
        endSeconds: 3,
        setupTimestamp: 2,
        payoffTimestamp: 4,
      }),
    ).toEqual({ setupPercent: 0, payoffPercent: 0 });
  });
});
