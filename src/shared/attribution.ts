import { z } from "zod";

import { sourcePlatforms } from "./candidates";

/**
 * The persisted source attribution and caption context for one production:
 * where the trend came from, what the editorial desk observed, the
 * Director's generated social caption, and the rights record. The pasted
 * source URL is a reference only — nothing is ever fetched from the
 * platform.
 */
export const sourceAttributionSchema = z
  .object({
    candidateId: z.string().trim().min(1),
    platform: z.enum(sourcePlatforms),
    sourceUrl: z.string().nullable(),
    sourceLabel: z.string().trim().min(1),
    caption: z.string().trim().min(1),
    observedAt: z.string(),
    socialCaption: z.string().nullable(),
    rightsConfirmation: z
      .object({
        confirmedAt: z.string(),
        confirmationTextVersion: z.string().trim().min(1),
      })
      .nullable(),
  })
  .readonly();

export const productionAttributionResponseSchema = z
  .object({ attribution: sourceAttributionSchema })
  .readonly();

export type SourceAttribution = z.infer<typeof sourceAttributionSchema>;
export type ProductionAttributionResponse = z.infer<
  typeof productionAttributionResponseSchema
>;
