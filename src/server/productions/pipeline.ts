import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import { z } from "zod";

import {
  outputDurationToleranceSeconds,
  type ArtifactKind,
  type ValidationReport,
  type WorkerOwnedStatus,
} from "@/domain/production";
import {
  generateArtifactStorageKey,
  type ArtifactStore,
} from "@/lib/artifact-store";
import { env } from "@/lib/env";
import { mediaToolPaths } from "@/lib/media-tools";
import type { ImageProvider } from "@/lib/providers";
import { productionStageNames } from "@/server/db/schema";

const execFileAsync = promisify(execFile);

export type ProductionStageName = (typeof productionStageNames)[number];

/**
 * Canonical execution order of the worker-owned stages. INGEST_SOURCE is
 * completed by the upload API before the job is queued and is never claimed.
 */
export const pipelineStageOrder = [
  "EXTRACT_MEDIA",
  "SELECT_KEYFRAME",
  "STYLE_IMAGE",
  "ANIMATE_IMAGE",
  "MUX_AND_NORMALIZE",
  "VALIDATE_OUTPUT",
] as const satisfies readonly ProductionStageName[];

export type PipelineStageName = (typeof pipelineStageOrder)[number];

const pipelineStageNameSet: ReadonlySet<string> = new Set(pipelineStageOrder);

export function isPipelineStageName(name: string): name is PipelineStageName {
  return pipelineStageNameSet.has(name);
}

/** Worker-owned production status that each stage belongs to. */
export const stagePhase: Record<PipelineStageName, WorkerOwnedStatus> = {
  EXTRACT_MEDIA: "EXTRACTING",
  SELECT_KEYFRAME: "EXTRACTING",
  STYLE_IMAGE: "STYLING",
  ANIMATE_IMAGE: "ANIMATING",
  MUX_AND_NORMALIZE: "MUXING",
  VALIDATE_OUTPUT: "VALIDATING",
};

/** First stage of each worker-owned phase. */
export const phaseEntryStage: Record<WorkerOwnedStatus, PipelineStageName> = {
  EXTRACTING: "EXTRACT_MEDIA",
  STYLING: "STYLE_IMAGE",
  ANIMATING: "ANIMATE_IMAGE",
  MUXING: "MUX_AND_NORMALIZE",
  VALIDATING: "VALIDATE_OUTPUT",
};

export interface ArtifactDefinition {
  readonly kind: ArtifactKind;
  readonly fileName: string;
  readonly mimeType: string;
  readonly parentKinds: readonly ArtifactKind[];
}

/** Kind, stored media type, and lineage of every artifact a stage produces. */
export const stageOutputDefinitions: Record<
  PipelineStageName,
  readonly ArtifactDefinition[]
> = {
  EXTRACT_MEDIA: [
    {
      kind: "EXTRACTED_CLIP",
      fileName: "clip.mp4",
      mimeType: "video/mp4",
      parentKinds: ["SOURCE_VIDEO"],
    },
    {
      kind: "EXTRACTED_AUDIO",
      fileName: "audio.m4a",
      mimeType: "audio/mp4",
      parentKinds: ["EXTRACTED_CLIP"],
    },
  ],
  SELECT_KEYFRAME: [
    {
      kind: "KEYFRAME",
      fileName: "keyframe.png",
      mimeType: "image/png",
      parentKinds: ["EXTRACTED_CLIP"],
    },
  ],
  STYLE_IMAGE: [
    {
      kind: "STYLED_FRAME",
      fileName: "styled-frame.png",
      mimeType: "image/png",
      parentKinds: ["KEYFRAME"],
    },
  ],
  ANIMATE_IMAGE: [
    {
      kind: "SILENT_ANIMATION",
      fileName: "animation.mp4",
      mimeType: "video/mp4",
      parentKinds: ["STYLED_FRAME"],
    },
  ],
  MUX_AND_NORMALIZE: [
    {
      kind: "FINAL_VIDEO",
      fileName: "final.mp4",
      mimeType: "video/mp4",
      parentKinds: ["SILENT_ANIMATION", "EXTRACTED_AUDIO"],
    },
  ],
  VALIDATE_OUTPUT: [],
};

const artifactDefinitionsByKind = new Map<ArtifactKind, ArtifactDefinition>(
  Object.values(stageOutputDefinitions)
    .flat()
    .map((definition) => [definition.kind, definition]),
);

/** Upstream artifact kinds each stage consumes, in stable order. */
export const stageInputKinds: Record<
  PipelineStageName,
  readonly ArtifactKind[]
> = {
  EXTRACT_MEDIA: ["SOURCE_VIDEO"],
  SELECT_KEYFRAME: ["EXTRACTED_CLIP"],
  STYLE_IMAGE: ["KEYFRAME"],
  ANIMATE_IMAGE: ["STYLED_FRAME"],
  MUX_AND_NORMALIZE: ["SILENT_ANIMATION", "EXTRACTED_AUDIO"],
  VALIDATE_OUTPUT: ["FINAL_VIDEO"],
};

const stageFingerprintVersions: Record<PipelineStageName, string> = {
  EXTRACT_MEDIA: "extract-v1",
  SELECT_KEYFRAME: "keyframe-v1",
  STYLE_IMAGE: "mock-style-v1",
  ANIMATE_IMAGE: "mock-zoompan-v1",
  MUX_AND_NORMALIZE: "mux-v1",
  VALIDATE_OUTPUT: "validate-v1",
};

export interface StageFingerprintInput {
  readonly productionId: string;
  readonly segment: {
    readonly startMs: number;
    readonly endMs: number;
    readonly durationMs: number;
  };
  readonly upstream: readonly {
    readonly kind: ArtifactKind;
    readonly sha256: string;
  }[];
}

/**
 * Deterministic stage input fingerprint: identical inputs hash to the same
 * value, so a retried stage with unchanged upstream artifacts is idempotent
 * (Technical Specification §7 invariant 6).
 */
export function computeStageFingerprint(
  stageName: PipelineStageName,
  input: StageFingerprintInput,
): string {
  const canonical = JSON.stringify({
    stage: stageName,
    version: stageFingerprintVersions[stageName],
    productionId: input.productionId,
    segment: input.segment,
    upstream: input.upstream.map(
      (artifact) => `${artifact.kind}:${artifact.sha256}`,
    ),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Artifact rows use one stable id per production and kind, so retry rewrites in place instead of duplicating rows. */
export function getArtifactRecordId(
  productionId: string,
  kind: ArtifactKind,
): string {
  // The merged upload API persists the source as "<production>-source".
  return kind === "SOURCE_VIDEO"
    ? `${productionId}-source`
    : `${productionId}-${kind}`;
}

export function getArtifactStorageKey(
  productionId: string,
  kind: ArtifactKind,
): string {
  const definition = artifactDefinitionsByKind.get(kind);
  if (!definition) {
    throw new Error(`No artifact definition for kind ${kind}`);
  }
  return generateArtifactStorageKey(productionId, definition.fileName);
}

export type WorkerStageErrorCode =
  | "UPSTREAM_ARTIFACT_MISSING"
  | "MEDIA_PROCESSING_FAILED"
  | "OUTPUT_VALIDATION_FAILED"
  | "IMAGE_PROVIDER_NOT_AVAILABLE"
  | "PROVIDER_REQUEST_FAILED"
  | "PROVIDER_UNKNOWN_OUTCOME";

/** Typed stage failure carrying the stable error code persisted for retry. */
export class WorkerStageError extends Error {
  constructor(
    public readonly code: WorkerStageErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
export interface FFmpegStep {
  readonly args: readonly string[];
  readonly outputKind: ArtifactKind;
}

/**
 * Deterministic local styling: 9:16 center crop, soft blur, saturation and
 * contrast lift, vignette, and the brand's yellow bar. The output is a
 * repository-controlled fallback and is attributed to the MOCK provider —
 * it never claims an AI transformation occurred.
 */
const mockStyleFilterChain =
  "scale=360:640:force_original_aspect_ratio=increase,crop=360:640," +
  "gblur=sigma=1.2,eq=saturation=1.45:contrast=1.12:brightness=0.04," +
  "vignette=PI/5," +
  "drawbox=x=0:y=0:w=iw:h=36:color=0xFFD83D@0.95:t=fill";

/** Subtle deterministic zoom-in over the segment duration (mock animation). */
const mockZoomPanFilterChain =
  "zoompan=z='min(zoom+0.0007,1.08)':x='iw/2-(iw/zoom/2)':" +
  "y='ih/2-(ih/zoom/2)':d=1:s=360x640:fps=24,format=yuv420p";

function requirePath(
  paths: Partial<Record<ArtifactKind, string>>,
  kind: ArtifactKind,
): string {
  const value = paths[kind];
  if (!value) {
    throw new WorkerStageError(
      "UPSTREAM_ARTIFACT_MISSING",
      `Upstream ${kind} artifact is missing.`,
    );
  }
  return value;
}

/**
 * Pure FFmpeg argument-array builder for one stage. Argument arrays only —
 * user data never reaches a shell string (AGENTS.md).
 */
export function buildStageSteps(
  stageName: PipelineStageName,
  paths: Partial<Record<ArtifactKind, string>>,
  segment: { readonly startSeconds: number; readonly durationSeconds: number },
): readonly FFmpegStep[] {
  switch (stageName) {
    case "EXTRACT_MEDIA":
      return [
        {
          outputKind: "EXTRACTED_CLIP",
          args: [
            "-y",
            "-ss",
            segment.startSeconds.toFixed(3),
            "-i",
            requirePath(paths, "SOURCE_VIDEO"),
            "-t",
            segment.durationSeconds.toFixed(3),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            requirePath(paths, "EXTRACTED_CLIP"),
          ],
        },
        {
          outputKind: "EXTRACTED_AUDIO",
          args: [
            "-y",
            "-i",
            requirePath(paths, "EXTRACTED_CLIP"),
            "-vn",
            "-c:a",
            "aac",
            requirePath(paths, "EXTRACTED_AUDIO"),
          ],
        },
      ];
    case "SELECT_KEYFRAME":
      return [
        {
          outputKind: "KEYFRAME",
          args: [
            "-y",
            "-ss",
            (segment.durationSeconds / 2).toFixed(3),
            "-i",
            requirePath(paths, "EXTRACTED_CLIP"),
            "-frames:v",
            "1",
            requirePath(paths, "KEYFRAME"),
          ],
        },
      ];
    case "STYLE_IMAGE":
      return [
        {
          outputKind: "STYLED_FRAME",
          args: [
            "-y",
            "-i",
            requirePath(paths, "KEYFRAME"),
            "-vf",
            mockStyleFilterChain,
            "-frames:v",
            "1",
            requirePath(paths, "STYLED_FRAME"),
          ],
        },
      ];
    case "ANIMATE_IMAGE":
      return [
        {
          outputKind: "SILENT_ANIMATION",
          args: [
            "-y",
            "-loop",
            "1",
            "-framerate",
            "24",
            "-i",
            requirePath(paths, "STYLED_FRAME"),
            "-t",
            segment.durationSeconds.toFixed(3),
            "-vf",
            mockZoomPanFilterChain,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            requirePath(paths, "SILENT_ANIMATION"),
          ],
        },
      ];
    case "MUX_AND_NORMALIZE":
      return [
        {
          outputKind: "FINAL_VIDEO",
          args: [
            "-y",
            "-i",
            requirePath(paths, "SILENT_ANIMATION"),
            "-i",
            requirePath(paths, "EXTRACTED_AUDIO"),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-shortest",
            "-movflags",
            "+faststart",
            requirePath(paths, "FINAL_VIDEO"),
          ],
        },
      ];
    case "VALIDATE_OUTPUT":
      return [];
  }
}

const mediaProbeSchema = z.object({
  format: z.object({ duration: z.coerce.number().positive() }),
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    }),
  ),
});

export type MediaProbe = z.infer<typeof mediaProbeSchema>;

export async function probeMediaFile(filePath: string): Promise<MediaProbe> {
  const { stdout } = await execFileAsync(mediaToolPaths.ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,codec_name,width,height",
    "-of",
    "json",
    filePath,
  ]);
  return mediaProbeSchema.parse(JSON.parse(stdout) as unknown);
}

/**
 * Pure 9:16 + A/V output gate (Technical Specification §8.7): playable by
 * FFprobe, 9:16 display orientation, duration inside the documented segment
 * tolerance, and at least one video and one audio stream.
 */
export function buildValidationReport(
  probe: MediaProbe,
  segment: { readonly durationSeconds: number },
): ValidationReport {
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  const problems: string[] = [];

  if (!video?.width || !video?.height) {
    problems.push("missing video dimensions");
  } else if (video.width * 16 !== video.height * 9) {
    problems.push(`dimensions ${video.width}x${video.height} are not 9:16`);
  }
  if (!audio) problems.push("no audio stream");
  if (
    Math.abs(probe.format.duration - segment.durationSeconds) >
    outputDurationToleranceSeconds
  ) {
    problems.push(
      `duration ${probe.format.duration.toFixed(3)}s is outside the segment tolerance`,
    );
  }

  if (problems.length > 0 || !video?.width || !video?.height || !audio) {
    throw new WorkerStageError(
      "OUTPUT_VALIDATION_FAILED",
      `Final output failed validation: ${problems.join("; ") || "required media streams missing"}.`,
    );
  }

  return {
    playable: true,
    width: video.width,
    height: video.height,
    durationSeconds: probe.format.duration,
    audioPresent: true,
  };
}

export interface StageUpstreamArtifact {
  readonly kind: ArtifactKind;
  readonly id: string;
  readonly storageKey: string;
  readonly sha256: string;
}

export interface StageExecutorContext {
  readonly productionId: string;
  readonly segment: {
    readonly startMs: number;
    readonly endMs: number;
    readonly durationMs: number;
  };
  readonly upstream: readonly StageUpstreamArtifact[];
  readonly store: ArtifactStore;
  /**
   * Live-provider request ID from a prior attempt of this stage, persisted
   * so retries reconcile remote state instead of generating again.
   */
  readonly priorProviderRequestId?: string | null;
  /**
   * Durable anchor for reconcile-before-retry: called as soon as a live
   * provider accepts a new request so a crash mid-poll still records it.
   */
  readonly recordProviderRequestId?: (requestId: string) => Promise<void>;
}

export type StageArtifactMetadata = Record<
  string,
  string | number | boolean | null
>;

export interface StageOutputArtifact {
  readonly kind: ArtifactKind;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly metadata: StageArtifactMetadata;
  /** Provider request lineage for live-provider outputs (amendment art_2yKin00n). */
  readonly providerRequestId?: string;
}

export interface StageExecutionResult {
  readonly artifacts: readonly StageOutputArtifact[];
  readonly validationReport?: ValidationReport;
}

export type StageExecutor = (
  context: StageExecutorContext,
) => Promise<StageExecutionResult>;

export function requireUpstream(
  context: StageExecutorContext,
  kind: ArtifactKind,
): StageUpstreamArtifact {
  const artifact = context.upstream.find(
    (candidate) => candidate.kind === kind,
  );
  if (!artifact) {
    throw new WorkerStageError(
      "UPSTREAM_ARTIFACT_MISSING",
      `Upstream ${kind} artifact is missing.`,
    );
  }
  return artifact;
}

async function runFfmpegStep(step: FFmpegStep): Promise<void> {
  try {
    await execFileAsync(mediaToolPaths.ffmpeg, [...step.args], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
    });
  } catch (error) {
    // The persisted message stays generic; detailed stderr goes to logs.
    throw new WorkerStageError(
      "MEDIA_PROCESSING_FAILED",
      `FFmpeg failed while producing ${step.outputKind}.`,
      { cause: error },
    );
  }
}

function probeMetadata(probe: MediaProbe): StageArtifactMetadata {
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  return {
    durationSeconds: probe.format.duration,
    width: video?.width ?? null,
    height: video?.height ?? null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    audioPresent: probe.streams.some((stream) => stream.codec_type === "audio"),
  };
}

const mockStyleLabel =
  "Deterministic local FFmpeg style; no AI provider transformation was applied.";

async function buildStageArtifactMetadata(
  kind: ArtifactKind,
  context: StageExecutorContext,
  storageKey: string,
): Promise<StageArtifactMetadata> {
  switch (kind) {
    case "EXTRACTED_CLIP":
    case "SILENT_ANIMATION": {
      const metadata = probeMetadata(
        await probeMediaFile(await context.store.resolve(storageKey)),
      );
      return kind === "SILENT_ANIMATION"
        ? { ...metadata, motion: "zoompan", fps: 24 }
        : {
            ...metadata,
            segmentStartSeconds: context.segment.startMs / 1000,
            segmentDurationSeconds: context.segment.durationMs / 1000,
          };
    }
    case "EXTRACTED_AUDIO": {
      const probe = await probeMediaFile(
        await context.store.resolve(storageKey),
      );
      return {
        durationSeconds: probe.format.duration,
        audioCodec:
          probe.streams.find((stream) => stream.codec_type === "audio")
            ?.codec_name ?? null,
        audioPresent: true,
      };
    }
    case "KEYFRAME": {
      // Exact source timestamp of the frame (Technical Specification §8.3).
      return {
        sourceTimestampSeconds:
          (context.segment.startMs + context.segment.durationMs / 2) / 1000,
      };
    }
    case "STYLED_FRAME": {
      return {
        styledBy: "MOCK",
        styleVersion: "mock-style-v1",
        label: mockStyleLabel,
      };
    }
    case "SOURCE_VIDEO":
      return {};
    case "FINAL_VIDEO":
      return probeMetadata(
        await probeMediaFile(await context.store.resolve(storageKey)),
      );
  }
}

async function executeProductionStage(
  stageName: PipelineStageName,
  context: StageExecutorContext,
): Promise<StageExecutionResult> {
  const paths: Partial<Record<ArtifactKind, string>> = {};
  for (const kind of stageInputKinds[stageName]) {
    const upstream = requireUpstream(context, kind);
    paths[kind] = await context.store.resolve(upstream.storageKey);
  }
  for (const definition of stageOutputDefinitions[stageName]) {
    paths[definition.kind] = await context.store.resolve(
      getArtifactStorageKey(context.productionId, definition.kind),
    );
  }

  for (const step of buildStageSteps(stageName, paths, {
    startSeconds: context.segment.startMs / 1000,
    durationSeconds: context.segment.durationMs / 1000,
  })) {
    await runFfmpegStep(step);
  }

  const artifacts: StageOutputArtifact[] = [];
  for (const definition of stageOutputDefinitions[stageName]) {
    const storageKey = getArtifactStorageKey(
      context.productionId,
      definition.kind,
    );
    const integrity = await context.store.inspect(storageKey);
    artifacts.push({
      kind: definition.kind,
      storageKey,
      mimeType: definition.mimeType,
      byteSize: integrity.byteSize,
      sha256: integrity.sha256,
      metadata: await buildStageArtifactMetadata(
        definition.kind,
        context,
        storageKey,
      ),
    });
  }
  return { artifacts };
}

async function validateFinalOutput(
  context: StageExecutorContext,
): Promise<StageExecutionResult> {
  const final = requireUpstream(context, "FINAL_VIDEO");
  const probe = await probeMediaFile(
    await context.store.resolve(final.storageKey),
  );
  return {
    artifacts: [],
    validationReport: buildValidationReport(probe, {
      durationSeconds: context.segment.durationMs / 1000,
    }),
  };
}

export interface DefaultStageExecutorSelection {
  /** Defaults to the validated environment selection. */
  readonly imageProvider?: ImageProvider;
}

export function createDefaultStageExecutors(
  selection: DefaultStageExecutorSelection = {},
): Record<PipelineStageName, StageExecutor> {
  const imageProvider = selection.imageProvider ?? env.IMAGE_PROVIDER;
  return {
    EXTRACT_MEDIA: (context) =>
      executeProductionStage("EXTRACT_MEDIA", context),
    SELECT_KEYFRAME: (context) =>
      executeProductionStage("SELECT_KEYFRAME", context),
    STYLE_IMAGE: async (context) => {
      // The default executor only produces the mock FFmpeg style. Running it
      // under a live provider selection would mislabel mock output as
      // provider-produced (expectedArtifactProvider maps STYLED_FRAME to the
      // job's imageProvider), so fail fast instead of attributing dishonestly.
      if (imageProvider !== "MOCK") {
        throw new WorkerStageError(
          "IMAGE_PROVIDER_NOT_AVAILABLE",
          `IMAGE_PROVIDER=${imageProvider} is selected but no live image style executor is wired for the STYLE_IMAGE stage; set IMAGE_PROVIDER=MOCK or wire the OpenAI image adapter executor.`,
        );
      }
      return executeProductionStage("STYLE_IMAGE", context);
    },
    ANIMATE_IMAGE: (context) =>
      executeProductionStage("ANIMATE_IMAGE", context),
    MUX_AND_NORMALIZE: (context) =>
      executeProductionStage("MUX_AND_NORMALIZE", context),
    VALIDATE_OUTPUT: validateFinalOutput,
  };
}

/** Stage leases outlive many poll ticks; a dead worker's lease expires so another worker can claim the stage. */
export const defaultStageLeaseMs = 300_000;
