import { describe, expect, it } from "vitest";

import {
  createProductionJob,
  expectedArtifactProvider,
  outputDurationToleranceSeconds,
  ProductionTransitionError,
  segmentSelectionSchema,
  transitionProduction,
  type ArtifactKind,
  type ProductionArtifactRecord,
  type ProductionJob,
  type WorkerOwnedStatus,
} from "../../src/domain/production";

const rights = {
  confirmed: true,
  confirmedAt: "2026-09-03T12:00:00.000Z",
  confirmationTextVersion: "rights-v1",
} as const;
const segment = { startSeconds: 1, endSeconds: 7, durationSeconds: 6 };
const workerId = "worker-1";

function createDraft(): ProductionJob {
  return createProductionJob({
    id: "production-1",
    candidateId: "candidate-1",
    imageProvider: "OPENAI",
    animationProvider: "RUNWAY",
  });
}

function queueProduction(selectedSegment = segment): ProductionJob {
  const confirmed = transitionProduction(createDraft(), {
    type: "CONFIRM_RIGHTS",
    rights,
  });
  return transitionProduction(confirmed, {
    type: "QUEUE",
    candidateStatus: "APPROVED",
    segment: selectedSegment,
  });
}

function artifact(
  job: ProductionJob,
  kind: ArtifactKind,
  suffix = kind.toLowerCase(),
): ProductionArtifactRecord {
  return {
    id: `artifact-${suffix}`,
    kind,
    provider: expectedArtifactProvider(kind, job),
    inputFingerprint: `fingerprint-${suffix}`,
    storagePresent: true,
  };
}

function extractionArtifacts(job: ProductionJob): ProductionArtifactRecord[] {
  return [
    artifact(job, "SOURCE_VIDEO"),
    artifact(job, "EXTRACTED_CLIP"),
    artifact(job, "EXTRACTED_AUDIO"),
    artifact(job, "KEYFRAME"),
  ];
}

function advance(
  job: ProductionJob,
  artifacts: readonly ProductionArtifactRecord[] = [],
): ProductionJob {
  return transitionProduction(job, { type: "ADVANCE", workerId, artifacts });
}

function reachStage(target: WorkerOwnedStatus): ProductionJob {
  let job = transitionProduction(queueProduction(), {
    type: "START",
    workerId,
  });
  if (target === "EXTRACTING") return job;
  job = advance(job, extractionArtifacts(job));
  if (target === "STYLING") return job;
  job = advance(job, [artifact(job, "STYLED_FRAME")]);
  if (target === "ANIMATING") return job;
  job = advance(job, [artifact(job, "SILENT_ANIMATION")]);
  if (target === "MUXING") return job;
  return advance(job, [artifact(job, "FINAL_VIDEO")]);
}

function completeProduction(): ProductionJob {
  return transitionProduction(reachStage("VALIDATING"), {
    type: "ADVANCE",
    workerId,
    validationReport: {
      playable: true,
      width: 360,
      height: 640,
      durationSeconds: segment.durationSeconds,
      audioPresent: true,
    },
  });
}

function expectTransitionError(
  operation: () => unknown,
  code: ProductionTransitionError["code"],
): void {
  try {
    operation();
    throw new Error("Expected transition to fail");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ProductionTransitionError);
    expect((error as ProductionTransitionError).code).toBe(code);
  }
}

describe("production state machine", () => {
  it("follows the complete legal path and releases the worker after validation", () => {
    let job = createDraft();
    expect(job.status).toBe("DRAFT");

    job = transitionProduction(job, { type: "CONFIRM_RIGHTS", rights });
    expect(job.status).toBe("RIGHTS_CONFIRMED");

    job = transitionProduction(job, {
      type: "QUEUE",
      candidateStatus: "APPROVED",
      segment,
    });
    expect(job.status).toBe("QUEUED");

    job = transitionProduction(job, { type: "START", workerId });
    expect(job.status).toBe("EXTRACTING");

    job = advance(job, extractionArtifacts(job));
    expect(job.status).toBe("STYLING");

    job = advance(job, [artifact(job, "STYLED_FRAME")]);
    expect(job.status).toBe("ANIMATING");

    job = advance(job, [artifact(job, "SILENT_ANIMATION")]);
    expect(job.status).toBe("MUXING");

    job = advance(job, [artifact(job, "FINAL_VIDEO")]);
    expect(job.status).toBe("VALIDATING");

    job = transitionProduction(job, {
      type: "ADVANCE",
      workerId,
      validationReport: {
        playable: true,
        width: 360,
        height: 640,
        durationSeconds: segment.durationSeconds,
        audioPresent: true,
      },
    });
    expect(job).toMatchObject({
      status: "COMPLETE",
      activeWorkerId: undefined,
      imageProvider: "OPENAI",
      animationProvider: "RUNWAY",
    });
    expect(job.artifacts).toHaveLength(7);
  });

  it.each([
    ["DRAFT", { type: "START", workerId }],
    ["RIGHTS_CONFIRMED", { type: "ADVANCE", workerId }],
    ["QUEUED", { type: "CONFIRM_RIGHTS", rights }],
    ["EXTRACTING", { type: "QUEUE", candidateStatus: "APPROVED", segment }],
    ["STYLING", { type: "START", workerId }],
    ["ANIMATING", { type: "RETRY", workerId, verifiedUpstreamArtifactIds: [] }],
    ["MUXING", { type: "CONFIRM_RIGHTS", rights }],
    ["VALIDATING", { type: "QUEUE", candidateStatus: "APPROVED", segment }],
    ["COMPLETE", { type: "START", workerId }],
    ["FAILED", { type: "START", workerId }],
  ] as const)("rejects an illegal transition from %s", (status, transition) => {
    let job: ProductionJob;
    if (status === "DRAFT") job = createDraft();
    else if (status === "RIGHTS_CONFIRMED") {
      job = transitionProduction(createDraft(), {
        type: "CONFIRM_RIGHTS",
        rights,
      });
    } else if (status === "QUEUED") job = queueProduction();
    else if (status === "COMPLETE") job = completeProduction();
    else if (status === "FAILED") {
      const extracting = reachStage("EXTRACTING");
      job = transitionProduction(extracting, {
        type: "FAIL",
        workerId,
        errorCode: "EXTRACT_FAILED",
        errorMessage: "Extraction failed.",
      });
    } else {
      job = reachStage(status);
    }

    expectTransitionError(
      () => transitionProduction(job, transition),
      "ILLEGAL_TRANSITION",
    );
  });

  it.each([
    "EXTRACTING",
    "STYLING",
    "ANIMATING",
    "MUXING",
    "VALIDATING",
  ] as const)("allows %s to enter FAILED under its owning worker", (status) => {
    const failed = transitionProduction(reachStage(status), {
      type: "FAIL",
      workerId,
      errorCode: `${status}_FAILED`,
      errorMessage: `${status} failed.`,
    });
    expect(failed).toMatchObject({
      status: "FAILED",
      failedStage: status,
      activeWorkerId: undefined,
    });
  });

  it("requires persisted, timestamped rights before leaving draft", () => {
    expectTransitionError(
      () =>
        transitionProduction(createDraft(), {
          type: "CONFIRM_RIGHTS",
          rights: {
            confirmed: true,
            confirmationTextVersion: "rights-v1",
          },
        }),
      "RIGHTS_REQUIRED",
    );
  });

  it("queues only approved candidates with valid segments", () => {
    const confirmed = transitionProduction(createDraft(), {
      type: "CONFIRM_RIGHTS",
      rights,
    });
    expectTransitionError(
      () =>
        transitionProduction(confirmed, {
          type: "QUEUE",
          candidateStatus: "NEW",
          segment,
        }),
      "APPROVED_CANDIDATE_REQUIRED",
    );
    expectTransitionError(
      () =>
        transitionProduction(confirmed, {
          type: "QUEUE",
          candidateStatus: "APPROVED",
          segment: {
            startSeconds: 0,
            endSeconds: 4.999,
            durationSeconds: 4.999,
          },
        }),
      "INVALID_SEGMENT",
    );
  });

  it.each([
    { startSeconds: 0, endSeconds: 5, durationSeconds: 5 },
    { startSeconds: 2, endSeconds: 10, durationSeconds: 8 },
  ])("accepts the inclusive 5–8 second boundary: $durationSeconds", (input) => {
    expect(segmentSelectionSchema.parse(input)).toEqual(input);
  });

  it.each([
    { startSeconds: 0, endSeconds: 4.999, durationSeconds: 4.999 },
    { startSeconds: 0, endSeconds: 8.001, durationSeconds: 8.001 },
    { startSeconds: 2, endSeconds: 8, durationSeconds: 5 },
    { startSeconds: 2, endSeconds: 2, durationSeconds: 5 },
  ])("rejects an invalid segment %#", (input) => {
    expect(segmentSelectionSchema.safeParse(input).success).toBe(false);
  });

  it("allows only the owning worker to advance or fail a stage", () => {
    const job = reachStage("EXTRACTING");
    expectTransitionError(
      () =>
        transitionProduction(job, {
          type: "ADVANCE",
          workerId: "worker-2",
          artifacts: extractionArtifacts(job),
        }),
      "WORKER_OWNERSHIP_CONFLICT",
    );
    expectTransitionError(
      () =>
        transitionProduction(job, {
          type: "FAIL",
          workerId: "worker-2",
          errorCode: "FAILED",
          errorMessage: "Failed.",
        }),
      "WORKER_OWNERSHIP_CONFLICT",
    );
  });

  it("requires every stage artifact to be present and attributed to its actual producer", () => {
    const extracting = reachStage("EXTRACTING");
    expectTransitionError(
      () => advance(extracting, extractionArtifacts(extracting).slice(0, -1)),
      "ARTIFACT_INVARIANT_VIOLATION",
    );
    expectTransitionError(
      () =>
        advance(extracting, [
          ...extractionArtifacts(extracting).slice(0, -1),
          {
            ...artifact(extracting, "KEYFRAME"),
            provider: "OPENAI",
          },
        ]),
      "ARTIFACT_INVARIANT_VIOLATION",
    );
  });

  it("rejects duplicate artifact records for the same kind and input fingerprint", () => {
    const styling = reachStage("STYLING");
    expectTransitionError(
      () =>
        transitionProduction(styling, {
          type: "ADVANCE",
          workerId,
          artifacts: [
            {
              ...artifact(styling, "STYLED_FRAME"),
              kind: "SOURCE_VIDEO",
              provider: "USER_UPLOAD",
              inputFingerprint: "fingerprint-source_video",
            },
          ],
        }),
      "ARTIFACT_INVARIANT_VIOLATION",
    );
  });

  it("retries the failed stage only after every upstream artifact is verified", () => {
    const animating = reachStage("ANIMATING");
    const failed = transitionProduction(animating, {
      type: "FAIL",
      workerId,
      errorCode: "ANIMATION_FAILED",
      errorMessage: "Animation failed.",
    });
    expect(failed).toMatchObject({
      status: "FAILED",
      failedStage: "ANIMATING",
    });

    expectTransitionError(
      () =>
        transitionProduction(failed, {
          type: "RETRY",
          workerId: "worker-2",
          verifiedUpstreamArtifactIds: failed.artifacts
            .filter((item) => item.kind !== "STYLED_FRAME")
            .map((item) => item.id),
        }),
      "UPSTREAM_ARTIFACTS_REQUIRED",
    );

    const retried = transitionProduction(failed, {
      type: "RETRY",
      workerId: "worker-2",
      verifiedUpstreamArtifactIds: failed.artifacts.map((item) => item.id),
    });
    expect(retried).toMatchObject({
      status: "ANIMATING",
      activeWorkerId: "worker-2",
      imageProvider: "OPENAI",
      animationProvider: "RUNWAY",
    });
    expect(retried.artifacts).toEqual(failed.artifacts);
  });

  it.each([
    {
      playable: true,
      width: 640,
      height: 360,
      durationSeconds: 6,
      audioPresent: true,
    },
    {
      playable: true,
      width: 360,
      height: 640,
      durationSeconds: 6 + outputDurationToleranceSeconds + 0.001,
      audioPresent: true,
    },
    {
      playable: true,
      width: 360,
      height: 640,
      durationSeconds: 6,
      audioPresent: false,
    },
  ])(
    "rejects completion without a successful output validation %#",
    (report) => {
      const validating = reachStage("VALIDATING");
      expect(() =>
        transitionProduction(validating, {
          type: "ADVANCE",
          workerId,
          validationReport: report,
        }),
      ).toThrow();
    },
  );

  it("freezes provider choices at creation and preserves them through every transition", () => {
    const draft = createDraft();
    expect(Object.isFrozen(draft)).toBe(true);
    const confirmed = transitionProduction(draft, {
      type: "CONFIRM_RIGHTS",
      rights,
    });
    const queued = transitionProduction(confirmed, {
      type: "QUEUE",
      candidateStatus: "APPROVED",
      segment,
    });
    expect(queued).toMatchObject({
      imageProvider: "OPENAI",
      animationProvider: "RUNWAY",
    });
    expect(expectedArtifactProvider("STYLED_FRAME", queued)).toBe("OPENAI");
    expect(expectedArtifactProvider("SILENT_ANIMATION", queued)).toBe("RUNWAY");
    expect(expectedArtifactProvider("FINAL_VIDEO", queued)).toBe("FFMPEG");
  });
});
