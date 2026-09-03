import { z } from "zod";

import {
  engagementMetricsSchema,
  fitChecklistSchema,
  sourcePlatforms,
} from "./candidates";

export const candidateIntakeProviderKinds = [
  "SEEDED",
  "CSV",
  "MANUAL",
] as const;
export const candidateIntakeProviderKindSchema = z.enum(
  candidateIntakeProviderKinds,
);

/**
 * A candidate record produced by an intake provider. The id is optional:
 * callers without a natural identifier get one generated at import time.
 */
export const candidateIntakeRecordSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    platform: z.enum(sourcePlatforms),
    sourceUrl: z.url().optional(),
    sourceLabel: z.string().trim().min(1),
    caption: z.string().trim().min(1),
    publishedAt: z.iso.datetime().optional(),
    observedAt: z.iso.datetime(),
    metrics: engagementMetricsSchema,
    commentExcerpts: z.array(z.string().trim().min(1)),
    adaptationNote: z.string().trim().min(1).optional(),
    fitChecklist: fitChecklistSchema,
  })
  .strict()
  .readonly();

export const candidateIntakeResultSchema = z
  .object({
    providerKind: candidateIntakeProviderKindSchema,
    imported: z.number().int().nonnegative(),
    candidateIds: z.array(z.string().trim().min(1)),
  })
  .readonly();

export type CandidateIntakeProviderKind = z.infer<
  typeof candidateIntakeProviderKindSchema
>;
export type CandidateIntakeRecord = z.infer<typeof candidateIntakeRecordSchema>;
export type CandidateIntakeResult = z.infer<typeof candidateIntakeResultSchema>;
