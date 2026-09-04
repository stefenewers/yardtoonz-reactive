import { z } from "zod";

import { orchestrationSteps } from "../domain/orchestration";

/**
 * Public contracts for the orchestration sequencer: run resources, typed
 * handoff messages, and the demo timeline the Control Center reads. Every
 * payload is bounded and safe to render; unknown future fields are
 * rejected so a drifted row fails loudly at the boundary.
 */

export const orchestrationStepKeys = orchestrationSteps;
export const orchestrationStepKeySchema = z.enum(orchestrationSteps);
export type OrchestrationStepKey = (typeof orchestrationSteps)[number];

export const orchestrationStepStates = [
  "COMPLETE",
  "FAILED",
  "READY",
  "BLOCKED",
] as const;
export const orchestrationStepStateSchema = z.enum(orchestrationStepStates);
export type OrchestrationStepState = z.infer<
  typeof orchestrationStepStateSchema
>;

export const orchestrationBlockers = [
  "CANDIDATE_MISSING",
  "PREVIOUS_STEP_INCOMPLETE",
  "CANDIDATE_NOT_APPROVED",
  "RIGHTS_NOT_CONFIRMED",
  "PRODUCTION_MISSING",
  "SOURCE_NOT_UPLOADED",
] as const;
export const orchestrationBlockerSchema = z.enum(orchestrationBlockers);
export type OrchestrationBlocker = z.infer<typeof orchestrationBlockerSchema>;

export const orchestrationRunStatuses = [
  "RUNNING",
  "COMPLETE",
  "FAILED",
  "CANCELLED",
] as const;
export const orchestrationRunStatusSchema = z.enum(orchestrationRunStatuses);
export type OrchestrationRunStatus = z.infer<
  typeof orchestrationRunStatusSchema
>;

const evidenceValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
export const stepInputsSchema = z.record(z.string(), evidenceValueSchema);

export const handoffKindSchema = z.enum([
  "CANDIDATE_BRIEF",
  "ANALYSIS_BRIEF",
  "TREATMENT_BRIEF",
  "STYLED_FRAME_HANDOFF",
  "ANIMATION_HANDOFF",
]);

/** Typed handoff message between two adjacent agents, in demo order. */
export const handoffMessageSchema = z
  .object({
    kind: handoffKindSchema,
    fromAgent: orchestrationStepKeySchema,
    toAgent: orchestrationStepKeySchema,
    summary: z.string().trim().min(1).max(400),
    payload: z.record(z.string(), evidenceValueSchema),
  })
  .strict()
  .readonly();
export type HandoffMessage = z.infer<typeof handoffMessageSchema>;

/** One timeline row for one agent step. */
export const orchestrationStepViewSchema = z
  .object({
    agentKey: orchestrationStepKeySchema,
    state: orchestrationStepStateSchema,
    blockers: z.array(orchestrationBlockerSchema),
    /** Persisted inputs the agent consumes for this step. */
    inputs: stepInputsSchema,
    /** Typed handoff received from the previous agent, when observed. */
    handoffIn: handoffMessageSchema.nullable(),
    attempt: z.number().int().positive().nullable(),
    decision: z.string().max(1000).nullable(),
    provider: z.string().max(40).nullable(),
    model: z.string().max(200).nullable(),
    elapsedMs: z.number().int().nonnegative().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    artifactIds: z.array(z.string().trim().min(1)),
    errorCode: z.string().max(120).nullable(),
  })
  .strict()
  .readonly();
export type OrchestrationStepView = z.infer<typeof orchestrationStepViewSchema>;

/** The demo timeline driver payload: ordered rows plus run progress. */
export const orchestrationTimelineSchema = z
  .object({
    candidateId: z.string().trim().min(1),
    steps: z
      .array(orchestrationStepViewSchema)
      .length(orchestrationSteps.length),
    currentStepKey: orchestrationStepKeySchema.nullable(),
    completedCount: z.number().int().nonnegative(),
    totalCount: z.number().int().positive(),
    complete: z.boolean(),
    failedStepKey: orchestrationStepKeySchema.nullable(),
    errorCode: z.string().max(120).nullable(),
  })
  .strict()
  .readonly();
export type OrchestrationTimeline = z.infer<typeof orchestrationTimelineSchema>;

/** One persisted orchestration run. */
export const orchestrationRunResourceSchema = z
  .object({
    id: z.string().trim().min(1),
    candidateId: z.string().trim().min(1),
    status: orchestrationRunStatusSchema,
    currentStepKey: orchestrationStepKeySchema.nullable(),
    errorCode: z.string().max(120).nullable(),
    safeErrorMessage: z.string().max(400).nullable(),
    startedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
  })
  .strict()
  .readonly();
export type OrchestrationRunResource = z.infer<
  typeof orchestrationRunResourceSchema
>;

export const startRunRequestSchema = z
  .object({ candidateId: z.string().trim().min(1) })
  .strict()
  .readonly();
export type StartRunRequest = z.infer<typeof startRunRequestSchema>;

/** A run detail always pairs the run with its freshly derived timeline. */
export const runDetailResponseSchema = z
  .object({
    run: orchestrationRunResourceSchema,
    timeline: orchestrationTimelineSchema,
  })
  .strict()
  .readonly();
export type RunDetailResponse = z.infer<typeof runDetailResponseSchema>;

export const listRunsResponseSchema = z
  .object({ runs: z.array(orchestrationRunResourceSchema) })
  .strict()
  .readonly();
export type ListRunsResponse = z.infer<typeof listRunsResponseSchema>;

export const orchestrationRunsQuerySchema = z
  .object({ candidateId: z.string().trim().min(1) })
  .strict()
  .readonly();

export const cancelRunRequestSchema = z
  .object({ reason: z.string().trim().min(1).max(400).optional() })
  .strict()
  .readonly();

export const orchestrationErrorCodes = [
  "INVALID_REQUEST",
  "CANDIDATE_NOT_FOUND",
  "RUN_NOT_FOUND",
  "RESUME_NOT_ALLOWED",
  "CANCEL_NOT_ALLOWED",
  "INTERNAL_ERROR",
] as const;
export type OrchestrationErrorCode = (typeof orchestrationErrorCodes)[number];

export const orchestrationErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.enum(orchestrationErrorCodes),
      message: z.string().trim().min(1),
    }),
  })
  .strict()
  .readonly();
