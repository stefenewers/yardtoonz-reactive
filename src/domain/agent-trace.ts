import type { AnimationProvider, ImageProvider } from "@/lib/providers";
import type { ValidationReport } from "@/domain/production";
import { SCORING_VERSION } from "@/domain/scoring";

/**
 * Pure vocabulary and mapping for the persisted agent-run trace. Every named
 * demo agent appears exactly once in `agentKeys`; pipeline stages map onto
 * the creative agents that own their work, and decision/evidence builders
 * keep every trace string honest — quoted facts come from received data,
 * deterministic engines are labeled as such, and nothing is fabricated.
 */

export const agentKeys = [
  "trend-scout",
  "humor-analyst",
  "yardtoonz-director",
  "clay-artist",
  "animator",
  "qa-inspector",
] as const;
export type AgentKey = (typeof agentKeys)[number];

export const agentRunStates = [
  "WAITING",
  "RUNNING",
  "COMPLETE",
  "FAILED",
] as const;
export type AgentRunState = (typeof agentRunStates)[number];

/**
 * Providers attributable to an agent run: the mock pipeline plus the live
 * image/animation providers. The Director's MOCK provider and QA Inspector's
 * local validation carry no external provider and persist NULL instead.
 */
export const agentRunProviders = ["MOCK", "OPENAI", "RUNWAY"] as const;
export type AgentRunProvider = (typeof agentRunProviders)[number];

/** Bounded scalar shape persisted as the run's input_evidence JSON. */
export type AgentRunEvidence = Record<string, string | number | boolean | null>;

const agentStages = {
  STYLE_IMAGE: "clay-artist",
  ANIMATE_IMAGE: "animator",
  VALIDATE_OUTPUT: "qa-inspector",
} as const satisfies Record<string, AgentKey>;

/** The named agent that owns a pipeline stage's work, or null for unmapped stages. */
export function agentKeyForStage(stageName: string): AgentKey | null {
  return (agentStages as Record<string, AgentKey | undefined>)[stageName] ?? null;
}

/**
 * Provider attribution for a stage-produced run: the persisted job selection
 * decides (never the environment), and stages with no provider — output
 * validation — persist null so the trace never claims a provider acted.
 */
export function stageProviderForRun(
  stageName: string,
  selection: {
    readonly imageProvider: ImageProvider;
    readonly animationProvider: AnimationProvider;
  },
): AgentRunProvider | null {
  switch (stageName) {
    case "STYLE_IMAGE":
      return selection.imageProvider;
    case "ANIMATE_IMAGE":
      return selection.animationProvider;
    default:
      return null;
  }
}

/**
 * Model label disclosed by stage artifact metadata: the live provider's
 * model name when present, else the deterministic pipeline version the mock
 * executors record (styleVersion / motionVersion). Null when the producing
 * stage discloses neither — never a guessed label.
 */
export function modelLabelFromMetadata(
  metadata: Record<string, unknown>,
): string | null {
  for (const key of ["model", "styleVersion", "motionVersion"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

/** Concise, honest decision text for a completed styling run. */
export function styledFrameRunDecision(provider: AgentRunProvider): string {
  return `Styled the keyframe with the ${provider} image provider.`;
}

/** Concise, honest decision text for a completed animation run. */
export function animatedFrameRunDecision(provider: AgentRunProvider): string {
  return `Animated the styled frame with the ${provider} animation provider.`;
}

/** Decision text for a passed deterministic output validation. */
export function validationRunDecision(
  report: Pick<ValidationReport, "width" | "height" | "durationSeconds">,
): string {
  return `Validated the final output: ${report.width}x${report.height} 9:16, audio present, ${report.durationSeconds}s duration.`;
}

/** Failed runs quote the safe, bounded stage error message verbatim. */
export function failedRunDecision(safeErrorMessage: string): string {
  return safeErrorMessage;
}

/** Evidence actually available to the deterministic momentum scoring pass. */
export function trendScoutEvidence(input: {
  readonly platform: string;
  readonly suppliedMetricCount: number;
  readonly publishedAtSupplied: boolean;
}): AgentRunEvidence {
  return {
    platform: input.platform,
    suppliedMetricCount: input.suppliedMetricCount,
    publishedAtSupplied: input.publishedAtSupplied,
    scoringVersion: SCORING_VERSION,
  };
}

/** Evidence actually available to the deterministic humor-response pass. */
export function humorAnalystEvidence(input: {
  readonly commentCount: number;
}): AgentRunEvidence {
  return {
    commentCount: input.commentCount,
    scoringVersion: SCORING_VERSION,
  };
}

/** Evidence the Director treatment was built from — presence flags, never content. */
export function directorRunEvidence(input: {
  readonly provider: AgentRunProvider;
  readonly metricCount: number;
  readonly commentCount: number;
  readonly adaptationNoteSupplied: boolean;
  readonly transcriptSupplied: boolean;
  readonly sourceVideoMetadataSupplied: boolean;
  readonly keyframeCount: number;
  readonly creativeDirectionSupplied: boolean;
}): AgentRunEvidence {
  return { ...input };
}

/** Evidence for a stage-produced run: the deterministic input fingerprint. */
export function stageRunEvidence(input: {
  readonly fingerprint: string;
}): AgentRunEvidence {
  return { fingerprint: input.fingerprint };
}

/** Evidence for the QA Inspector: the persisted validation report scalars. */
export function validationRunEvidence(
  report: ValidationReport,
): AgentRunEvidence {
  return {
    playable: report.playable,
    width: report.width,
    height: report.height,
    durationSeconds: report.durationSeconds,
    audioPresent: report.audioPresent,
  };
}
