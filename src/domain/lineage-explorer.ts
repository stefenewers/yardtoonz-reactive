import { type ArtifactKind } from "./production";
import { formatBytes, formatClockTime } from "./job-output";
import type {
  ProductionArtifactView,
  ProductionView,
} from "../shared/productions";

/**
 * Pure view-model for the lineage explorer. The explorer is the
 * *explanation* surface over the same persisted artifact rows the job
 * monitor renders as a timeline: every artifact (including superseded
 * retries) stays inspectable, grouped into pipeline stages with an
 * interactive chain. The component renders whatever these functions
 * return, so graph state, ordering, and inspector facts stay
 * independently testable (AGENTS.md: domain transformations are pure).
 */

export type PreviewKind = "image" | "video" | "audio" | "none";

/** What the inspector can safely render for this artifact's MIME type. */
export function previewKindForMime(mimeType: string): PreviewKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "none";
}

const providerLabels: Record<ProductionArtifactView["provider"], string> = {
  MOCK: "Mock",
  OPENAI: "OpenAI",
  RUNWAY: "Runway",
  USER_UPLOAD: "User upload",
  FFMPEG: "FFmpeg",
};

export type LineageNodeState = "latest" | "superseded";

export interface LineageNode {
  readonly id: string;
  readonly kind: ArtifactKind;
  readonly label: string;
  readonly providerLabel: string;
  readonly providerRequestId?: string;
  readonly mimeType: string;
  readonly previewKind: PreviewKind;
  readonly byteSize: number;
  readonly sizeLabel: string;
  readonly createdAt: string;
  readonly clockLabel: string;
  readonly sha256: string;
  readonly state: LineageNodeState;
}

export interface LineageStage {
  /** Ordered position in the pipeline chain, 0-based. */
  readonly index: number;
  readonly label: string;
  readonly kinds: readonly ArtifactKind[];
  readonly nodes: readonly LineageNode[];
}

/** Pipeline stages in production order. EXTRACTED_CLIP and EXTRACTED_AUDIO
 * are siblings born from the same extraction stage, so they share one stage
 * row; every other kind is its own step from source to final video. */
const stageBlueprints: readonly {
  label: string;
  kinds: readonly ArtifactKind[];
}[] = [
  { label: "Source clip", kinds: ["SOURCE_VIDEO"] },
  { label: "Extraction", kinds: ["EXTRACTED_CLIP", "EXTRACTED_AUDIO"] },
  { label: "Keyframe", kinds: ["KEYFRAME"] },
  { label: "Clay frame", kinds: ["STYLED_FRAME"] },
  { label: "Animation", kinds: ["SILENT_ANIMATION"] },
  { label: "Final output", kinds: ["FINAL_VIDEO"] },
];

function artifactLabel(kind: ArtifactKind): string {
  const blueprint = stageBlueprints.find((stage) => stage.kinds.includes(kind));
  if (!blueprint) return kind;
  const siblingIndex = blueprint.kinds.indexOf(kind);
  if (blueprint.kinds.length === 1) return blueprint.label;
  return siblingIndex === 0
    ? `${blueprint.label} (video)`
    : `${blueprint.label} (audio)`;
}

/**
 * Builds the interactive chain: one stage per pipeline step that has at
 * least one artifact, with every artifact as an inspectable node. Within a
 * kind the newest artifact is `latest` (retries supersede older rows, whose
 * checksums and provider facts remain worth drilling into). Stages without
 * artifacts are skipped — absence is shown through the graph-state banner,
 * not drawn as invented placeholders.
 */
export function buildLineageChain(
  artifacts: readonly ProductionArtifactView[],
): LineageStage[] {
  const nodesByKind = new Map<ArtifactKind, ProductionArtifactView[]>();
  for (const artifact of artifacts) {
    const existing = nodesByKind.get(artifact.kind) ?? [];
    existing.push(artifact);
    nodesByKind.set(artifact.kind, existing);
  }

  // Kinds the chain does not know (future schema additions) still belong
  // in the explorer — dropping them would hide stored evidence.
  const knownKinds = new Set<ArtifactKind>(
    stageBlueprints.flatMap((blueprint) => blueprint.kinds),
  );
  const unknownKinds = [...nodesByKind.keys()].filter(
    (kind) => !knownKinds.has(kind),
  );

  const stages: LineageStage[] = [];
  let index = 0;
  for (const blueprint of [
    ...stageBlueprints,
    { label: "Other artifacts", kinds: unknownKinds },
  ]) {
    const stageNodes: LineageNode[] = [];
    for (const kind of blueprint.kinds) {
      const kindArtifacts = [...(nodesByKind.get(kind) ?? [])].sort(
        (left, right) => left.createdAt.localeCompare(right.createdAt),
      );
      const latest = kindArtifacts.at(-1);
      for (const artifact of kindArtifacts) {
        stageNodes.push({
          id: artifact.id,
          kind: artifact.kind,
          label: artifactLabel(artifact.kind),
          providerLabel: providerLabels[artifact.provider],
          providerRequestId: artifact.providerRequestId,
          mimeType: artifact.mimeType,
          previewKind: previewKindForMime(artifact.mimeType),
          byteSize: artifact.byteSize,
          sizeLabel: formatBytes(artifact.byteSize),
          createdAt: artifact.createdAt,
          clockLabel: formatClockTime(artifact.createdAt),
          sha256: artifact.sha256,
          state: artifact.id === latest?.id ? "latest" : "superseded",
        });
      }
    }
    if (stageNodes.length > 0) {
      stages.push(
        Object.freeze({
          index,
          label: blueprint.label,
          kinds: blueprint.kinds,
          nodes: stageNodes,
        }),
      );
      index += 1;
    }
  }
  return stages;
}

/**
 * Overall graph health for the explorer banner. `complete` mirrors a
 * finished production, `failed` a failed one (partial chain intact for
 * inspection), `sparse` a still-growing chain, `empty` no artifacts at all.
 */
export type LineageGraphState = "empty" | "sparse" | "complete" | "failed";

export function lineageGraphState(
  productionStatus: ProductionView["status"],
  artifacts: readonly ProductionArtifactView[],
): LineageGraphState {
  if (artifacts.length === 0) return "empty";
  if (productionStatus === "FAILED") return "failed";
  if (productionStatus === "COMPLETE") return "complete";
  return "sparse";
}

export const lineageStateCopy: Record<
  LineageGraphState,
  { heading: string; detail: string }
> = {
  empty: {
    heading: "No artifacts yet",
    detail:
      "The lineage chain appears here as the pipeline stores its first artifacts.",
  },
  sparse: {
    heading: "Lineage in progress",
    detail:
      "Only completed stages appear below; the chain grows as the job advances.",
  },
  complete: {
    heading: "Complete lineage",
    detail:
      "Every pipeline stage produced an artifact. Drill into any node for its facts.",
  },
  failed: {
    heading: "Failed lineage",
    detail:
      "The job failed, but every artifact stored before the failure stays inspectable.",
  },
};

export interface InspectorField {
  readonly label: string;
  readonly value: string;
  /** Long technical values (checksums, request IDs) render mono. */
  readonly mono?: boolean;
}

const metadataFieldLabels: Record<string, string> = {
  durationSeconds: "Duration (seconds)",
  width: "Width",
  height: "Height",
  videoCodec: "Video codec",
  audioPresent: "Audio present",
  attempt: "Attempt",
  sourceName: "Source name",
  segmentStart: "Segment start (seconds)",
  segmentDuration: "Segment duration (seconds)",
};

function metadataFieldLabel(key: string): string {
  return metadataFieldLabels[key] ?? key;
}

/**
 * The drill-in facts for one artifact: identity, provider attribution,
 * integrity, and stored metadata. Metadata keys are humanized, values are
 * shown verbatim — nothing is guessed beyond the stored record.
 */
export function inspectArtifact(
  node: LineageNode,
  metadata: ProductionArtifactView["metadata"] | undefined,
): InspectorField[] {
  const fields: InspectorField[] = [
    { label: "Kind", value: node.label },
    { label: "Provider", value: node.providerLabel },
  ];
  if (node.providerRequestId) {
    fields.push({
      label: "Provider request ID",
      value: node.providerRequestId,
      mono: true,
    });
  }
  fields.push(
    { label: "Media type", value: node.mimeType, mono: true },
    {
      label: "Size",
      value: `${node.byteSize.toLocaleString()} bytes (${node.sizeLabel})`,
    },
    {
      label: "Created",
      value: node.clockLabel
        ? `${node.clockLabel} · ${node.createdAt}`
        : node.createdAt,
      mono: true,
    },
    { label: "SHA-256", value: node.sha256, mono: true },
    {
      label: "State",
      value:
        node.state === "latest"
          ? "Latest of its kind"
          : "Superseded by a retry",
    },
  );
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (value === null || value === "") continue;
    fields.push({
      label: metadataFieldLabel(key),
      value: String(value),
      mono: true,
    });
  }
  return fields;
}

/**
 * The canonical deep-link shape for one lineage node (or the whole
 * explorer when no artifact is named). The job monitor's timeline links
 * and the explorer's own selection sync both build on this, so the URL
 * contract has exactly one definition.
 */
export function lineageExplorerUrl(
  productionId: string,
  artifactId?: string,
): string {
  const base = `/lineage?production=${encodeURIComponent(productionId)}`;
  return artifactId
    ? `${base}&artifact=${encodeURIComponent(artifactId)}`
    : base;
}
