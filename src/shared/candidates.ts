import { z } from "zod";

export const candidateStatuses = ["NEW", "APPROVED", "REJECTED"] as const;
export const sourcePlatforms = [
  "TIKTOK",
  "INSTAGRAM",
  "YOUTUBE",
  "OTHER",
] as const;
export const fitChecklistKeys = [
  "clearPremise",
  "recognizableScenario",
  "payoffWithinEightSeconds",
  "authorizedAudio",
  "visuallySimple",
  "culturallyRelevant",
] as const;

const optionalMetricSchema = z.number().int().nonnegative().optional();
export const engagementMetricsSchema = z
  .object({
    views: optionalMetricSchema,
    likes: optionalMetricSchema,
    comments: optionalMetricSchema,
    shares: optionalMetricSchema,
    saves: optionalMetricSchema,
  })
  .readonly();

export const fitChecklistSchema = z
  .object({
    clearPremise: z.boolean(),
    recognizableScenario: z.boolean(),
    payoffWithinEightSeconds: z.boolean(),
    authorizedAudio: z.boolean(),
    visuallySimple: z.boolean(),
    culturallyRelevant: z.boolean(),
  })
  .readonly();

export const scoreEvidenceSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    explanation: z.string().trim().min(1),
    inputsUsed: z.array(z.string().trim().min(1)),
  })
  .readonly();

export const candidateScoresSchema = z
  .object({
    viralMomentum: scoreEvidenceSchema,
    humorResponse: scoreEvidenceSchema,
    yardToonzFit: scoreEvidenceSchema,
    overall: z.number().int().min(0).max(100),
    scoringVersion: z.string().trim().min(1),
  })
  .readonly();

export const candidateSchema = z
  .object({
    id: z.string().trim().min(1),
    platform: z.enum(sourcePlatforms),
    sourceUrl: z.url().optional(),
    sourceLabel: z.string().trim().min(1),
    caption: z.string().trim().min(1),
    publishedAt: z.iso.datetime().optional(),
    observedAt: z.iso.datetime(),
    metrics: engagementMetricsSchema,
    commentExcerpts: z.array(z.string().trim().min(1)),
    adaptationNote: z.string().trim().min(1).optional(),
    scores: candidateScoresSchema,
    status: z.enum(candidateStatuses),
    decisionReason: z.string().trim().min(1).optional(),
    decidedAt: z.iso.datetime().optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .readonly();

export const listCandidatesResponseSchema = z
  .object({ candidates: z.array(candidateSchema) })
  .readonly();

export const candidateSortFields = [
  "overall",
  "viralMomentum",
  "humorResponse",
  "yardToonzFit",
] as const;
export const candidateSortOrders = ["asc", "desc"] as const;

export const candidateListQuerySchema = z
  .object({
    status: z.enum(candidateStatuses).optional(),
    platform: z.enum(sourcePlatforms).optional(),
    sort: z.enum(candidateSortFields).optional(),
    order: z.enum(candidateSortOrders).optional(),
  })
  .strict()
  .readonly();

export const approveCandidateRequestSchema = z
  .object({ status: z.literal("APPROVED") })
  .strict()
  .readonly();
export const approveCandidateResponseSchema = z
  .object({ candidate: candidateSchema })
  .readonly();

export const rejectCandidateRequestSchema = z
  .object({
    status: z.literal("REJECTED"),
    reason: z.string().trim().min(1).optional(),
  })
  .strict()
  .readonly();
export const restoreCandidateRequestSchema = z
  .object({ status: z.literal("NEW") })
  .strict()
  .readonly();
export const updateCandidateRequestSchema = z
  .discriminatedUnion("status", [
    approveCandidateRequestSchema,
    rejectCandidateRequestSchema,
    restoreCandidateRequestSchema,
  ])
  .readonly();

export const rightsConfirmationRequestSchema = z
  .object({
    confirmed: z.literal(true),
    confirmationTextVersion: z.string().trim().min(1),
  })
  .strict()
  .readonly();
export const rightsConfirmationSchema = z
  .object({
    candidateId: z.string().trim().min(1),
    confirmed: z.literal(true),
    confirmedAt: z.iso.datetime(),
    confirmationTextVersion: z.string().trim().min(1),
  })
  .readonly();
export const confirmRightsResponseSchema = z
  .object({ rightsConfirmation: rightsConfirmationSchema })
  .readonly();

export const apiErrorCodes = [
  "INVALID_REQUEST",
  "CANDIDATE_NOT_FOUND",
  "CANDIDATE_NOT_APPROVED",
  "INVALID_CSV",
  "INVALID_RECORD",
  "DUPLICATE_ID",
  "CANDIDATE_DECISION_CONFLICT",
  "INTERNAL_ERROR",
] as const;
export const apiErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.enum(apiErrorCodes),
      message: z.string().trim().min(1),
    }),
  })
  .readonly();

export type EngagementMetrics = z.infer<typeof engagementMetricsSchema>;
export type FitChecklist = z.infer<typeof fitChecklistSchema>;
export type ScoreEvidence = z.infer<typeof scoreEvidenceSchema>;
export type CandidateScores = z.infer<typeof candidateScoresSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type ApproveCandidateRequest = z.infer<
  typeof approveCandidateRequestSchema
>;
export type RejectCandidateRequest = z.infer<
  typeof rejectCandidateRequestSchema
>;
export type RestoreCandidateRequest = z.infer<
  typeof restoreCandidateRequestSchema
>;
export type UpdateCandidateRequest = z.infer<
  typeof updateCandidateRequestSchema
>;
export type CandidateSortField = (typeof candidateSortFields)[number];
export type CandidateSortOrder = (typeof candidateSortOrders)[number];
export type CandidateListQuery = z.infer<typeof candidateListQuerySchema>;
export type RightsConfirmationRequest = z.infer<
  typeof rightsConfirmationRequestSchema
>;
export type RightsConfirmation = z.infer<typeof rightsConfirmationSchema>;
