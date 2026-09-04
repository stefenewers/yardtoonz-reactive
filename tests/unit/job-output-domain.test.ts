import { describe, expect, it } from "vitest";

import {
  buildArtifactLineage,
  buildStageTimeline,
  buildVisualChain,
  formatBytes,
  formatClockTime,
  formatSeconds,
  isJobActive,
  outputFactsFromMetadata,
  slowStageSeconds,
} from "../../src/domain/job-output";

const SHA = "a".repeat(64);
const T0 = "2026-09-03T12:00:00.000Z";
const T1 = "2026-09-03T12:00:05.000Z";

function stage(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "stage-1",
    name: "EXTRACT_MEDIA",
    status: "COMPLETE",
    attempt: 1,
    ...overrides,
  };
}

function artifact(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "artifact-1",
    kind: "SOURCE_VIDEO",
    provider: "USER_UPLOAD",
    mimeType: "video/mp4",
    byteSize: 2048,
    sha256: SHA,
    metadata: {},
    createdAt: T0,
    ...overrides,
  };
}

describe("job-output domain", () => {
  it("folds duplicate stage rows to the latest attempt and fills gaps as WAITING", () => {
    const timeline = buildStageTimeline(
      [
        stage({
          id: "a",
          name: "INGEST_SOURCE",
          status: "COMPLETE",
          attempt: 1,
          completedAt: T0,
        }),
        stage({
          id: "b",
          name: "INGEST_SOURCE",
          status: "COMPLETE",
          attempt: 2,
          completedAt: T1,
        }),
        stage({ id: "c", name: "EXTRACT_MEDIA", status: "RUNNING" }),
      ] as never,
      "EXTRACT_MEDIA",
    );

    expect(timeline).toHaveLength(7);
    expect(timeline[0]).toMatchObject({
      name: "INGEST_SOURCE",
      attempt: 2,
      status: "COMPLETE",
      isCurrent: false,
    });
    expect(timeline[1]).toMatchObject({
      name: "EXTRACT_MEDIA",
      status: "RUNNING",
      isCurrent: true,
    });
    expect(timeline[6]).toMatchObject({
      name: "VALIDATE_OUTPUT",
      status: "WAITING",
      attempt: 1,
    });
  });

  it("marks a stage current from the production activeStage even when still WAITING", () => {
    const timeline = buildStageTimeline([] as never, "SELECT_KEYFRAME");
    expect(timeline[2]).toMatchObject({
      name: "SELECT_KEYFRAME",
      status: "WAITING",
      isCurrent: true,
    });
  });

  it("orders artifact lineage from source to final video regardless of input order", () => {
    const lineage = buildArtifactLineage([
      artifact({ id: "final", kind: "FINAL_VIDEO", provider: "FFMPEG" }),
      artifact({ id: "styled", kind: "STYLED_FRAME", provider: "MOCK" }),
      artifact({ id: "source" }),
    ] as never);

    expect(lineage.map((row) => row.id)).toEqual(["source", "styled", "final"]);
    expect(lineage[0]).toMatchObject({
      label: "Source video",
      providerLabel: "User upload",
      sha256Prefix: SHA.slice(0, 12),
    });
    expect(lineage[2]).toMatchObject({
      label: "Final video",
      providerLabel: "FFmpeg",
    });
  });

  it("sorts same-kind lineage rows by creation time", () => {
    const lineage = buildArtifactLineage([
      artifact({ id: "later", createdAt: T1 }),
      artifact({ id: "earlier", createdAt: T0 }),
    ] as never);
    expect(lineage.map((row) => row.id)).toEqual(["earlier", "later"]);
  });

  it("parses probed output facts and leaves mistyped entries undefined", () => {
    const facts = outputFactsFromMetadata({
      durationSeconds: 6.2,
      width: 1080,
      height: 1920,
      videoCodec: "avc1",
      audioPresent: true,
    });
    expect(facts).toEqual({
      durationSeconds: 6.2,
      width: 1080,
      height: 1920,
      videoCodec: "avc1",
      audioPresent: true,
    });

    expect(
      outputFactsFromMetadata({
        durationSeconds: "6.2",
        width: null,
        audioPresent: "yes",
      }),
    ).toEqual({});
    expect(outputFactsFromMetadata(undefined)).toEqual({});
  });

  it("treats queued and worker-owned statuses as active and terminal ones as not", () => {
    expect(isJobActive("QUEUED")).toBe(true);
    expect(isJobActive("EXTRACTING")).toBe(true);
    expect(isJobActive("MUXING")).toBe(true);
    expect(isJobActive("COMPLETE")).toBe(false);
    expect(isJobActive("FAILED")).toBe(false);
  });

  it("formats seconds, bytes, and clock times with safe fallbacks", () => {
    expect(formatSeconds(6.25)).toBe("6.3s");
    expect(formatSeconds(undefined)).toBe("Unknown");

    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");

    expect(formatClockTime(T0)).not.toBe("");
    expect(formatClockTime("not-a-date")).toBe("");
    expect(formatClockTime(undefined)).toBe("");

    expect(slowStageSeconds).toBeGreaterThan(0);
  });
});

describe("buildVisualChain", () => {
  it("orders the present media steps from keyframe to final video", () => {
    const steps = buildVisualChain([
      artifact({ id: "final-1", kind: "FINAL_VIDEO" }),
      artifact({ id: "source-1", kind: "SOURCE_VIDEO" }),
      artifact({ id: "key-1", kind: "KEYFRAME" }),
      artifact({ id: "clay-1", kind: "STYLED_FRAME" }),
      artifact({ id: "anim-1", kind: "SILENT_ANIMATION" }),
      artifact({ id: "audio-1", kind: "EXTRACTED_AUDIO" }),
    ] as never);

    expect(steps.map((step) => step.label)).toEqual([
      "Keyframe",
      "Clay frame",
      "Animation",
      "Final",
    ]);
    expect(steps.map((step) => step.artifactId)).toEqual([
      "key-1",
      "clay-1",
      "anim-1",
      "final-1",
    ]);
    expect(steps.map((step) => step.isVideo)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it("keeps only the latest artifact per kind across retry attempts", () => {
    const steps = buildVisualChain([
      artifact({ id: "key-old", kind: "KEYFRAME", createdAt: T0 }),
      artifact({ id: "key-new", kind: "KEYFRAME", createdAt: T1 }),
    ] as never);

    expect(steps.map((step) => step.artifactId)).toEqual(["key-new"]);
  });

  it("skips kinds that have no artifacts yet instead of placeholders", () => {
    const steps = buildVisualChain([
      artifact({ id: "key-1", kind: "KEYFRAME" }),
      artifact({ id: "final-1", kind: "FINAL_VIDEO" }),
    ] as never);

    expect(steps.map((step) => step.artifactId)).toEqual(["key-1", "final-1"]);
  });
});
