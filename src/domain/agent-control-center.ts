import type { AgentKey, AgentRunEvidence } from "./agent-trace";
import { agentKeyForStage, agentKeys } from "./agent-trace";
import { isJobActive } from "./job-output";
import type { ProductionStatus } from "./production";
import type { AgentRunView } from "@/shared/agents";

/**
 * Pure derivation for the Agent Control Center: the persisted trace only
 * ever holds terminal runs (COMPLETE/FAILED), so the WAITING and RUNNING
 * card states are derived — never invented — from the run list plus the
 * observed production status. Every string rendered by the Control Center
 * is produced here so it can be tested without a DOM.
 */

/** The agents one Control Center surface renders, in demo-story order. */
export type AgentRoster = readonly AgentKey[];

/** The full six-agent roster in demo-story order. */
export const sixAgentRoster: AgentRoster = agentKeys;

/** Media agents: the only runs a production-scoped trace can carry. */
export const mediaAgentRoster: AgentRoster = [
  "clay-artist",
  "animator",
  "qa-inspector",
];

const agentCardProfiles: Record<
  (typeof agentKeys)[number],
  { readonly label: string; readonly role: string }
> = {
  "trend-scout": {
    label: "Trend Scout",
    role: "Finds and ranks trend candidates",
  },
  "humor-analyst": {
    label: "Humor Analyst",
    role: "Explains the laughter with evidence",
  },
  "yardtoonz-director": {
    label: "YardToonz Director",
    role: "Turns evidence into a treatment",
  },
  "clay-artist": {
    label: "Clay Artist",
    role: "Styles the keyframe in clay",
  },
  animator: {
    label: "Animator",
    role: "Animates the styled frame",
  },
  "qa-inspector": {
    label: "QA Inspector",
    role: "Validates the final output",
  },
};

export type AgentCardState = "WAITING" | "RUNNING" | "COMPLETE" | "FAILED";

/** The visible facts of one agent's latest persisted (or derived) run. */
export interface AgentCardView {
  readonly agentKey: AgentKey;
  readonly label: string;
  readonly role: string;
  readonly state: AgentCardState;
  /** How many runs the trace holds for this agent (0 when waiting). */
  readonly runCount: number;
  readonly latestRun?: {
    readonly decision?: string;
    readonly confidence?: number;
    readonly provider?: AgentRunView["provider"];
    readonly model?: string;
    readonly elapsedMs?: number;
    readonly artifactIds: readonly string[];
    readonly evidence: AgentRunEvidence;
    readonly attempt: number;
    readonly updatedAt: string;
  };
}

export interface AgentCenterInputs {
  readonly runs: readonly AgentRunView[];
  /** Production subject only: the persisted status and active stage. */
  readonly productionStatus?: ProductionStatus;
  readonly activeStage?: string;
  /** Which agents this surface renders; defaults to the full six-card roster. */
  readonly agents?: AgentRoster;
}

function latestState(input: {
  readonly agentKey: AgentKey;
  readonly runs: readonly AgentRunView[];
  readonly activeAgent: AgentKey | null;
  readonly productionStatus: ProductionStatus | undefined;
}): AgentCardState {
  const latest = input.runs.findLast((run) => run.agentKey === input.agentKey);
  const productionWorking =
    input.productionStatus !== undefined &&
    isJobActive(input.productionStatus) &&
    input.activeAgent === input.agentKey;
  if (productionWorking) return "RUNNING";
  if (latest) return latest.state;
  return "WAITING";
}

/**
 * One card per roster agent in roster order: the agent's latest persisted
 * run supplies its facts, a mid-flight stage maps onto a RUNNING card, and
 * an agent with no run yet waits.
 */
export function deriveAgentCards(inputs: AgentCenterInputs): AgentCardView[] {
  const roster = inputs.agents ?? sixAgentRoster;
  const activeAgent = inputs.activeStage
    ? agentKeyForStage(inputs.activeStage)
    : null;

  return roster.map((agentKey) => {
    const agentRuns = inputs.runs.filter((run) => run.agentKey === agentKey);
    const latest = agentRuns.at(-1);
    return {
      agentKey,
      label: agentCardProfiles[agentKey].label,
      role: agentCardProfiles[agentKey].role,
      state: latestState({
        agentKey,
        runs: inputs.runs,
        activeAgent,
        productionStatus: inputs.productionStatus,
      }),
      runCount: agentRuns.length,
      latestRun: latest
        ? {
            decision: latest.decision,
            confidence: latest.confidence,
            provider: latest.provider,
            model: latest.model,
            elapsedMs: latest.elapsedMs,
            artifactIds: latest.artifactIds,
            evidence: latest.inputEvidence,
            attempt: latest.attempt,
            updatedAt: latest.updatedAt,
          }
        : undefined,
    };
  });
}

/**
 * The approval handoff between creative analysis and media generation.
 * Media generation stays behind the human approval + rights gate: the
 * banner appears when the Director's work exists but media has not begun,
 * and it disappears into APPROVED once the job is queued or running.
 */
export type AgentHandoffState =
  | "IDLE"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "COMPLETE";

export interface AgentHandoffInputs {
  readonly runs: readonly AgentRunView[];
  readonly productionStatus?: ProductionStatus;
}

export function deriveApprovalHandoff(
  inputs: AgentHandoffInputs,
): AgentHandoffState {
  if (inputs.productionStatus !== undefined) {
    if (inputs.productionStatus === "COMPLETE") return "COMPLETE";
    const mediaBegun =
      isJobActive(inputs.productionStatus) ||
      inputs.productionStatus === "FAILED" ||
      inputs.runs.some((run) =>
        (mediaAgentRoster as readonly string[]).includes(run.agentKey),
      );
    if (mediaBegun) return "APPROVED";
    // A drafted or rights-confirmed production still awaits the human
    // approval that queues media generation.
    return "AWAITING_APPROVAL";
  }

  // Candidate subject: stage runs cannot exist here, so media begins only
  // through a production this view cannot see — the handoff holds until one
  // is approved into existence.
  const directorComplete = inputs.runs.some(
    (run) => run.agentKey === "yardtoonz-director" && run.state === "COMPLETE",
  );
  return directorComplete ? "AWAITING_APPROVAL" : "IDLE";
}

/** Provider label for a run's attributed provider; null is deterministic work. */
export function agentProviderLabel(
  provider: AgentRunView["provider"],
): string | undefined {
  switch (provider) {
    case "MOCK":
      return "Mock";
    case "OPENAI":
      return "OpenAI (live)";
    case "RUNWAY":
      return "Runway (live)";
    default:
      return undefined;
  }
}

/** Confidence as a whole percent; the card never invents a missing value. */
export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/** Measured wall time, honest to the unit the trace recorded. */
export function formatElapsedMs(elapsedMs: number): string {
  if (elapsedMs < 1000) return `${elapsedMs}ms`;
  const seconds = elapsedMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

/** camelCase and snake_case evidence keys as readable labels. */
export function humanizeEvidenceKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** One bounded evidence scalar per row; null means the input was absent. */
export function evidenceRows(evidence: AgentRunEvidence): Array<{
  readonly label: string;
  readonly value: string;
}> {
  return Object.entries(evidence).map(([key, value]) => ({
    label: humanizeEvidenceKey(key),
    value:
      value === null
        ? "—"
        : typeof value === "boolean"
          ? value
            ? "yes"
            : "no"
          : String(value),
  }));
}
