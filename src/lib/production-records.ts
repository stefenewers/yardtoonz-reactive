import { z } from "zod";

import {
  animationProviders,
  artifactProviders,
  imageProviders,
} from "./providers";

const productionJobRecordSchema = z
  .object({
    id: z.string().trim().min(1),
    imageProvider: z.enum(imageProviders),
    animationProvider: z.enum(animationProviders),
  })
  .readonly();

const artifactRecordSchema = z
  .object({
    id: z.string().trim().min(1),
    jobId: z.string().trim().min(1),
    provider: z.enum(artifactProviders),
    providerRequestId: z.string().trim().min(1).optional(),
  })
  .readonly();

export type ProductionJobRecord = z.infer<typeof productionJobRecordSchema>;
export type ArtifactRecord = z.infer<typeof artifactRecordSchema>;

export function createProductionJobRecord(input: unknown): ProductionJobRecord {
  return productionJobRecordSchema.parse(input);
}

export function createArtifactRecord(input: unknown): ArtifactRecord {
  return artifactRecordSchema.parse(input);
}
