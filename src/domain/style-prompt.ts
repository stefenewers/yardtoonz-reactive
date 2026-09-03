import { z } from "zod";

import type { ClayStyleTokenSet } from "./style-tokens";
import { clayStyleTokenSet } from "./style-tokens";

/**
 * Claymation prompt builder — composes provider-ready prompts from the
 * Director treatment's own prompt lines plus the brand's controlled
 * style contract (brand guide §11 and §12).
 *
 * This module deliberately knows nothing about the Director service: the
 * treatment prompt strings arrive as plain inputs, so enrichment can be
 * composed at any API layer without coupling to Director ownership.
 * Composition is pure and deterministic — same inputs, same prompt.
 */

export const maxTreatmentPromptLength = 2000;
export const maxCreativeDirectionLength = 2000;

export const claymationPromptInputSchema = z
  .object({
    /** The Director treatment's `claymationPrompt` line. */
    treatmentPrompt: z.string().trim().min(1).max(maxTreatmentPromptLength),
    /** The producer's approved creative-direction note, if any. */
    creativeDirection: z
      .string()
      .trim()
      .min(1)
      .max(maxCreativeDirectionLength)
      .optional(),
  })
  .strict()
  .readonly();
export type ClaymationPromptInput = z.infer<typeof claymationPromptInputSchema>;

export const motionPromptInputSchema = z
  .object({
    /** The Director treatment's `motionPrompt` line. */
    treatmentMotionPrompt: z
      .string()
      .trim()
      .min(1)
      .max(maxTreatmentPromptLength),
  })
  .strict()
  .readonly();
export type MotionPromptInput = z.infer<typeof motionPromptInputSchema>;

export const enrichPromptsRequestSchema = z
  .object({
    claymationPrompt: z.string().trim().min(1).max(maxTreatmentPromptLength),
    motionPrompt: z
      .string()
      .trim()
      .min(1)
      .max(maxTreatmentPromptLength)
      .optional(),
    creativeDirection: z
      .string()
      .trim()
      .min(1)
      .max(maxCreativeDirectionLength)
      .optional(),
  })
  .strict()
  .readonly();
export type EnrichPromptsRequest = z.infer<typeof enrichPromptsRequestSchema>;

/** Controlled prompt sections in brand-guide §11 order. */
export interface PromptSections {
  baseStyle: string;
  treatment: string;
  sceneDirection?: string | undefined;
  negativeDirection: string;
  outputRequirement: string;
}

export interface MotionSections {
  base: string;
  treatment: string;
  close: string;
}

/**
 * Build the styled-image prompt sections. The treatment concept follows
 * the base style, the producer's creative direction (when supplied)
 * rides as the scene direction, and the negative + output sections are
 * fixed brand contract — the producer's note can never displace them.
 */
export function buildClaymationSections(
  input: ClaymationPromptInput,
  tokenSet: ClayStyleTokenSet = clayStyleTokenSet,
): PromptSections {
  return {
    baseStyle: tokenSet.promptContract.baseStyle,
    treatment: input.treatmentPrompt,
    sceneDirection: input.creativeDirection,
    negativeDirection: tokenSet.promptContract.negativeDirection,
    outputRequirement: tokenSet.promptContract.outputRequirement,
  };
}

/** Join prompt sections into the final paragraph-ordered prompt string. */
export function composeStylePrompt(sections: PromptSections): string {
  return [
    sections.baseStyle,
    sections.treatment,
    sections.sceneDirection,
    sections.negativeDirection,
    sections.outputRequirement,
  ]
    .filter(
      (paragraph) => typeof paragraph === "string" && paragraph.length > 0,
    )
    .join("\n\n");
}

/** Build the motion prompt sections per the §12 animation contract. */
export function buildMotionSections(
  input: MotionPromptInput,
  tokenSet: ClayStyleTokenSet = clayStyleTokenSet,
): MotionSections {
  return {
    base: tokenSet.promptContract.motionBase,
    treatment: input.treatmentMotionPrompt,
    close: tokenSet.promptContract.motionClose,
  };
}

/** Join motion sections into the final Runway `promptText` string. */
export function composeMotionPrompt(sections: MotionSections): string {
  return [sections.base, sections.treatment, sections.close]
    .filter((paragraph) => paragraph.length > 0)
    .join("\n\n");
}

export const promptEnrichmentSchema = z
  .object({
    imagePrompt: z.string().min(1),
    motionPrompt: z.string().min(1).optional(),
    sections: z
      .object({
        baseStyle: z.string().min(1),
        treatment: z.string().min(1),
        sceneDirection: z.string().min(1).optional(),
        negativeDirection: z.string().min(1),
        outputRequirement: z.string().min(1),
        motion: z
          .object({
            base: z.string().min(1),
            treatment: z.string().min(1),
            close: z.string().min(1),
          })
          .optional(),
      })
      .readonly(),
    tokenSetVersion: z.string().min(1),
  })
  .readonly();
export type PromptEnrichment = z.infer<typeof promptEnrichmentSchema>;

/**
 * One-call enrichment for the API layer: styled-image prompt always,
 * motion prompt when the treatment carries one. Every section is
 * reported back so the inspector can show exactly which paragraphs are
 * fixed brand contract and which came from the treatment.
 */
export function enrichTreatmentPrompts(
  request: EnrichPromptsRequest,
  tokenSet: ClayStyleTokenSet = clayStyleTokenSet,
): PromptEnrichment {
  const imageSections = buildClaymationSections(
    {
      treatmentPrompt: request.claymationPrompt,
      creativeDirection: request.creativeDirection,
    },
    tokenSet,
  );

  const motionSections = request.motionPrompt
    ? buildMotionSections(
        { treatmentMotionPrompt: request.motionPrompt },
        tokenSet,
      )
    : undefined;

  return {
    imagePrompt: composeStylePrompt(imageSections),
    motionPrompt: motionSections
      ? composeMotionPrompt(motionSections)
      : undefined,
    sections: {
      baseStyle: imageSections.baseStyle,
      treatment: imageSections.treatment,
      sceneDirection: imageSections.sceneDirection,
      negativeDirection: imageSections.negativeDirection,
      outputRequirement: imageSections.outputRequirement,
      motion: motionSections,
    },
    tokenSetVersion: tokenSet.version,
  };
}
