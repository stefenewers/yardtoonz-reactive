import { z } from "zod";

import {
  artifactKinds,
  productionStatuses,
  segmentSelectionSchema,
} from "../domain/production";
import {
  animationProviders,
  artifactProviders,
  imageProviders,
} from "../lib/providers";

export const productionStageNames = [
  "INGEST_SOURCE",
  "EXTRACT_MEDIA",
  "SELECT_KEYFRAME",
  "STYLE_IMAGE",
  "ANIMATE_IMAGE",
  "MUX_AND_NORMALIZE",
  "VALIDATE_OUTPUT",
] as const;
export type ProductionStageName = (typeof productionStageNames)[number];

export const productionStageStatuses = [
  "WAITING",
  "RUNNING",
  "COMPLETE",
  "FAILED",
] as const;
export type ProductionStageStatus = (typeof productionStageStatuses)[number];

export const productionApiErrorCodes = [
  "INVALID_REQUEST",
  "PRODUCTION_NOT_FOUND",
  "CANDIDATE_NOT_FOUND",
  "CANDIDATE_NOT_APPROVED",
  "RIGHTS_REQUIRED",
  "APPROVED_CANDIDATE_REQUIRED",
  "ILLEGAL_TRANSITION",
  "INVALID_SEGMENT",
  "SOURCE_REQUIRED",
  "SOURCE_TOO_SHORT",
  "SOURCE_AUDIO_REQUIRED",
  "UNSUPPORTED_MEDIA_TYPE",
  "UPLOAD_TOO_LARGE",
  "INVALID_MEDIA_CONTENT",
  "PRODUCTION_ALREADY_ACTIVE",
  "INTERNAL_ERROR",
] as const;
export type ProductionApiErrorCode = (typeof productionApiErrorCodes)[number];

export const productionErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.enum(productionApiErrorCodes),
      message: z.string().trim().min(1),
    }),
  })
  .readonly();

export const createProductionRequestSchema = z
  .object({
    candidateId: z.string().trim().min(1),
    segment: segmentSelectionSchema,
    imageProvider: z.enum(imageProviders).optional(),
    animationProvider: z.enum(animationProviders).optional(),
  })
  .strict()
  .readonly();
export type CreateProductionRequest = z.infer<
  typeof createProductionRequestSchema
>;

export const updateProductionRequestSchema = z
  .object({
    segment: segmentSelectionSchema.optional(),
    creativeDirection: z.string().trim().min(1).max(2000).optional(),
    rights: z
      .object({
        confirmed: z.literal(true),
        confirmationTextVersion: z.string().trim().min(1),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (request) =>
      request.segment !== undefined ||
      request.creativeDirection !== undefined ||
      request.rights !== undefined,
    { message: "Provide segment, creativeDirection, or rights." },
  )
  .readonly();
export type UpdateProductionRequest = z.infer<
  typeof updateProductionRequestSchema
>;

export const productionViewSchema = z
  .object({
    id: z.string().trim().min(1),
    candidateId: z.string().trim().min(1),
    status: z.enum(productionStatuses),
    imageProvider: z.enum(imageProviders),
    animationProvider: z.enum(animationProviders),
    segment: segmentSelectionSchema,
    creativeDirection: z.string().trim().min(1).optional(),
    activeStage: z.enum(productionStageNames).optional(),
    attempt: z.number().int().positive(),
    errorCode: z.string().trim().min(1).optional(),
    safeErrorMessage: z.string().trim().min(1).optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().optional(),
  })
  .readonly();
export type ProductionView = z.infer<typeof productionViewSchema>;

export const productionStageViewSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.enum(productionStageNames),
    status: z.enum(productionStageStatuses),
    attempt: z.number().int().positive(),
    startedAt: z.iso.datetime().optional(),
    completedAt: z.iso.datetime().optional(),
    errorCode: z.string().trim().min(1).optional(),
    safeErrorMessage: z.string().trim().min(1).optional(),
    workerLeaseOwner: z.string().trim().min(1).optional(),
  })
  .readonly();
export type ProductionStageView = z.infer<typeof productionStageViewSchema>;

export const productionArtifactViewSchema = z
  .object({
    id: z.string().trim().min(1),
    kind: z.enum(artifactKinds),
    provider: z.enum(artifactProviders),
    mimeType: z.string().trim().min(1),
    byteSize: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/, "SHA-256 digests are 64 hex"),
    metadata: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    ),
    createdAt: z.iso.datetime(),
  })
  .readonly();
export type ProductionArtifactView = z.infer<
  typeof productionArtifactViewSchema
>;

export const productionOutputDecisions = ["APPROVED", "REJECTED"] as const;
export const productionOutputDecisionSchema = z
  .object({
    decision: z.enum(productionOutputDecisions),
    reason: z.string().trim().min(1).optional(),
    decidedAt: z.iso.datetime(),
  })
  .readonly();
export type ProductionOutputDecision = z.infer<
  typeof productionOutputDecisionSchema
>;

export const recordOutputDecisionRequestSchema = z
  .object({
    decision: z.enum(productionOutputDecisions),
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .refine(
    (request) =>
      request.decision === "REJECTED" || request.reason === undefined,
    { message: "Approval records no rejection note." },
  )
  .readonly();
export type RecordOutputDecisionRequest = z.infer<
  typeof recordOutputDecisionRequestSchema
>;

export const productionDetailResponseSchema = z
  .object({
    production: productionViewSchema,
    stages: z.array(productionStageViewSchema),
    artifacts: z.array(productionArtifactViewSchema),
    outputDecision: productionOutputDecisionSchema.optional(),
  })
  .readonly();
export type ProductionDetailResponse = z.infer<
  typeof productionDetailResponseSchema
>;

export const listProductionsResponseSchema = z
  .object({
    productions: z.array(productionDetailResponseSchema),
  })
  .readonly();
export type ListProductionsResponse = z.infer<
  typeof listProductionsResponseSchema
>;
