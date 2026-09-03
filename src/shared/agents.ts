import { z } from "zod";

import {
  agentKeys,
  agentRunProviders,
  agentRunStates,
} from "../domain/agent-trace";

/**
 * Public contract for the persisted agent-run trace. The Control Center
 * reads one ordered run list per candidate or production; every field is
 * bounded and safe to render, mirroring the persisted agent_runs row.
 */

export const agentRunViewSchema = z
  .object({
    id: z.number().int().positive(),
    agentKey: z.enum(agentKeys),
    state: z.enum(agentRunStates),
    attempt: z.number().int().positive(),
    /** Concise honest summary of what the agent decided. */
    decision: z.string().trim().min(1).optional(),
    confidence: z.number().min(0).max(1).optional(),
    provider: z.enum(agentRunProviders).optional(),
    model: z.string().trim().min(1).optional(),
    /** Measured wall time of the observed work. */
    elapsedMs: z.number().int().nonnegative().optional(),
    /** Artifact ids the run produced, in stable order. */
    artifactIds: z.array(z.string().trim().min(1)),
    /** Bounded scalar record of the evidence the run actually received. */
    inputEvidence: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    ),
    candidateId: z.string().trim().min(1).optional(),
    productionId: z.string().trim().min(1).optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .readonly();
export type AgentRunView = z.infer<typeof agentRunViewSchema>;

export const agentTraceQuerySchema = z
  .object({
    candidateId: z.string().trim().min(1).optional(),
    productionId: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (query) =>
      (query.candidateId !== undefined) !== (query.productionId !== undefined),
    { message: "Provide exactly one of candidateId or productionId." },
  )
  .readonly();
export type AgentTraceQuery = z.infer<typeof agentTraceQuerySchema>;

export const agentTraceResponseSchema = z
  .object({
    /** Chronological run order: insertion order per subject. */
    runs: z.array(agentRunViewSchema),
  })
  .readonly();
export type AgentTraceResponse = z.infer<typeof agentTraceResponseSchema>;

export const agentTraceErrorCodes = [
  "INVALID_REQUEST",
  "CANDIDATE_NOT_FOUND",
  "PRODUCTION_NOT_FOUND",
  "INTERNAL_ERROR",
] as const;
export type AgentTraceErrorCode = (typeof agentTraceErrorCodes)[number];

export const agentErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.enum(agentTraceErrorCodes),
      message: z.string().trim().min(1),
    }),
  })
  .readonly();
