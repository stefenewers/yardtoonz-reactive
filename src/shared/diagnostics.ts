import { z } from "zod";

import { artifactKinds, productionStatuses } from "../domain/production";
import {
  animationProviders,
  artifactProviders,
  directorProviders,
  imageProviders,
} from "../lib/providers";
import { productionStageNames, productionStageStatuses } from "./productions";

/**
 * Public contract for the provider diagnostics snapshot (`GET /api/diagnostics`).
 * The surface is read-only: it aggregates the PERSISTED production records and
 * the VALIDATED server environment into bounded, safe-to-render views.
 *
 * Secret hygiene is structural: credential settings appear only as PRESENCE
 * booleans — no schema field can carry a secret value, so a rendering mistake
 * cannot leak one.
 */

/** Credential settings whose presence (never value) the diagnostics report. */
export const diagnosticsCredentialSettings = [
  "OPENAI_API_KEY",
  "OPENAI_IMAGE_MODEL",
  "OPENAI_DIRECTOR_MODEL",
  "RUNWAY_API_KEY",
  "RUNWAY_MODEL",
] as const;
export type DiagnosticsCredentialSetting =
  (typeof diagnosticsCredentialSettings)[number];

export const diagnosticsEnvironmentSchema = z
  .object({
    imageProvider: z.enum(imageProviders),
    animationProvider: z.enum(animationProviders),
    directorProvider: z.enum(directorProviders),
    /** Per-setting credential presence. Values never cross this boundary. */
    credentials: z.record(z.enum(diagnosticsCredentialSettings), z.boolean()),
  })
  .readonly();
export type DiagnosticsEnvironment = z.infer<
  typeof diagnosticsEnvironmentSchema
>;

export const diagnosticsArtifactSchema = z
  .object({
    id: z.string().trim().min(1),
    kind: z.enum(artifactKinds),
    provider: z.enum(artifactProviders),
    /** Provider request lineage when a live provider produced this artifact. */
    providerRequestId: z.string().trim().min(1).optional(),
    createdAt: z.iso.datetime(),
  })
  .readonly();
export type DiagnosticsArtifact = z.infer<typeof diagnosticsArtifactSchema>;

export const diagnosticsStageSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.enum(productionStageNames),
    status: z.enum(productionStageStatuses),
    attempt: z.number().int().positive(),
    startedAt: z.iso.datetime().optional(),
    completedAt: z.iso.datetime().optional(),
    providerRequestId: z.string().trim().min(1).optional(),
  })
  .readonly();
export type DiagnosticsStage = z.infer<typeof diagnosticsStageSchema>;

export const diagnosticsJobSchema = z
  .object({
    id: z.string().trim().min(1),
    candidateId: z.string().trim().min(1),
    status: z.enum(productionStatuses),
    imageProvider: z.enum(imageProviders),
    animationProvider: z.enum(animationProviders),
    attempt: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    stages: z.array(diagnosticsStageSchema),
    artifacts: z.array(diagnosticsArtifactSchema),
  })
  .readonly();
export type DiagnosticsJob = z.infer<typeof diagnosticsJobSchema>;

export const diagnosticsResponseSchema = z
  .object({
    environment: diagnosticsEnvironmentSchema,
    /** All persisted jobs, newest first. */
    jobs: z.array(diagnosticsJobSchema),
  })
  .readonly();
export type DiagnosticsResponse = z.infer<typeof diagnosticsResponseSchema>;
