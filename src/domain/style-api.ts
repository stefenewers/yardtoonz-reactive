import { z } from "zod";

import { promptEnrichmentSchema } from "./style-prompt";
import {
  clayStyleTokenSetSchema,
  conformanceFixtureFrameNameSchema,
  frameConformanceSchema,
} from "./style-tokens";

/**
 * Wire contracts for the /api/style surfaces. The service returns
 * domain-shaped data; these schemas pin exactly what crosses the API so
 * the inspector page and tests validate against one source of truth.
 */

export const paletteColorSchema = z
  .object({
    hex: z.string().regex(/^#[0-9a-f]{6}$/u),
    rgb: z.object({
      r: z.number().int().min(0).max(255),
      g: z.number().int().min(0).max(255),
      b: z.number().int().min(0).max(255),
    }),
    weight: z.number().min(0).max(1),
  })
  .readonly();
export type PaletteColorDto = z.infer<typeof paletteColorSchema>;

export const styleGuideResponseSchema = z
  .object({
    tokenSet: clayStyleTokenSetSchema,
    logo: z
      .object({
        path: z.string().min(1),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        palette: z.array(paletteColorSchema),
        conformance: frameConformanceSchema,
      })
      .readonly(),
    brandAccents: z
      .array(
        z
          .object({
            key: z.string().min(1),
            hex: z.string().regex(/^#[0-9a-f]{6}$/u),
          })
          .readonly(),
      )
      .min(3),
  })
  .readonly();
export type StyleGuideResponse = z.infer<typeof styleGuideResponseSchema>;

export const fixtureConformanceResponseSchema = z
  .object({
    name: conformanceFixtureFrameNameSchema,
    label: z.string().min(1),
    description: z.string().min(1),
    path: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    palette: z.array(paletteColorSchema),
    conformance: frameConformanceSchema,
  })
  .readonly();
export type FixtureConformanceResponse = z.infer<
  typeof fixtureConformanceResponseSchema
>;

export const stylePromptResponseSchema = promptEnrichmentSchema;
export type StylePromptResponse = z.infer<typeof stylePromptResponseSchema>;

export { enrichPromptsRequestSchema } from "./style-prompt";

export const conformanceQuerySchema = z
  .object({
    frame: conformanceFixtureFrameNameSchema,
  })
  .strict()
  .readonly();
