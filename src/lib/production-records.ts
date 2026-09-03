import { z } from "zod";

import { artifactKinds } from "../domain/production";

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
    kind: z.enum(artifactKinds).optional(),
    storageKey: z.string().trim().min(1).optional(),
    mimeType: z.string().trim().min(1).optional(),
    byteSize: z.number().int().nonnegative().optional(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/, "SHA-256 digests are 64 hex characters")
      .optional(),
    parentArtifactIds: z.array(z.string().trim().min(1)).default([]),
    provider: z.enum(artifactProviders),
    providerRequestId: z.string().trim().min(1).optional(),
    metadata: z
      .record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.null()]),
      )
      .default({}),
    createdAt: z.string().datetime({ offset: true }).optional(),
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
