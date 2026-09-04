import { describe, expect, it } from "vitest";

import {
  computeOutputQaScore,
  outputQaFactorKeys,
  type OutputQaFactorKey,
} from "../../src/domain/production";

type ScoreInput = Parameters<typeof computeOutputQaScore>[0];

const baseArtifacts = [
  "SOURCE_VIDEO",
  "EXTRACTED_CLIP",
  "EXTRACTED_AUDIO",
  "KEYFRAME",
  "STYLED_FRAME",
  "SILENT_ANIMATION",
  "FINAL_VIDEO",
].map((kind) => ({ kind, provider: "MOCK", byteSize: 100 }));

const passing: ScoreInput = {
  width: 360,
  height: 640,
  audioPresent: true,
  durationSeconds: 6,
  framePreservation: true,
  imageProvider: "MOCK",
  animationProvider: "MOCK",
  artifacts: baseArtifacts,
};

describe("computeOutputQaScore", () => {
  it("scores exactly the seven documented factors", () => {
    expect(outputQaFactorKeys).toHaveLength(7);
    const score = computeOutputQaScore(passing);
    expect(Object.keys(score.factors)).toHaveLength(7);
    expect(score.passed).toBe(true);
  });

  it.each([
    ["verticalDimensions", "verticalDimensions", { width: 640, height: 360 }],
    ["audioPresent", "audioPresent", { audioPresent: false }],
    ["durationInRange", "durationInRange", { durationSeconds: 4 }],
    [
      "durationInRange above the window",
      "durationInRange",
      { durationSeconds: 9 },
    ],
    ["framePreservation", "framePreservation", { framePreservation: false }],
  ] satisfies [string, OutputQaFactorKey, Partial<ScoreInput>][])(
    "fails %s when its observed fact is off",
    (_label, factorKey, overrides) => {
      const score = computeOutputQaScore({ ...passing, ...overrides });
      expect(score.passed).toBe(false);
      expect(score.factors[factorKey]).toBe(false);
      // The other six factors stay true.
      for (const [key, value] of Object.entries(score.factors)) {
        if (key !== factorKey) expect(value).toBe(true);
      }
    },
  );

  it("fails provider attribution when artifact providers diverge from the persisted selections", () => {
    const score = computeOutputQaScore({
      ...passing,
      imageProvider: "OPENAI",
      animationProvider: "RUNWAY",
      artifacts: baseArtifacts.map((artifact) =>
        artifact.kind === "STYLED_FRAME"
          ? { ...artifact, provider: "OPENAI" }
          : artifact.kind === "SILENT_ANIMATION"
            ? { ...artifact, provider: "MOCK" }
            : artifact,
      ),
    });
    expect(score.factors.providerAttribution).toBe(false);
    expect(score.passed).toBe(false);
  });

  it("passes provider attribution when artifacts match the persisted selections", () => {
    const score = computeOutputQaScore({
      ...passing,
      imageProvider: "OPENAI",
      animationProvider: "RUNWAY",
      artifacts: baseArtifacts.map((artifact) =>
        artifact.kind === "STYLED_FRAME"
          ? { ...artifact, provider: "OPENAI" }
          : artifact.kind === "SILENT_ANIMATION"
            ? { ...artifact, provider: "RUNWAY" }
            : artifact,
      ),
    });
    expect(score.factors.providerAttribution).toBe(true);
    expect(score.passed).toBe(true);
  });

  it("fails artifact lineage when a chain artifact row is missing", () => {
    const score = computeOutputQaScore({
      ...passing,
      artifacts: baseArtifacts.filter(
        (artifact) => artifact.kind !== "KEYFRAME",
      ),
    });
    expect(score.factors.artifactLineage).toBe(false);
    expect(score.factors.framePreservation).toBe(true);
    expect(score.passed).toBe(false);
  });

  it("fails download readiness when the final video carries no stored bytes", () => {
    const score = computeOutputQaScore({
      ...passing,
      artifacts: baseArtifacts.map((artifact) =>
        artifact.kind === "FINAL_VIDEO"
          ? { ...artifact, byteSize: 0 }
          : artifact,
      ),
    });
    expect(score.factors.downloadReady).toBe(false);
    expect(score.passed).toBe(false);
  });

  it("keeps factors independent so a broken chain does not mask others", () => {
    const score = computeOutputQaScore({
      ...passing,
      framePreservation: false,
      artifacts: baseArtifacts.filter(
        (artifact) => artifact.kind !== "STYLED_FRAME",
      ),
      audioPresent: false,
    });
    expect(score.passed).toBe(false);
    expect(score.factors.framePreservation).toBe(false);
    expect(score.factors.artifactLineage).toBe(false);
    expect(score.factors.audioPresent).toBe(false);
    expect(score.factors.verticalDimensions).toBe(true);
    expect(score.factors.downloadReady).toBe(true);
  });
});
