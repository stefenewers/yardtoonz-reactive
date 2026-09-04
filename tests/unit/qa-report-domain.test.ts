import { describe, expect, it } from "vitest";

import type { ArtifactKind } from "@/domain/production";
import {
  qaCheckKeys,
  qaCheckLabels,
  qaRunnerVersion,
  qaSeverities,
  runQaReport,
  type QaArtifactFact,
  type QaCheckResult,
  type QaReportInput,
} from "@/domain/qa-report";

/**
 * Deterministic fixture facts for a COMPLETE MOCK/MOCK production: every
 * artifact kind present, a coherent parent chain, probe metadata that
 * satisfies all ten checks, and both caption sources populated.
 */

const FIXTURE_SHA = "a".repeat(64);

const ARTIFACT_IDS: Record<ArtifactKind, string> = {
  SOURCE_VIDEO: "art_source_video",
  EXTRACTED_CLIP: "art_extracted_clip",
  EXTRACTED_AUDIO: "art_extracted_audio",
  KEYFRAME: "art_keyframe",
  STYLED_FRAME: "art_styled_frame",
  SILENT_ANIMATION: "art_silent_animation",
  FINAL_VIDEO: "art_final_video",
};

const ARTIFACT_ORDER = Object.keys(ARTIFACT_IDS) as ArtifactKind[];

function parentIdsBefore(kind: ArtifactKind): string[] {
  const index = ARTIFACT_ORDER.indexOf(kind);
  return ARTIFACT_ORDER.slice(0, index).map(
    (previous) => ARTIFACT_IDS[previous],
  );
}

function baseFact(kind: ArtifactKind): QaArtifactFact {
  const base: QaArtifactFact = {
    id: ARTIFACT_IDS[kind],
    kind,
    provider: "FFMPEG",
    providerRequestId: null,
    mimeType: "video/mp4",
    byteSize: 1024,
    sha256: FIXTURE_SHA,
    parentArtifactIds: parentIdsBefore(kind),
    storagePresent: true,
    metadata: {},
  };

  switch (kind) {
    case "SOURCE_VIDEO":
      return { ...base, provider: "USER_UPLOAD", mimeType: "video/mp4" };
    case "EXTRACTED_CLIP":
      return {
        ...base,
        metadata: {
          durationSeconds: 6.0,
          width: 360,
          height: 640,
          videoCodec: "h264",
          audioCodec: "aac",
          audioPresent: true,
        },
      };
    case "EXTRACTED_AUDIO":
      return {
        ...base,
        mimeType: "audio/mp4",
        metadata: {
          durationSeconds: 6.0,
          audioCodec: "aac",
          audioPresent: true,
        },
      };
    case "KEYFRAME":
      return {
        ...base,
        mimeType: "image/png",
        metadata: { sourceTimestampSeconds: 3 },
      };
    case "STYLED_FRAME":
      return {
        ...base,
        provider: "MOCK",
        mimeType: "image/png",
        metadata: { styledBy: "MOCK", styleVersion: "mock-style-v1" },
      };
    case "SILENT_ANIMATION":
      return {
        ...base,
        provider: "MOCK",
        metadata: {
          durationSeconds: 6.0,
          width: 360,
          height: 640,
          videoCodec: "h264",
          audioCodec: null,
          audioPresent: false,
          motion: "zoompan",
          fps: 24,
        },
      };
    case "FINAL_VIDEO":
      return {
        ...base,
        metadata: {
          durationSeconds: 6.0,
          width: 360,
          height: 640,
          videoCodec: "h264",
          audioCodec: "aac",
          audioPresent: true,
        },
      };
  }
}

function baseInput(): QaReportInput {
  return {
    production: {
      id: "prod_qa_fixture",
      candidateId: "cand_qa_fixture",
      status: "COMPLETE",
      imageProvider: "MOCK",
      animationProvider: "MOCK",
      segmentDurationMs: 6000,
    },
    artifacts: ARTIFACT_ORDER.map(baseFact),
    captions: {
      caption: "Rain ruined laundry day",
      socialCaption: "When the rain picks your laundry day 🤣",
    },
  };
}

/** Patch one artifact kind's fact (or drop it with `undefined`). */
function withArtifact(
  input: QaReportInput,
  kind: ArtifactKind,
  patch: Partial<QaArtifactFact> | undefined,
): QaReportInput {
  const artifacts = input.artifacts
    .map((artifact) =>
      artifact.kind === kind && patch ? { ...artifact, ...patch } : artifact,
    )
    .filter((artifact) => artifact.kind !== kind || patch !== undefined);
  return { ...input, artifacts };
}

function resultOf(
  report: readonly QaCheckResult[],
  key: string,
): QaCheckResult {
  const result = report.find((check) => check.key === key);
  if (!result) throw new Error(`Missing ${key} in report`);
  return result;
}

describe("qa report runner — happy path", () => {
  it("passes all ten checks for a complete, conformant production", () => {
    const report = runQaReport(baseInput());

    expect(report.checks.map((check) => check.key)).toEqual([...qaCheckKeys]);
    expect(report.checks.every((check) => check.status === "PASS")).toBe(true);
    expect(report.overallStatus).toBe("PASS");
    expect(report.score).toBe(100);
    expect(report.runnerVersion).toBe(qaRunnerVersion);
  });

  it("labels every check with its human-readable label", () => {
    const report = runQaReport(baseInput());
    for (const check of report.checks) {
      expect(check.label).toBe(qaCheckLabels[check.key]);
      expect(check.detail.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic: identical facts yield an identical report", () => {
    const first = runQaReport(baseInput());
    const second = runQaReport(baseInput());
    expect(second).toEqual(first);
  });

  it("rejects malformed facts (unknown kind, unknown fields)", () => {
    expect(() =>
      runQaReport({
        ...baseInput(),
        artifacts: [
          { ...baseFact("FINAL_VIDEO"), kind: "NOT_A_KIND" },
        ] as never,
      }),
    ).toThrow();
    expect(() =>
      runQaReport({ ...baseInput(), extra: true } as never),
    ).toThrow();
  });
});

describe("qa report runner — aspect-ratio", () => {
  it("fails critical on non-9:16 dimensions", () => {
    const report = runQaReport(
      withArtifact(baseInput(), "FINAL_VIDEO", {
        metadata: {
          durationSeconds: 6,
          width: 360,
          height: 240,
          audioPresent: true,
          videoCodec: "h264",
        },
      }),
    );
    const result = resultOf(report.checks, "aspect-ratio");
    expect(result.status).toBe("FAIL");
    expect(result.severity).toBe("CRITICAL");
    expect(result.remediation).toMatch(/9:16/);
  });

  it("fails critical when dimensions are missing", () => {
    const report = runQaReport(
      withArtifact(baseInput(), "FINAL_VIDEO", {
        metadata: {
          durationSeconds: 6,
          width: null,
          height: null,
          audioPresent: true,
        },
      }),
    );
    const result = resultOf(report.checks, "aspect-ratio");
    expect(result.status).toBe("FAIL");
    expect(result.severity).toBe("CRITICAL");
  });

  it("defers with an INFO warning when no final video exists yet", () => {
    const report = runQaReport(
      withArtifact(baseInput(), "FINAL_VIDEO", undefined),
    );
    const result = resultOf(report.checks, "aspect-ratio");
    expect(result.status).toBe("WARN");
    expect(result.severity).toBe("INFO");
    expect(result.remediation).toBeTruthy();
  });
});

describe("qa report runner — audio-presence", () => {
  it("passes when the final output carries audio", () => {
    const report = runQaReport(baseInput());
    expect(resultOf(report.checks, "audio-presence").status).toBe("PASS");
  });

  it("fails critical when the audio stream is absent", () => {
    const report = runQaReport(
      withArtifact(baseInput(), "FINAL_VIDEO", {
        metadata: {
          durationSeconds: 6,
          width: 360,
          height: 640,
          videoCodec: "h264",
          audioPresent: false,
        },
      }),
    );
    const result = resultOf(report.checks, "audio-presence");
    expect(result.status).toBe("FAIL");
    expect(result.severity).toBe("CRITICAL");
    expect(result.remediation).toMatch(/authorized audio/);
  });

  it("defers when no final video exists", () => {
    const report = runQaReport(
      withArtifact(baseInput(), "FINAL_VIDEO", undefined),
    );
    const result = resultOf(report.checks, "audio-presence");
    expect(result.status).toBe("WARN");
    expect(result.severity).toBe("INFO");
  });
});

describe("qa report runner — duration-window", () => {
  it("passes inside the 5–8s window, including both bounds", () => {
    for (const duration of [5, 6.4, 8]) {
      const report = runQaReport(
        withArtifact(baseInput(), "FINAL_VIDEO", {
          metadata: {
            durationSeconds: duration,
            width: 360,
            height: 640,
            videoCodec: "h264",
            audioPresent: true,
          },
        }),
      );
      expect(resultOf(report.checks, "duration-window").status).toBe("PASS");
    }
  });

  it("fails critical outside the 5–8s window", () => {
    for (const duration of [4.9, 8.1]) {
      const report = runQaReport(
        withArtifact(baseInput(), "FINAL_VIDEO", {
          metadata: {
            durationSeconds: duration,
            width: 360,
            height: 640,
            videoCodec: "h264",
            audioPresent: true,
          },
        }),
      );
      const result = resultOf(report.checks, "duration-window");
      expect(result.status).toBe("FAIL");
      expect(result.severity).toBe("CRITICAL");
    }
  });

  it("fails critical on a missing duration", () => {
    const report = runQaReport(
      withArtifact(baseInput(), "FINAL_VIDEO", {
        metadata: { width: 360, height: 640, audioPresent: true },
      }),
    );
    expect(resultOf(report.checks, "duration-window").status).toBe("FAIL");
  });
});

describe("qa report runner — frame-preservation", () => {
  it("passes when animation frames survive the mux", () => {
    const report = runQaReport(baseInput());
    expect(resultOf(report.checks, "frame-preservation").status).toBe("PASS");
  });

  it("fails warning on frame drift beyond tolerance", () => {
    const drifted = withArtifact(baseInput(), "SILENT_ANIMATION", {
      metadata: {
        durationSeconds: 5.2,
        width: 360,
        height: 640,
        videoCodec: "h264",
        audioPresent: false,
      },
    });
    const report = runQaReport(drifted);
    const result = resultOf(report.checks, "frame-preservation");
    expect(result.status).toBe("FAIL");
    expect(result.severity).toBe("WARNING");
    expect(result.remediation).toMatch(/mux/i);
  });

  it("fails critical when the final video lost its video stream", () => {
    const report = runQaReport(
      withArtifact(baseInput(), "FINAL_VIDEO", {
        metadata: {
          durationSeconds: 6,
          width: 360,
          height: 640,
          videoCodec: null,
          audioPresent: true,
        },
      }),
    );
    const result = resultOf(report.checks, "frame-preservation");
    expect(result.status).toBe("FAIL");
    expect(result.severity).toBe("CRITICAL");
  });

  it("defers while the animation or final video is missing", () => {
    const report = runQaReport(
      withArtifact(baseInput(), "SILENT_ANIMATION", undefined),
    );
    const result = resultOf(report.checks, "frame-preservation");
    expect(result.status).toBe("WARN");
    expect(result.severity).toBe("INFO");
  });
});

describe("qa report runner — provider-attribution", () => {
  it("passes when every artifact records its expected provider", () => {
    const report = runQaReport(baseInput());
    expect(resultOf(report.checks, "provider-attribution").status).toBe("PASS");
  });

  it("fails critical on a dishonest provider record", () => {
    const report = runQaReport(
      withArtifact(baseInput(), "STYLED_FRAME", { provider: "RUNWAY" }),
    );
    const result = resultOf(report.checks, "provider-attribution");
    expect(result.status).toBe("FAIL");
    expect(result.severity).toBe("CRITICAL");
    expect(result.detail).toMatch(/STYLED_FRAME recorded RUNWAY/);
  });

  it("fails warning when live-generated artifacts lack a request id", () => {
    const report = runQaReport({
      ...baseInput(),
      production: {
        ...baseInput().production,
        imageProvider: "OPENAI",
      },
      artifacts: baseInput().artifacts.map((artifact) =>
        artifact.kind === "STYLED_FRAME"
          ? { ...artifact, provider: "OPENAI", providerRequestId: null }
          : artifact,
      ),
    });
    const result = resultOf(report.checks, "provider-attribution");
    expect(result.status).toBe("FAIL");
    expect(result.severity).toBe("WARNING");
  });

  it("passes when live-generated artifacts carry their request id", () => {
    const report = runQaReport({
      ...baseInput(),
      production: {
        ...baseInput().production,
        imageProvider: "OPENAI",
      },
      artifacts: baseInput().artifacts.map((artifact) =>
        artifact.kind === "STYLED_FRAME"
          ? {
              ...artifact,
              provider: "OPENAI",
              providerRequestId: "req_openai_123",
              metadata: { styledBy: "OPENAI", styleVersion: "clay-v1" },
            }
          : artifact,
      ),
    });
    expect(resultOf(report.checks, "provider-attribution").status).toBe("PASS");
  });
});

describe("qa report runner — lineage-completeness", () => {
  it("passes with all seven kinds and resolvable parents", () => {
    const report = runQaReport(baseInput());
    expect(resultOf(report.checks, "lineage-completeness").status).toBe("PASS");
  });

  it("fails critical on dangling parent references", () => {
    const report = runQaReport(
      withArtifact(baseInput(), "FINAL_VIDEO", {
        parentArtifactIds: ["art_missing_parent"],
      }),
    );
    const result = resultOf(report.checks, "lineage-completeness");
    expect(result.status).toBe("FAIL");
    expect(result.severity).toBe("CRITICAL");
    expect(result.detail).toMatch(/art_missing_parent/);
  });

  it("fails critical when a COMPLETE production lacks artifact kinds", () => {
    // Drop KEYFRAME and every reference to it so the only lineage finding
    // left is the missing kind itself.
    const report = runQaReport({
      ...baseInput(),
      artifacts: baseInput()
        .artifacts.filter((artifact) => artifact.kind !== "KEYFRAME")
        .map((artifact) => ({
          ...artifact,
          parentArtifactIds: artifact.parentArtifactIds.filter(
            (id) => id !== ARTIFACT_IDS.KEYFRAME,
          ),
        })),
    });
    const result = resultOf(report.checks, "lineage-completeness");
    expect(result.status).toBe("FAIL");
    expect(result.severity).toBe("CRITICAL");
    expect(result.detail).toMatch(/KEYFRAME/);
  });

  it("warns with INFO for an in-flight production's incomplete lineage", () => {
    const report = runQaReport({
      ...baseInput(),
      production: { ...baseInput().production, status: "ANIMATING" },
      // Everything through keyframe extraction exists; nothing downstream
      // has been produced yet, and no parent references dangle.
      artifacts: baseInput().artifacts.filter((artifact) =>
        [
          "SOURCE_VIDEO",
          "EXTRACTED_CLIP",
          "EXTRACTED_AUDIO",
          "KEYFRAME",
        ].includes(artifact.kind),
      ),
    });
    const result = resultOf(report.checks, "lineage-completeness");
    expect(result.status).toBe("WARN");
    expect(result.severity).toBe("INFO");
  });
});

describe("qa report runner — download-readiness", () => {
  it("passes when the final video is stored, non-empty, and an MP4", () => {
    const report = runQaReport(baseInput());
    expect(resultOf(report.checks, "download-readiness").status).toBe("PASS");
  });

  it("fails critical when the bytes are missing from storage", () => {
    const report = runQaReport(
      withArtifact(baseInput(), "FINAL_VIDEO", { storagePresent: false }),
    );
    const result = resultOf(report.checks, "download-readiness");
    expect(result.status).toBe("FAIL");
    expect(result.severity).toBe("CRITICAL");
  });

  it("fails critical on a zero-byte final video", () => {
    const report = runQaReport(
      withArtifact(baseInput(), "FINAL_VIDEO", { byteSize: 0 }),
    );
    const result = resultOf(report.checks, "download-readiness");
    expect(result.status).toBe("FAIL");
    expect(result.severity).toBe("CRITICAL");
  });

  it("defers while no final video exists", () => {
    const report = runQaReport(
      withArtifact(baseInput(), "FINAL_VIDEO", undefined),
    );
    const result = resultOf(report.checks, "download-readiness");
    expect(result.status).toBe("WARN");
    expect(result.severity).toBe("INFO");
  });
});

describe("qa report runner — style-conformance", () => {
  it("passes when styledBy matches the image provider and a version exists", () => {
    const report = runQaReport(baseInput());
    expect(resultOf(report.checks, "style-conformance").status).toBe("PASS");
  });

  it("fails critical when the styled-by disclosure contradicts the selection", () => {
    const report = runQaReport(
      withArtifact(baseInput(), "STYLED_FRAME", {
        metadata: { styledBy: "OPENAI", styleVersion: "clay-v1" },
      }),
    );
    const result = resultOf(report.checks, "style-conformance");
    expect(result.status).toBe("FAIL");
    expect(result.severity).toBe("CRITICAL");
  });

  it("warns when the styled frame omits its style version", () => {
    const report = runQaReport(
      withArtifact(baseInput(), "STYLED_FRAME", {
        metadata: { styledBy: "MOCK" },
      }),
    );
    const result = resultOf(report.checks, "style-conformance");
    expect(result.status).toBe("WARN");
    expect(result.severity).toBe("WARNING");
    expect(result.remediation).toMatch(/styleVersion/);
  });

  it("fails critical when a COMPLETE production has no styled frame", () => {
    const report = runQaReport(
      withArtifact(baseInput(), "STYLED_FRAME", undefined),
    );
    const result = resultOf(report.checks, "style-conformance");
    expect(result.status).toBe("FAIL");
    expect(result.severity).toBe("CRITICAL");
  });
});

describe("qa report runner — caption-presence", () => {
  it("passes with a candidate caption and a social caption", () => {
    const report = runQaReport(baseInput());
    expect(resultOf(report.checks, "caption-presence").status).toBe("PASS");
  });

  it("fails warning when the candidate has no caption", () => {
    const report = runQaReport({
      ...baseInput(),
      captions: { caption: "   ", socialCaption: "social" },
    });
    const result = resultOf(report.checks, "caption-presence");
    expect(result.status).toBe("FAIL");
    expect(result.severity).toBe("WARNING");
  });

  it("warns when no treatment supplies a social caption", () => {
    const report = runQaReport({
      ...baseInput(),
      captions: { caption: "trend caption", socialCaption: null },
    });
    const result = resultOf(report.checks, "caption-presence");
    expect(result.status).toBe("WARN");
    expect(result.severity).toBe("WARNING");
    expect(result.remediation).toMatch(/Director/);
  });
});

describe("qa report runner — segment-match", () => {
  it("passes within the documented tolerance", () => {
    const report = runQaReport(
      withArtifact(baseInput(), "FINAL_VIDEO", {
        metadata: {
          durationSeconds: 6.05,
          width: 360,
          height: 640,
          videoCodec: "h264",
          audioPresent: true,
        },
      }),
    );
    expect(resultOf(report.checks, "segment-match").status).toBe("PASS");
  });

  it("fails critical when the output drifts from the selected segment", () => {
    const report = runQaReport(
      withArtifact(baseInput(), "FINAL_VIDEO", {
        metadata: {
          durationSeconds: 6.5,
          width: 360,
          height: 640,
          videoCodec: "h264",
          audioPresent: true,
        },
      }),
    );
    const result = resultOf(report.checks, "segment-match");
    expect(result.status).toBe("FAIL");
    expect(result.severity).toBe("CRITICAL");
    expect(result.detail).toMatch(/6\.500s against the selected 6\.000s/);
  });

  it("defers while no final video exists", () => {
    const report = runQaReport(
      withArtifact(baseInput(), "FINAL_VIDEO", undefined),
    );
    const result = resultOf(report.checks, "segment-match");
    expect(result.status).toBe("WARN");
    expect(result.severity).toBe("INFO");
  });
});

describe("qa report runner — aggregates", () => {
  it("fails overall when any check fails", () => {
    const report = runQaReport(
      withArtifact(baseInput(), "STYLED_FRAME", {
        metadata: { styledBy: "OPENAI", styleVersion: "clay-v1" },
      }),
    );
    expect(report.overallStatus).toBe("FAIL");
  });

  it("warns overall when only warnings remain", () => {
    const report = runQaReport({
      ...baseInput(),
      captions: { caption: "trend caption", socialCaption: null },
      production: { ...baseInput().production, status: "ANIMATING" },
      artifacts: baseInput().artifacts.filter((artifact) =>
        [
          "SOURCE_VIDEO",
          "EXTRACTED_CLIP",
          "EXTRACTED_AUDIO",
          "KEYFRAME",
        ].includes(artifact.kind),
      ),
    });
    expect(report.overallStatus).toBe("WARN");
  });

  it("scores passes fully, warnings half, failures zero", () => {
    const allPass = runQaReport(baseInput());
    expect(allPass.score).toBe(100);

    const oneWarn = runQaReport({
      ...baseInput(),
      captions: { caption: "trend caption", socialCaption: null },
    });
    expect(oneWarn.score).toBe(95);

    const oneFail = runQaReport(
      withArtifact(baseInput(), "STYLED_FRAME", {
        metadata: { styledBy: "OPENAI", styleVersion: "clay-v1" },
      }),
    );
    expect(oneFail.score).toBe(90);
  });

  it("reports every non-pass with a declared severity and remediation", () => {
    const noisy = runQaReport(
      withArtifact(baseInput(), "FINAL_VIDEO", {
        metadata: { durationSeconds: 6.5, width: 360, height: 240 },
        storagePresent: false,
      }),
    );
    for (const check of noisy.checks) {
      if (check.status === "PASS") {
        expect(check.severity).toBeUndefined();
        expect(check.remediation).toBeUndefined();
      } else {
        expect(qaSeverities).toContain(check.severity);
        expect(check.remediation).toBeTruthy();
      }
    }
    expect(noisy.overallStatus).toBe("FAIL");
    expect(resultOf(noisy.checks, "aspect-ratio").key).toBe("aspect-ratio");
  });
});
