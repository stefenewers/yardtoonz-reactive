import type { AgentKey, AgentRunEvidence } from "@/domain/agent-trace";
import type { ImageProvider, AnimationProvider } from "@/lib/providers";

/**
 * Pure orchestration planner. The sequencer derives the six-agent demo
 * story from persisted state only — it never mutates anything and never
 * guesses. Agent work itself stays in its owning subsystems (candidate
 * intake, the Director API, the production worker); the planner observes
 * their persisted outcomes, sequences the next step, and renders the
 * timeline the Control Center reads. Same snapshot in, same plan out.
 */

/** The canonical demo order of the six named agents. */
export const orchestrationSteps: readonly AgentKey[] = [
  "trend-scout",
  "humor-analyst",
  "yardtoonz-director",
  "clay-artist",
  "animator",
  "qa-inspector",
];

export type OrchestrationStepState =
  /** The agent's latest persisted run is COMPLETE. */
  | "COMPLETE"
  /** The agent's latest persisted run is FAILED. */
  | "FAILED"
  /** Prerequisites are satisfied; the agent's work has not run yet. */
  | "READY"
  /** A human gate (approval, rights, production, source upload) is pending. */
  | "BLOCKED";

/** What one step needs before its agent may act, as an honest gate label. */
export type OrchestrationBlocker =
  | "CANDIDATE_MISSING"
  | "PREVIOUS_STEP_INCOMPLETE"
  | "CANDIDATE_NOT_APPROVED"
  | "RIGHTS_NOT_CONFIRMED"
  | "PRODUCTION_MISSING"
  | "SOURCE_NOT_UPLOADED";

export interface AgentStepObservation {
  /** Latest terminal run for this agent, or null before its first run. */
  latestState: "COMPLETE" | "FAILED" | null;
  /** Attempt counter of the latest observed run; null before the first run. */
  attempt: number | null;
  decision: string | null;
  confidence: number | null;
  provider: string | null;
  model: string | null;
  elapsedMs: number | null;
  artifactIds: readonly string[];
  /** Bounded failure classification when the latest run FAILED. */
  errorCode: string | null;
}

export interface PersistedTreatmentSummary {
  readonly id: string;
  readonly provider: string;
  readonly claymationPromptSupplied: boolean;
  readonly motionPromptSupplied: boolean;
  readonly socialCaptionSupplied: boolean;
}

export interface PersistedProductionSummary {
  readonly id: string;
  readonly status: string;
  readonly imageProvider: ImageProvider;
  readonly animationProvider: AnimationProvider;
}

/**
 * Everything the planner knows, assembled from persisted rows. The server
 * snapshot builder fills this; the domain never touches the database.
 */
export interface OrchestrationSnapshot {
  readonly candidateId: string;
  readonly candidateExists: boolean;
  readonly candidateApproved: boolean;
  readonly rightsConfirmed: boolean;
  readonly commentCount: number;
  readonly metricsSupplied: boolean;
  readonly adaptationNoteSupplied: boolean;
  readonly hasKeyframe: boolean;
  readonly hasStyledFrame: boolean;
  readonly hasSilentAnimation: boolean;
  readonly hasFinalVideo: boolean;
  readonly production: PersistedProductionSummary | null;
  readonly treatment: PersistedTreatmentSummary | null;
  readonly observations: Readonly<Record<AgentKey, AgentStepObservation>>;
}

const emptyObservation: AgentStepObservation = {
  latestState: null,
  attempt: null,
  decision: null,
  confidence: null,
  provider: null,
  model: null,
  elapsedMs: null,
  artifactIds: [],
  errorCode: null,
};

/** An observation with no persisted runs for the agent. */
export function emptyStepObservation(): AgentStepObservation {
  return { ...emptyObservation, artifactIds: [] };
}

/**
 * Per-agent input assembly: the bounded record of persisted inputs each
 * step's agent consumes. Presence flags only — the planner reports what
 * an agent will receive, never fabricates content it did not get.
 */
export type AssembledStepInputs = AgentRunEvidence;

export function assembleStepInputs(
  agentKey: AgentKey,
  snapshot: OrchestrationSnapshot,
): AssembledStepInputs {
  const base = {
    candidateExists: snapshot.candidateExists,
    commentCount: snapshot.commentCount,
    metricsSupplied: snapshot.metricsSupplied,
  } as const;

  switch (agentKey) {
    case "trend-scout":
      return {
        ...base,
        adaptationNoteSupplied: snapshot.adaptationNoteSupplied,
      };
    case "humor-analyst":
      return base;
    case "yardtoonz-director":
      return {
        ...base,
        adaptationNoteSupplied: snapshot.adaptationNoteSupplied,
        creativeDirectionSupplied: snapshot.production?.status !== undefined,
        treatmentExists: snapshot.treatment !== null,
      };
    case "clay-artist":
      return {
        ...base,
        imageProvider: snapshot.production?.imageProvider ?? null,
        keyframePresent: snapshot.hasKeyframe,
        treatmentPresent: snapshot.treatment !== null,
      };
    case "animator":
      return {
        ...base,
        animationProvider: snapshot.production?.animationProvider ?? null,
        styledFramePresent: snapshot.hasStyledFrame,
      };
    case "qa-inspector":
      return {
        ...base,
        finalVideoPresent: snapshot.hasFinalVideo,
        imageProvider: snapshot.production?.imageProvider ?? null,
        animationProvider: snapshot.production?.animationProvider ?? null,
      };
    default: {
      // Exhaustive over agentKeys so a new agent forces a compile error.
      const exhaustive: never = agentKey;
      throw new Error(`No input assembly for agent ${String(exhaustive)}`);
    }
  }
}

/**
 * Prerequisites per step, in demo order. Every step requires the previous
 * step COMPLETE (the sequence is strictly linear); the media steps add the
 * human gates the MVP already enforces — approval, rights, production, and
 * an uploaded source. Missing prerequisites BLOCK; nothing here bypasses
 * the human control the MVP locks in.
 */
export function stepBlockers(
  agentKey: AgentKey,
  snapshot: OrchestrationSnapshot,
): OrchestrationBlocker[] {
  const previous = previousStep(agentKey);
  const blockers: OrchestrationBlocker[] = [];

  if (!snapshot.candidateExists) blockers.push("CANDIDATE_MISSING");
  if (previous && snapshot.observations[previous].latestState !== "COMPLETE") {
    blockers.push("PREVIOUS_STEP_INCOMPLETE");
  }

  switch (agentKey) {
    case "trend-scout":
    case "humor-analyst":
      return blockers;
    case "yardtoonz-director":
      if (!snapshot.candidateApproved) blockers.push("CANDIDATE_NOT_APPROVED");
      return blockers;
    case "clay-artist":
    case "animator":
    case "qa-inspector": {
      if (!snapshot.rightsConfirmed) blockers.push("RIGHTS_NOT_CONFIRMED");
      if (snapshot.production === null) blockers.push("PRODUCTION_MISSING");
      if (agentKey === "clay-artist" && !snapshot.hasKeyframe) {
        blockers.push("SOURCE_NOT_UPLOADED");
      }
      return blockers;
    }
    default: {
      const exhaustive: never = agentKey;
      throw new Error(`No gate model for agent ${String(exhaustive)}`);
    }
  }
}

/** The step immediately before this one in the demo sequence, or null for the first. */
export function previousStep(agentKey: AgentKey): AgentKey | null {
  const index = orchestrationSteps.indexOf(agentKey);
  if (index <= 0) return null;
  return orchestrationSteps[index - 1] ?? null;
}

function deriveStepState(
  observation: AgentStepObservation,
  blockers: readonly OrchestrationBlocker[],
): OrchestrationStepState {
  if (observation.latestState === "COMPLETE") return "COMPLETE";
  if (observation.latestState === "FAILED") return "FAILED";
  return blockers.length === 0 ? "READY" : "BLOCKED";
}

// ---------------------------------------------------------------------------
// Typed handoff messages
// ---------------------------------------------------------------------------

export const handoffKinds = [
  "CANDIDATE_BRIEF",
  "ANALYSIS_BRIEF",
  "TREATMENT_BRIEF",
  "STYLED_FRAME_HANDOFF",
  "ANIMATION_HANDOFF",
] as const;
export type HandoffKind = (typeof handoffKinds)[number];

/**
 * A typed handoff: what a completed agent passes to the next one. Payloads
 * carry bounded scalars and presence flags — ids, counts, providers — so a
 * handoff is safe to render and never restates unbounded content.
 */
export interface HandoffMessage {
  readonly kind: HandoffKind;
  readonly fromAgent: AgentKey;
  readonly toAgent: AgentKey;
  readonly summary: string;
  readonly payload: AgentRunEvidence;
}

const handoffForKind = {
  CANDIDATE_BRIEF: {
    from: "trend-scout",
    to: "humor-analyst",
  },
  ANALYSIS_BRIEF: {
    from: "humor-analyst",
    to: "yardtoonz-director",
  },
  TREATMENT_BRIEF: {
    from: "yardtoonz-director",
    to: "clay-artist",
  },
  STYLED_FRAME_HANDOFF: {
    from: "clay-artist",
    to: "animator",
  },
  ANIMATION_HANDOFF: {
    from: "animator",
    to: "qa-inspector",
  },
} as const satisfies Record<
  HandoffKind,
  { readonly from: AgentKey; readonly to: AgentKey }
>;

/**
 * The handoff from a completed step to its successor, or null while the
 * sender has not completed its work — a handoff is an observed fact, not
 * an intention.
 */
export function buildHandoff(
  kind: HandoffKind,
  snapshot: OrchestrationSnapshot,
): HandoffMessage | null {
  const route = handoffForKind[kind];
  const observation = snapshot.observations[route.from];
  if (observation.latestState !== "COMPLETE") return null;

  switch (kind) {
    case "CANDIDATE_BRIEF":
      return {
        kind,
        fromAgent: route.from,
        toAgent: route.to,
        summary: `Trend Scout handed off the imported candidate with ${snapshot.commentCount} comment excerpts.`,
        payload: {
          candidateId: snapshot.candidateId,
          commentCount: snapshot.commentCount,
          metricsSupplied: snapshot.metricsSupplied,
          adaptationNoteSupplied: snapshot.adaptationNoteSupplied,
        },
      };
    case "ANALYSIS_BRIEF":
      return {
        kind,
        fromAgent: route.from,
        toAgent: route.to,
        summary:
          "Humor Analyst handed off the scored candidate for creative treatment.",
        payload: {
          commentCount: snapshot.commentCount,
          metricsSupplied: snapshot.metricsSupplied,
          candidateApproved: snapshot.candidateApproved,
        },
      };
    case "TREATMENT_BRIEF": {
      const treatment = snapshot.treatment;
      if (!treatment) return null;
      return {
        kind,
        fromAgent: route.from,
        toAgent: route.to,
        summary: `Director handed off the treatment (${treatment.provider}) to the Clay Artist.`,
        payload: {
          treatmentId: treatment.id,
          provider: treatment.provider,
          claymationPromptSupplied: treatment.claymationPromptSupplied,
          motionPromptSupplied: treatment.motionPromptSupplied,
          socialCaptionSupplied: treatment.socialCaptionSupplied,
        },
      };
    }
    case "STYLED_FRAME_HANDOFF": {
      const artifactId = observation.artifactIds[0];
      if (!artifactId) return null;
      return {
        kind,
        fromAgent: route.from,
        toAgent: route.to,
        summary: "Clay Artist handed off the styled frame for animation.",
        payload: {
          styledFrameArtifactId: artifactId,
          imageProvider: observation.provider,
          model: observation.model,
        },
      };
    }
    case "ANIMATION_HANDOFF": {
      const artifactId = observation.artifactIds[0];
      if (!artifactId) return null;
      return {
        kind,
        fromAgent: route.from,
        toAgent: route.to,
        summary: "Animator handed off the animation for output QA.",
        payload: {
          animationArtifactId: artifactId,
          animationProvider: observation.provider,
          model: observation.model,
        },
      };
    }
    default: {
      const exhaustive: never = kind;
      throw new Error(`No handoff builder for kind ${String(exhaustive)}`);
    }
  }
}

/** Handoffs for every adjacent pair whose sender is COMPLETE, in demo order. */
export function buildHandoffSequence(
  snapshot: OrchestrationSnapshot,
): HandoffMessage[] {
  const messages: HandoffMessage[] = [];
  for (let index = 0; index < handoffKinds.length; index += 1) {
    const kind = handoffKinds[index];
    const message = kind ? buildHandoff(kind, snapshot) : null;
    if (message) messages.push(message);
  }
  return messages;
}

// ---------------------------------------------------------------------------
// The plan and the timeline driver
// ---------------------------------------------------------------------------

export interface PlannedStep {
  readonly agentKey: AgentKey;
  readonly state: OrchestrationStepState;
  readonly blockers: readonly OrchestrationBlocker[];
  /** Persisted inputs the agent will consume for this step. */
  readonly inputs: AssembledStepInputs;
  /** Typed handoff received from the previous agent, when observed. */
  readonly handoffIn: HandoffMessage | null;
  /** Attempt of the latest observed run for this step, when any. */
  readonly attempt: number | null;
  readonly decision: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly elapsedMs: number | null;
  readonly confidence: number | null;
  readonly artifactIds: readonly string[];
  /** Safe error classification from the latest failed run, when any. */
  readonly errorCode: string | null;
}

export interface OrchestrationPlan {
  readonly candidateId: string;
  readonly steps: readonly PlannedStep[];
  /** First step not yet COMPLETE — the run cursor. */
  readonly currentStepKey: AgentKey | null;
  /** True when all six steps are COMPLETE. */
  readonly complete: boolean;
  /** The failed step when the cursor is FAILED, else null. */
  readonly failedStepKey: AgentKey | null;
  /** Safe error classification of the failed step, when any. */
  readonly errorCode: string | null;
}

/**
 * Deterministically plan the six-agent run from persisted state. Pure and
 * idempotent: the same snapshot always yields the same plan, and planning
 * twice never duplicates a step or advances anything.
 */
export function planRun(snapshot: OrchestrationSnapshot): OrchestrationPlan {
  const handoffs = new Map<AgentKey, HandoffMessage>();
  for (const message of buildHandoffSequence(snapshot)) {
    handoffs.set(message.toAgent, message);
  }

  const steps = orchestrationSteps.map((agentKey) => {
    const observation =
      snapshot.observations[agentKey] ?? emptyStepObservation();
    const blockers = stepBlockers(agentKey, snapshot);
    return {
      agentKey,
      state: deriveStepState(observation, blockers),
      blockers,
      inputs: assembleStepInputs(agentKey, snapshot),
      handoffIn: handoffs.get(agentKey) ?? null,
      attempt: observation.attempt,
      decision: observation.decision,
      provider: observation.provider,
      model: observation.model,
      elapsedMs: observation.elapsedMs,
      confidence: observation.confidence,
      artifactIds: observation.artifactIds,
      errorCode: observation.errorCode,
    } satisfies PlannedStep;
  });

  const currentStepKey =
    steps.find((step) => step.state !== "COMPLETE")?.agentKey ?? null;
  const failedStep = steps.find((step) => step.state === "FAILED") ?? null;

  return {
    candidateId: snapshot.candidateId,
    steps,
    currentStepKey,
    complete: currentStepKey === null,
    failedStepKey: failedStep?.agentKey ?? null,
    errorCode: failedStep?.errorCode ?? null,
  };
}

/** One timeline row: what the Control Center renders for an agent step. */
export interface TimelineStep {
  readonly agentKey: AgentKey;
  readonly state: OrchestrationStepState;
  readonly blockers: readonly OrchestrationBlocker[];
  readonly inputs: AssembledStepInputs;
  readonly handoffIn: HandoffMessage | null;
  readonly attempt: number | null;
  readonly decision: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly elapsedMs: number | null;
  readonly confidence: number | null;
  readonly artifactIds: readonly string[];
  readonly errorCode: string | null;
}

export interface OrchestrationTimeline {
  readonly candidateId: string;
  readonly steps: readonly TimelineStep[];
  readonly currentStepKey: AgentKey | null;
  readonly completedCount: number;
  readonly totalCount: number;
  readonly complete: boolean;
  readonly failedStepKey: AgentKey | null;
  readonly errorCode: string | null;
}

/**
 * The demo timeline driver: the ordered, per-agent view the Control Center
 * reads. Derived purely from the plan — refreshes and re-reads render the
 * same story from the same persisted rows.
 */
export function buildOrchestrationTimeline(
  plan: OrchestrationPlan,
): OrchestrationTimeline {
  return {
    candidateId: plan.candidateId,
    steps: plan.steps.map((step) => ({
      agentKey: step.agentKey,
      state: step.state,
      blockers: step.blockers,
      inputs: step.inputs,
      handoffIn: step.handoffIn,
      attempt: step.attempt,
      decision: step.decision,
      provider: step.provider,
      model: step.model,
      elapsedMs: step.elapsedMs,
      confidence: step.confidence,
      artifactIds: step.artifactIds,
      errorCode: step.errorCode,
    })),
    currentStepKey: plan.currentStepKey,
    completedCount: plan.steps.filter((step) => step.state === "COMPLETE")
      .length,
    totalCount: orchestrationSteps.length,
    complete: plan.complete,
    failedStepKey: plan.failedStepKey,
    errorCode: plan.errorCode,
  };
}

/** True when the run's failure is recoverable by resuming after a retry. */
export function isRecoverableFailure(plan: OrchestrationPlan): boolean {
  return plan.failedStepKey !== null;
}

/**
 * Human-readable blocker label for the timeline: why the step cannot act
 * yet. Bounded, honest, and safe to render.
 */
export function blockerLabel(blocker: OrchestrationBlocker): string {
  switch (blocker) {
    case "CANDIDATE_MISSING":
      return "Candidate not found.";
    case "PREVIOUS_STEP_INCOMPLETE":
      return "Waiting on the previous agent to complete.";
    case "CANDIDATE_NOT_APPROVED":
      return "Waiting for editorial approval of the candidate.";
    case "RIGHTS_NOT_CONFIRMED":
      return "Waiting for rights confirmation.";
    case "PRODUCTION_MISSING":
      return "Waiting for a production to be created.";
    case "SOURCE_NOT_UPLOADED":
      return "Waiting for the authorized source upload.";
    default: {
      const exhaustive: never = blocker;
      throw new Error(`No label for blocker ${String(exhaustive)}`);
    }
  }
}
