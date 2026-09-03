import { z } from "zod";

import {
  animationProviders,
  artifactProviders,
  imageProviders,
  type AnimationProvider,
  type ArtifactProvider,
  type ImageProvider,
} from "../lib/providers";

export const productionStatuses = [
  "DRAFT",
  "RIGHTS_CONFIRMED",
  "QUEUED",
  "EXTRACTING",
  "STYLING",
  "ANIMATING",
  "MUXING",
  "VALIDATING",
  "COMPLETE",
  "FAILED",
] as const;
export type ProductionStatus = (typeof productionStatuses)[number];

export const workerOwnedStatuses = [
  "EXTRACTING",
  "STYLING",
  "ANIMATING",
  "MUXING",
  "VALIDATING",
] as const;
export type WorkerOwnedStatus = (typeof workerOwnedStatuses)[number];

export const artifactKinds = [
  "SOURCE_VIDEO",
  "EXTRACTED_CLIP",
  "EXTRACTED_AUDIO",
  "KEYFRAME",
  "STYLED_FRAME",
  "SILENT_ANIMATION",
  "FINAL_VIDEO",
] as const;
export type ArtifactKind = (typeof artifactKinds)[number];

export const rightsConfirmationSchema = z
  .object({
    confirmed: z.literal(true),
    confirmedAt: z.iso.datetime(),
    confirmationTextVersion: z.string().trim().min(1),
  })
  .strict()
  .readonly();
export type RightsConfirmation = z.infer<typeof rightsConfirmationSchema>;

export const segmentSelectionSchema = z
  .object({
    startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().positive(),
    durationSeconds: z.number().finite().min(5).max(8),
  })
  .strict()
  .superRefine((segment, context) => {
    if (segment.endSeconds <= segment.startSeconds) {
      context.addIssue({
        code: "custom",
        message: "Segment end must be after its start.",
        path: ["endSeconds"],
      });
    }
    if (
      Math.abs(
        segment.endSeconds - segment.startSeconds - segment.durationSeconds,
      ) > 0.001
    ) {
      context.addIssue({
        code: "custom",
        message: "Segment duration must equal end minus start.",
        path: ["durationSeconds"],
      });
    }
  })
  .readonly();
export type SegmentSelection = z.infer<typeof segmentSelectionSchema>;

export const outputDurationToleranceSeconds = 0.1;

export const validationReportSchema = z
  .object({
    playable: z.literal(true),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    durationSeconds: z.number().finite().positive(),
    audioPresent: z.literal(true),
  })
  .strict()
  .readonly();
export type ValidationReport = z.infer<typeof validationReportSchema>;

const artifactRecordSchema = z
  .object({
    id: z.string().trim().min(1),
    kind: z.enum(artifactKinds),
    provider: z.enum(artifactProviders),
    inputFingerprint: z.string().trim().min(1),
    storagePresent: z.literal(true),
  })
  .strict()
  .readonly();
export type ProductionArtifactRecord = z.infer<typeof artifactRecordSchema>;

export interface ProductionJob {
  readonly id: string;
  readonly candidateId: string;
  readonly status: ProductionStatus;
  readonly imageProvider: ImageProvider;
  readonly animationProvider: AnimationProvider;
  readonly rights?: RightsConfirmation;
  readonly segment?: SegmentSelection;
  readonly activeWorkerId?: string;
  readonly failedStage?: WorkerOwnedStatus;
  readonly artifacts: readonly ProductionArtifactRecord[];
  readonly validationReport?: ValidationReport;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

export type ProductionTransition =
  | { readonly type: "CONFIRM_RIGHTS"; readonly rights: unknown }
  | {
      readonly type: "QUEUE";
      readonly candidateStatus: "NEW" | "APPROVED" | "REJECTED";
      readonly segment: unknown;
    }
  | { readonly type: "START"; readonly workerId: string }
  | {
      readonly type: "ADVANCE";
      readonly workerId: string;
      readonly artifacts?: readonly unknown[];
      readonly validationReport?: unknown;
    }
  | {
      readonly type: "FAIL";
      readonly workerId: string;
      readonly errorCode: string;
      readonly errorMessage: string;
    }
  | {
      readonly type: "RETRY";
      readonly workerId: string;
      readonly verifiedUpstreamArtifactIds: readonly string[];
    };

export class ProductionTransitionError extends Error {
  constructor(
    public readonly code:
      | "ILLEGAL_TRANSITION"
      | "RIGHTS_REQUIRED"
      | "APPROVED_CANDIDATE_REQUIRED"
      | "INVALID_SEGMENT"
      | "WORKER_OWNERSHIP_CONFLICT"
      | "ARTIFACT_INVARIANT_VIOLATION"
      | "UPSTREAM_ARTIFACTS_REQUIRED"
      | "VALIDATION_REQUIRED",
  ) {
    super(code);
  }
}

const nextWorkerStatus: Record<WorkerOwnedStatus, ProductionStatus> = {
  EXTRACTING: "STYLING",
  STYLING: "ANIMATING",
  ANIMATING: "MUXING",
  MUXING: "VALIDATING",
  VALIDATING: "COMPLETE",
};

export const phaseOutputKinds: Record<
  WorkerOwnedStatus,
  readonly ArtifactKind[]
> = {
  EXTRACTING: ["SOURCE_VIDEO", "EXTRACTED_CLIP", "EXTRACTED_AUDIO", "KEYFRAME"],
  STYLING: ["STYLED_FRAME"],
  ANIMATING: ["SILENT_ANIMATION"],
  MUXING: ["FINAL_VIDEO"],
  VALIDATING: [],
};

export const phaseRequiredUpstreamKinds: Record<
  WorkerOwnedStatus,
  readonly ArtifactKind[]
> = {
  EXTRACTING: [],
  STYLING: phaseOutputKinds.EXTRACTING,
  ANIMATING: [...phaseOutputKinds.EXTRACTING, ...phaseOutputKinds.STYLING],
  MUXING: [
    ...phaseOutputKinds.EXTRACTING,
    ...phaseOutputKinds.STYLING,
    ...phaseOutputKinds.ANIMATING,
  ],
  VALIDATING: [
    ...phaseOutputKinds.EXTRACTING,
    ...phaseOutputKinds.STYLING,
    ...phaseOutputKinds.ANIMATING,
    ...phaseOutputKinds.MUXING,
  ],
};

export function createProductionJob(input: {
  id: string;
  candidateId: string;
  imageProvider: ImageProvider;
  animationProvider: AnimationProvider;
}): ProductionJob {
  const parsed = z
    .object({
      id: z.string().trim().min(1),
      candidateId: z.string().trim().min(1),
      imageProvider: z.enum(imageProviders),
      animationProvider: z.enum(animationProviders),
    })
    .strict()
    .parse(input);

  return Object.freeze({
    ...parsed,
    status: "DRAFT" as const,
    artifacts: Object.freeze([]),
  });
}

export function expectedArtifactProvider(
  kind: ArtifactKind,
  job: Pick<ProductionJob, "imageProvider" | "animationProvider">,
): ArtifactProvider {
  if (kind === "SOURCE_VIDEO") return "USER_UPLOAD";
  if (kind === "STYLED_FRAME") return job.imageProvider;
  if (kind === "SILENT_ANIMATION") return job.animationProvider;
  return "FFMPEG";
}

function requireStatus(job: ProductionJob, expected: ProductionStatus): void {
  if (job.status !== expected) {
    throw new ProductionTransitionError("ILLEGAL_TRANSITION");
  }
}

function requireWorker(job: ProductionJob, workerId: string): void {
  if (
    !workerId.trim() ||
    !job.activeWorkerId ||
    job.activeWorkerId !== workerId
  ) {
    throw new ProductionTransitionError("WORKER_OWNERSHIP_CONFLICT");
  }
}

function parseArtifacts(
  job: ProductionJob,
  inputs: readonly unknown[],
): ProductionArtifactRecord[] {
  const artifacts = inputs.map((input) => {
    const parsed = artifactRecordSchema.safeParse(input);
    if (!parsed.success) {
      throw new ProductionTransitionError("ARTIFACT_INVARIANT_VIOLATION");
    }
    return parsed.data;
  });
  for (const artifact of artifacts) {
    if (artifact.provider !== expectedArtifactProvider(artifact.kind, job)) {
      throw new ProductionTransitionError("ARTIFACT_INVARIANT_VIOLATION");
    }
  }

  const records = [...job.artifacts, ...artifacts];
  const identities = records.map(
    (artifact) => `${artifact.kind}:${artifact.inputFingerprint}`,
  );
  if (new Set(identities).size !== identities.length) {
    throw new ProductionTransitionError("ARTIFACT_INVARIANT_VIOLATION");
  }
  return artifacts;
}

function requireProducedArtifacts(
  status: WorkerOwnedStatus,
  artifacts: readonly ProductionArtifactRecord[],
): void {
  const expectedKinds = phaseOutputKinds[status];
  const actualKinds = artifacts.map((artifact) => artifact.kind);
  const hasExactStageOutputs =
    actualKinds.length === expectedKinds.length &&
    new Set(actualKinds).size === expectedKinds.length &&
    expectedKinds.every((kind) => actualKinds.includes(kind));
  if (!hasExactStageOutputs) {
    throw new ProductionTransitionError("ARTIFACT_INVARIANT_VIOLATION");
  }
}

function parseSuccessfulValidation(
  input: unknown,
  segment: SegmentSelection | undefined,
): ValidationReport {
  if (!segment) throw new ProductionTransitionError("INVALID_SEGMENT");

  const parsed = validationReportSchema.safeParse(input);
  if (!parsed.success) {
    throw new ProductionTransitionError("VALIDATION_REQUIRED");
  }
  const report = parsed.data;
  const isVertical = report.width * 16 === report.height * 9;
  const durationMatches =
    Math.abs(report.durationSeconds - segment.durationSeconds) <=
    outputDurationToleranceSeconds;
  if (!isVertical || !durationMatches) {
    throw new ProductionTransitionError("VALIDATION_REQUIRED");
  }
  return report;
}

function retryFailedStage(
  job: ProductionJob,
  transition: Extract<ProductionTransition, { type: "RETRY" }>,
): ProductionJob {
  requireStatus(job, "FAILED");
  if (!transition.workerId.trim() || !job.failedStage) {
    throw new ProductionTransitionError("ILLEGAL_TRANSITION");
  }

  const verifiedIds = new Set(transition.verifiedUpstreamArtifactIds);
  const upstreamKinds = phaseRequiredUpstreamKinds[job.failedStage];
  const hasAllUpstreamArtifacts = upstreamKinds.every((kind) =>
    job.artifacts.some(
      (artifact) => artifact.kind === kind && verifiedIds.has(artifact.id),
    ),
  );
  if (!hasAllUpstreamArtifacts) {
    throw new ProductionTransitionError("UPSTREAM_ARTIFACTS_REQUIRED");
  }

  return Object.freeze({
    ...job,
    status: job.failedStage,
    activeWorkerId: transition.workerId,
    failedStage: undefined,
    errorCode: undefined,
    errorMessage: undefined,
  });
}

export function transitionProduction(
  job: ProductionJob,
  transition: ProductionTransition,
): ProductionJob {
  switch (transition.type) {
    case "CONFIRM_RIGHTS": {
      requireStatus(job, "DRAFT");
      const parsed = rightsConfirmationSchema.safeParse(transition.rights);
      if (!parsed.success) {
        throw new ProductionTransitionError("RIGHTS_REQUIRED");
      }
      return Object.freeze({
        ...job,
        status: "RIGHTS_CONFIRMED",
        rights: parsed.data,
      });
    }
    case "QUEUE": {
      requireStatus(job, "RIGHTS_CONFIRMED");
      if (!job.rights) throw new ProductionTransitionError("RIGHTS_REQUIRED");
      if (transition.candidateStatus !== "APPROVED") {
        throw new ProductionTransitionError("APPROVED_CANDIDATE_REQUIRED");
      }
      const parsed = segmentSelectionSchema.safeParse(transition.segment);
      if (!parsed.success) {
        throw new ProductionTransitionError("INVALID_SEGMENT");
      }
      return Object.freeze({ ...job, status: "QUEUED", segment: parsed.data });
    }
    case "START": {
      requireStatus(job, "QUEUED");
      if (!transition.workerId.trim()) {
        throw new ProductionTransitionError("WORKER_OWNERSHIP_CONFLICT");
      }
      return Object.freeze({
        ...job,
        status: "EXTRACTING",
        activeWorkerId: transition.workerId,
      });
    }
    case "ADVANCE": {
      if (!workerOwnedStatuses.includes(job.status as WorkerOwnedStatus)) {
        throw new ProductionTransitionError("ILLEGAL_TRANSITION");
      }
      const status = job.status as WorkerOwnedStatus;
      requireWorker(job, transition.workerId);
      const artifacts = parseArtifacts(job, transition.artifacts ?? []);
      requireProducedArtifacts(status, artifacts);
      const nextStatus = nextWorkerStatus[status];
      const validationReport =
        status === "VALIDATING"
          ? parseSuccessfulValidation(transition.validationReport, job.segment)
          : job.validationReport;
      return Object.freeze({
        ...job,
        status: nextStatus,
        activeWorkerId:
          nextStatus === "COMPLETE" ? undefined : job.activeWorkerId,
        artifacts: Object.freeze([...job.artifacts, ...artifacts]),
        validationReport,
      });
    }
    case "FAIL": {
      if (!workerOwnedStatuses.includes(job.status as WorkerOwnedStatus)) {
        throw new ProductionTransitionError("ILLEGAL_TRANSITION");
      }
      const status = job.status as WorkerOwnedStatus;
      requireWorker(job, transition.workerId);
      if (!transition.errorCode.trim() || !transition.errorMessage.trim()) {
        throw new ProductionTransitionError("ILLEGAL_TRANSITION");
      }
      return Object.freeze({
        ...job,
        status: "FAILED",
        activeWorkerId: undefined,
        failedStage: status,
        errorCode: transition.errorCode,
        errorMessage: transition.errorMessage,
      });
    }
    case "RETRY":
      return retryFailedStage(job, transition);
  }
}
