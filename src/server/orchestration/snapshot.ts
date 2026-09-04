import { and, asc, desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type { AgentKey, AgentRunEvidence } from "@/domain/agent-trace";
import { agentKeys } from "@/domain/agent-trace";
import { directorTreatmentSchema } from "@/domain/director";
import {
  type AgentStepObservation,
  type OrchestrationSnapshot,
  type PersistedTreatmentSummary,
  emptyStepObservation,
} from "@/domain/orchestration";
import { engagementMetricsSchema } from "@/shared/candidates";

import {
  agentRuns,
  candidates,
  candidateComments,
  directorTreatments,
  productions,
  rightsConfirmations,
  artifacts,
} from "../db/schema";
import type * as schema from "../db/schema";

type Database = BetterSQLite3Database<typeof schema>;

/**
 * Assemble the planner's snapshot from persisted rows: the candidate and
 * its comments, the rights record, the production and its artifacts, the
 * Director treatment, and the latest observed run per agent. Reads only —
 * step progress lives in the agent_runs trace, never here.
 */
export function buildOrchestrationSnapshot(
  database: Database,
  candidateId: string,
): OrchestrationSnapshot {
  const candidateRow = database
    .select({
      status: candidates.status,
      metricsJson: candidates.metricsJson,
      adaptationNote: candidates.adaptationNote,
    })
    .from(candidates)
    .where(eq(candidates.id, candidateId))
    .get();

  if (!candidateRow) {
    // A missing candidate still yields a well-formed snapshot: the planner
    // reports CANDIDATE_MISSING instead of throwing, and the API maps the
    // run-level case to 404 separately.
    return {
      candidateId,
      candidateExists: false,
      candidateApproved: false,
      rightsConfirmed: false,
      commentCount: 0,
      metricsSupplied: false,
      adaptationNoteSupplied: false,
      hasKeyframe: false,
      hasStyledFrame: false,
      hasSilentAnimation: false,
      hasFinalVideo: false,
      production: null,
      treatment: null,
      observations: emptyObservations(),
    };
  }

  const commentCount = database
    .select({ id: candidateComments.id })
    .from(candidateComments)
    .where(eq(candidateComments.candidateId, candidateId))
    .all().length;

  const rightsRow = database
    .select({ id: rightsConfirmations.id })
    .from(rightsConfirmations)
    .where(eq(rightsConfirmations.candidateId, candidateId))
    .get();

  const productionRow = database
    .select({
      id: productions.id,
      status: productions.status,
      imageProvider: productions.imageProvider,
      animationProvider: productions.animationProvider,
    })
    .from(productions)
    .where(eq(productions.candidateId, candidateId))
    .orderBy(desc(productions.createdAt), desc(productions.id))
    .get();

  let hasKeyframe = false;
  let hasStyledFrame = false;
  let hasSilentAnimation = false;
  let hasFinalVideo = false;
  if (productionRow) {
    const kinds = database
      .select({ kind: artifacts.kind })
      .from(artifacts)
      .where(eq(artifacts.productionId, productionRow.id))
      .all();
    for (const { kind } of kinds) {
      if (kind === "KEYFRAME") hasKeyframe = true;
      if (kind === "STYLED_FRAME") hasStyledFrame = true;
      if (kind === "SILENT_ANIMATION") hasSilentAnimation = true;
      if (kind === "FINAL_VIDEO") hasFinalVideo = true;
    }
  }

  const treatmentRow = database
    .select({
      id: directorTreatments.id,
      treatmentJson: directorTreatments.treatmentJson,
      provider: directorTreatments.provider,
    })
    .from(directorTreatments)
    .where(eq(directorTreatments.candidateId, candidateId))
    .get();

  let treatment: PersistedTreatmentSummary | null = null;
  if (treatmentRow) {
    // Round-trip through the Director contract; a drifted row degrades to
    // "prompt not supplied" flags rather than crashing the planner.
    const parsed = directorTreatmentSchema.safeParse(
      JSON.parse(treatmentRow.treatmentJson) as unknown,
    );
    treatment = {
      id: treatmentRow.id,
      provider: treatmentRow.provider,
      claymationPromptSupplied: parsed.success
        ? typeof parsed.data.claymationPrompt === "string" &&
          parsed.data.claymationPrompt.length > 0
        : false,
      motionPromptSupplied: parsed.success
        ? typeof parsed.data.motionPrompt === "string" &&
          parsed.data.motionPrompt.length > 0
        : false,
      socialCaptionSupplied: parsed.success
        ? typeof parsed.data.socialCaption === "string" &&
          parsed.data.socialCaption.length > 0
        : false,
    };
  }

  const metrics = engagementMetricsSchema.safeParse(
    JSON.parse(candidateRow.metricsJson) as unknown,
  );
  const metricsSupplied =
    metrics.success &&
    Object.values(metrics.data).some((value) => value !== undefined);

  return {
    candidateId,
    candidateExists: true,
    candidateApproved: candidateRow.status === "APPROVED",
    rightsConfirmed: rightsRow !== undefined,
    commentCount,
    metricsSupplied,
    adaptationNoteSupplied:
      typeof candidateRow.adaptationNote === "string" &&
      candidateRow.adaptationNote.trim().length > 0,
    hasKeyframe,
    hasStyledFrame,
    hasSilentAnimation,
    hasFinalVideo,
    production: productionRow
      ? {
          id: productionRow.id,
          status: productionRow.status,
          imageProvider: productionRow.imageProvider,
          animationProvider: productionRow.animationProvider,
        }
      : null,
    treatment,
    observations: latestObservationsByAgent(database, candidateId),
  };
}

function emptyObservations(): Record<AgentKey, AgentStepObservation> {
  const observations = {} as Record<AgentKey, AgentStepObservation>;
  for (const agentKey of agentKeys) {
    observations[agentKey] = emptyStepObservation();
  }
  return observations;
}

/**
 * Latest observed run per agent, keyed by agentKey. Runs are inserted in
 * chronological order, so the highest id per agent is the latest.
 */
function latestObservationsByAgent(
  database: Database,
  candidateId: string,
): Record<AgentKey, AgentStepObservation> {
  const rows = database
    .select({
      agentKey: agentRuns.agentKey,
      state: agentRuns.state,
      attempt: agentRuns.attempt,
      decision: agentRuns.decision,
      confidence: agentRuns.confidence,
      provider: agentRuns.provider,
      model: agentRuns.model,
      elapsedMs: agentRuns.elapsedMs,
      artifactIdsJson: agentRuns.artifactIdsJson,
      inputEvidenceJson: agentRuns.inputEvidenceJson,
    })
    .from(agentRuns)
    .where(eq(agentRuns.candidateId, candidateId))
    .orderBy(asc(agentRuns.id))
    .all();

  const observations = emptyObservations();
  for (const row of rows) {
    if (row.state !== "COMPLETE" && row.state !== "FAILED") continue;
    const evidence = parseEvidence(row.inputEvidenceJson);
    observations[row.agentKey] = {
      latestState: row.state,
      attempt: row.attempt,
      decision: row.decision ?? null,
      confidence: row.confidence ?? null,
      provider: row.provider ?? null,
      model: row.model ?? null,
      elapsedMs: row.elapsedMs ?? null,
      artifactIds: parseArtifactIds(row.artifactIdsJson),
      errorCode:
        row.state === "FAILED" && typeof evidence.errorCode === "string"
          ? evidence.errorCode
          : null,
    };
  }
  return observations;
}

function parseEvidence(json: string): AgentRunEvidence {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as AgentRunEvidence;
    }
    return {};
  } catch {
    return {};
  }
}

function parseArtifactIds(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (value): value is string => typeof value === "string",
      );
    }
    return [];
  } catch {
    return [];
  }
}

/** Guard used by the service: does the candidate exist at all? */
export function candidateExists(
  database: Database,
  candidateId: string,
): boolean {
  return (
    database
      .select({ id: candidates.id })
      .from(candidates)
      .where(and(eq(candidates.id, candidateId)))
      .get() !== undefined
  );
}
