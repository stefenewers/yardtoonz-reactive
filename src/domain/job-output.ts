import {
  workerOwnedStatuses,
  type ArtifactKind,
  type ProductionStatus,
} from "./production";
import {
  productionStageNames,
  type ProductionArtifactView,
  type ProductionStageStatus,
  type ProductionStageView,
} from "../shared/productions";

/**
 * Pure view-model for the job/output screen. The component renders whatever
 * these functions return, so timeline ordering, lineage, and output facts
 * stay independently testable (AGENTS.md: domain transformations are pure).
 */

export type ProductionStageName = (typeof productionStageNames)[number];

export interface StageTimelineRow {
  readonly name: ProductionStageName;
  readonly label: string;
  readonly status: ProductionStageStatus;
  readonly attempt: number;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly errorCode?: string;
  readonly safeErrorMessage?: string;
  readonly isCurrent: boolean;
}

export const stageLabels: Record<ProductionStageName, string> = {
  INGEST_SOURCE: "Ingest source",
  EXTRACT_MEDIA: "Extract clip and audio",
  SELECT_KEYFRAME: "Select keyframe",
  STYLE_IMAGE: "Style the frame",
  ANIMATE_IMAGE: "Animate the frame",
  MUX_AND_NORMALIZE: "Restore audio and normalize",
  VALIDATE_OUTPUT: "Validate output",
};

/**
 * Builds the seven-row stage timeline. Stages without rows yet are WAITING;
 * retried stages keep only their latest attempt row, because earlier
 * attempts are visible through the attempt counter, not as duplicate rows.
 */
export function buildStageTimeline(
  stages: readonly ProductionStageView[],
  activeStage?: ProductionStageName,
): StageTimelineRow[] {
  const latestByStage = new Map<ProductionStageName, ProductionStageView>();
  for (const stage of stages) {
    const existing = latestByStage.get(stage.name);
    if (!existing || stage.attempt >= existing.attempt) {
      latestByStage.set(stage.name, stage);
    }
  }

  return productionStageNames.map((name) => {
    const stage = latestByStage.get(name);
    return Object.freeze({
      name,
      label: stageLabels[name],
      status: stage?.status ?? "WAITING",
      attempt: stage?.attempt ?? 1,
      startedAt: stage?.startedAt,
      completedAt: stage?.completedAt,
      errorCode: stage?.errorCode,
      safeErrorMessage: stage?.safeErrorMessage,
      isCurrent: activeStage === name || stage?.status === "RUNNING",
    });
  });
}

const lineageOrder: readonly ArtifactKind[] = [
  "SOURCE_VIDEO",
  "EXTRACTED_CLIP",
  "EXTRACTED_AUDIO",
  "KEYFRAME",
  "STYLED_FRAME",
  "SILENT_ANIMATION",
  "FINAL_VIDEO",
];

const artifactKindLabels: Record<ArtifactKind, string> = {
  SOURCE_VIDEO: "Source video",
  EXTRACTED_CLIP: "Extracted clip",
  EXTRACTED_AUDIO: "Extracted audio",
  KEYFRAME: "Keyframe",
  STYLED_FRAME: "Styled frame",
  SILENT_ANIMATION: "Silent animation",
  FINAL_VIDEO: "Final video",
};

const artifactProviderLabels: Record<
  ProductionArtifactView["provider"],
  string
> = {
  MOCK: "Mock",
  OPENAI: "OpenAI",
  RUNWAY: "Runway",
  USER_UPLOAD: "User upload",
  FFMPEG: "FFmpeg",
};

export interface LineageRow {
  readonly id: string;
  readonly kind: ArtifactKind;
  readonly label: string;
  readonly providerLabel: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly sizeLabel: string;
  readonly createdAt: string;
  readonly sha256Prefix: string;
}

/**
 * Artifact lineage from source through final video, in pipeline order.
 * Unknown artifact kinds would break the fixed order, so they sort last.
 */
export function buildArtifactLineage(
  artifacts: readonly ProductionArtifactView[],
): LineageRow[] {
  const orderOf = (kind: ArtifactKind): number => {
    const index = lineageOrder.indexOf(kind);
    return index === -1 ? lineageOrder.length : index;
  };

  return [...artifacts]
    .sort(
      (left, right) =>
        orderOf(left.kind) - orderOf(right.kind) ||
        left.createdAt.localeCompare(right.createdAt),
    )
    .map((artifact) =>
      Object.freeze({
        id: artifact.id,
        kind: artifact.kind,
        label: artifactKindLabels[artifact.kind],
        providerLabel: artifactProviderLabels[artifact.provider],
        mimeType: artifact.mimeType,
        byteSize: artifact.byteSize,
        sizeLabel: formatBytes(artifact.byteSize),
        createdAt: artifact.createdAt,
        sha256Prefix: artifact.sha256.slice(0, 12),
      }),
    );
}

export interface OutputFacts {
  readonly durationSeconds?: number;
  readonly width?: number;
  readonly height?: number;
  readonly videoCodec?: string;
  readonly audioPresent?: boolean;
}

/**
 * Reads the probed output facts out of the final video artifact's metadata.
 * Mistyped or absent entries stay undefined instead of being guessed.
 */
export function outputFactsFromMetadata(
  metadata: Record<string, string | number | boolean | null> | undefined,
): OutputFacts {
  if (!metadata) return {};
  const duration = metadata.durationSeconds;
  const width = metadata.width;
  const height = metadata.height;
  const codec = metadata.videoCodec;
  const audio = metadata.audioPresent;
  return {
    durationSeconds: typeof duration === "number" ? duration : undefined,
    width: typeof width === "number" ? width : undefined,
    height: typeof height === "number" ? height : undefined,
    videoCodec: typeof codec === "string" ? codec : undefined,
    audioPresent: typeof audio === "boolean" ? audio : undefined,
  };
}

/** QUEUED and worker-owned statuses mean the job can still change. */
export function isJobActive(status: ProductionStatus): boolean {
  return (
    status === "QUEUED" ||
    workerOwnedStatuses.includes(status as (typeof workerOwnedStatuses)[number])
  );
}

/** A running stage shows "Still working" after this many seconds (UX §4). */
export const slowStageSeconds = 20;

export function formatSeconds(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "Unknown";
  return `${value.toFixed(1)}s`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/** Clock time for stage/decision timestamps; invalid input stays unknown. */
export function formatClockTime(iso: string | undefined): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
