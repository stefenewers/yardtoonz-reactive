import { describe, expect, it } from "vitest";

import {
  agentKeyForStage,
  animatedFrameRunDecision,
  directorRunEvidence,
  failedRunDecision,
  humorAnalystEvidence,
  modelLabelFromMetadata,
  stageCompleteConfidence,
  stageCompleteDecision,
  stageCompleteEvidence,
  stageFailedEvidence,
  stageProviderForRun,
  stageRunEvidence,
  styledFrameRunDecision,
  trendScoutEvidence,
  validationRunDecision,
  validationRunEvidence,
} from "../../src/domain/agent-trace";
import { computeOutputQaScore } from "../../src/domain/production";
import { SCORING_VERSION } from "../../src/domain/scoring";

/** A fully-passing seven-factor QA score fixture for report construction. */
function passingQaScore() {
  return computeOutputQaScore({
    width: 1080,
    height: 1920,
    audioPresent: true,
    durationSeconds: 6,
    framePreservation: true,
    imageProvider: "OPENAI",
    animationProvider: "RUNWAY",
    artifacts: [
      "SOURCE_VIDEO",
      "EXTRACTED_CLIP",
      "EXTRACTED_AUDIO",
      "KEYFRAME",
      "STYLED_FRAME",
      "SILENT_ANIMATION",
      "FINAL_VIDEO",
    ].map((kind) => ({
      kind,
      provider:
        kind === "STYLED_FRAME"
          ? "OPENAI"
          : kind === "SILENT_ANIMATION"
            ? "RUNWAY"
            : "MOCK",
      byteSize: 10,
    })),
  });
}

const mockSelection = {
  imageProvider: "MOCK",
  animationProvider: "RUNWAY",
} as const;

describe("agent key mapping", () => {
  it("maps pipeline stages onto the named agents that own their work", () => {
    expect(agentKeyForStage("STYLE_IMAGE")).toBe("clay-artist");
    expect(agentKeyForStage("ANIMATE_IMAGE")).toBe("animator");
    expect(agentKeyForStage("VALIDATE_OUTPUT")).toBe("qa-inspector");
  });

  it("maps extraction, keyframe, and muxing stages to no named agent", () => {
    expect(agentKeyForStage("EXTRACT_SEGMENT")).toBeNull();
    expect(agentKeyForStage("SELECT_KEYFRAME")).toBeNull();
    expect(agentKeyForStage("MUX_AUDIO")).toBeNull();
    expect(agentKeyForStage("NOT_A_STAGE")).toBeNull();
  });
});

describe("stage provider attribution", () => {
  it("attributes the persisted job selection, never the environment", () => {
    expect(stageProviderForRun("STYLE_IMAGE", mockSelection)).toBe("MOCK");
    expect(stageProviderForRun("ANIMATE_IMAGE", mockSelection)).toBe("RUNWAY");
  });

  it("claims no provider for output validation", () => {
    expect(stageProviderForRun("VALIDATE_OUTPUT", mockSelection)).toBeNull();
    expect(stageProviderForRun("EXTRACT_SEGMENT", mockSelection)).toBeNull();
  });
});

describe("model label extraction", () => {
  it("prefers the live provider's model name", () => {
    expect(
      modelLabelFromMetadata({ model: "gpt-image-1", styleVersion: "v1" }),
    ).toBe("gpt-image-1");
  });

  it("falls back to the deterministic pipeline versions the mock executors record", () => {
    expect(modelLabelFromMetadata({ styleVersion: "mock-style-v1" })).toBe(
      "mock-style-v1",
    );
    expect(modelLabelFromMetadata({ motionVersion: "mock-zoompan-v1" })).toBe(
      "mock-zoompan-v1",
    );
  });

  it("returns null when no string label is disclosed", () => {
    expect(modelLabelFromMetadata({})).toBeNull();
    expect(
      modelLabelFromMetadata({ model: 42, styleVersion: null }),
    ).toBeNull();
    expect(modelLabelFromMetadata({ model: "   " })).toBeNull();
  });
});

describe("decision text", () => {
  it("states what the creative agents did and with which provider", () => {
    expect(styledFrameRunDecision("MOCK")).toBe(
      "Styled the keyframe with the MOCK image provider.",
    );
    expect(animatedFrameRunDecision("RUNWAY")).toBe(
      "Animated the styled frame with the RUNWAY animation provider.",
    );
  });

  it("quotes the validation report scalars and QA score for a passed QA gate", () => {
    expect(
      validationRunDecision({
        width: 1080,
        height: 1920,
        durationSeconds: 6,
        outputQa: passingQaScore(),
      }),
    ).toBe(
      "Validated the final output: 1080x1920 9:16, audio present, 6s duration; 7/7 QA factors passed.",
    );
  });

  it("dispatches per stage and refuses to fabricate a provider or report", () => {
    expect(
      stageCompleteDecision({
        stageName: "STYLE_IMAGE",
        provider: "OPENAI",
      }),
    ).toBe("Styled the keyframe with the OPENAI image provider.");
    expect(
      stageCompleteDecision({ stageName: "STYLE_IMAGE", provider: null }),
    ).toBeUndefined();
    expect(
      stageCompleteDecision({
        stageName: "VALIDATE_OUTPUT",
        provider: null,
      }),
    ).toBeUndefined();
    expect(
      stageCompleteDecision({ stageName: "EXTRACT_SEGMENT", provider: "MOCK" }),
    ).toBeUndefined();
  });

  it("quotes the bounded safe error message verbatim for failures", () => {
    expect(
      failedRunDecision("A media processing step failed for this stage."),
    ).toBe("A media processing step failed for this stage.");
  });
});

describe("run confidence", () => {
  it("reports certainty only for the deterministic QA pass", () => {
    expect(stageCompleteConfidence("VALIDATE_OUTPUT")).toBe(1);
    expect(stageCompleteConfidence("STYLE_IMAGE")).toBeUndefined();
    expect(stageCompleteConfidence("ANIMATE_IMAGE")).toBeUndefined();
  });
});

describe("evidence builders", () => {
  it("records what the momentum pass actually received", () => {
    expect(
      trendScoutEvidence({
        platform: "tiktok",
        suppliedMetricCount: 3,
        publishedAtSupplied: true,
      }),
    ).toEqual({
      platform: "tiktok",
      suppliedMetricCount: 3,
      publishedAtSupplied: true,
      scoringVersion: SCORING_VERSION,
    });
  });

  it("records the humor corpus size and scoring version", () => {
    expect(humorAnalystEvidence({ commentCount: 4 })).toEqual({
      commentCount: 4,
      scoringVersion: SCORING_VERSION,
    });
  });

  it("counts only the metrics the Director actually received", () => {
    expect(
      directorRunEvidence({
        provider: "MOCK",
        metrics: { views: 1000, likes: 50 },
        commentCount: 2,
        adaptationNoteSupplied: true,
        transcriptSupplied: false,
        sourceVideoMetadataSupplied: false,
        keyframeCount: 0,
        creativeDirectionSupplied: false,
      }),
    ).toEqual({
      provider: "MOCK",
      metricCount: 2,
      commentCount: 2,
      adaptationNoteSupplied: true,
      transcriptSupplied: false,
      sourceVideoMetadataSupplied: false,
      keyframeCount: 0,
      creativeDirectionSupplied: false,
    });
  });

  it("keeps stage evidence to the fingerprint and merges QA report scalars", () => {
    expect(stageRunEvidence({ fingerprint: "abc123" })).toEqual({
      fingerprint: "abc123",
    });
    const report = {
      playable: true,
      width: 1080,
      height: 1920,
      durationSeconds: 6,
      audioPresent: true,
      outputQa: passingQaScore(),
    } as const;
    expect(
      stageCompleteEvidence({
        stageName: "VALIDATE_OUTPUT",
        fingerprint: "abc123",
        validationReport: report,
      }),
    ).toEqual({
      fingerprint: "abc123",
      playable: true,
      width: 1080,
      height: 1920,
      durationSeconds: 6,
      audioPresent: true,
      outputQaPassed: true,
      outputQaPassedCount: 7,
    });
    expect(
      stageCompleteEvidence({
        stageName: "STYLE_IMAGE",
        fingerprint: "abc123",
        validationReport: report,
      }),
    ).toEqual({ fingerprint: "abc123" });
    expect(validationRunEvidence(report).playable).toBe(true);
  });

  it("records the bounded error classification for failed runs", () => {
    expect(
      stageFailedEvidence({ errorCode: "MEDIA_PROCESSING_FAILED" }),
    ).toEqual({ errorCode: "MEDIA_PROCESSING_FAILED" });
  });
});
