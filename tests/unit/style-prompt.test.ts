import { describe, expect, it } from "vitest";

import {
  buildClaymationSections,
  buildMotionSections,
  claymationPromptInputSchema,
  composeMotionPrompt,
  composeStylePrompt,
  enrichPromptsRequestSchema,
  enrichTreatmentPrompts,
  maxTreatmentPromptLength,
  motionPromptInputSchema,
  promptEnrichmentSchema,
  type EnrichPromptsRequest,
} from "../../src/domain/style-prompt";

const treatment = "A goat opens a dutch pot and finds festival food.";
const motion = "Goat grins wide, steam rises off the pot.";

function request(
  overrides: Partial<EnrichPromptsRequest> = {},
): EnrichPromptsRequest {
  return { claymationPrompt: treatment, ...overrides };
}

describe("enrichTreatmentPrompts", () => {
  it("places the treatment between the base style and negative direction", () => {
    const enriched = enrichTreatmentPrompts(request());
    const treatmentAt = enriched.imagePrompt.indexOf(treatment);
    const baseAt = enriched.imagePrompt.indexOf("handcrafted stop-motion");
    const negativeAt = enriched.imagePrompt.indexOf("Do not create");

    expect(treatmentAt).toBeGreaterThan(baseAt);
    expect(negativeAt).toBeGreaterThan(treatmentAt);
  });

  it("is deterministic for identical inputs", () => {
    expect(enrichTreatmentPrompts(request({ motionPrompt: motion }))).toEqual(
      enrichTreatmentPrompts(request({ motionPrompt: motion })),
    );
  });

  it("returns only an image prompt when no motion prompt is given", () => {
    const enriched = enrichTreatmentPrompts(request());

    expect(enriched.imagePrompt).toContain(treatment);
    expect(enriched.motionPrompt).toBeUndefined();
    expect(enriched.sections.motion).toBeUndefined();
  });

  it("includes the motion contract when a motion prompt is supplied", () => {
    const enriched = enrichTreatmentPrompts(request({ motionPrompt: motion }));

    expect(enriched.motionPrompt).toContain(motion);
    expect(enriched.motionPrompt).toContain("stop-motion");
    expect(enriched.sections.motion?.treatment).toBe(motion);
  });

  it("never lets creative direction displace the negative contract", () => {
    const enriched = enrichTreatmentPrompts(
      request({ creativeDirection: "Add more steam." }),
    );

    expect(enriched.sections.sceneDirection).toBe("Add more steam.");
    expect(enriched.imagePrompt).toContain("No glossy plastic");
  });

  it("always satisfies the enrichment response contract", () => {
    const enriched = enrichTreatmentPrompts(
      request({ motionPrompt: motion, creativeDirection: "Add steam." }),
    );

    expect(promptEnrichmentSchema.safeParse(enriched).success).toBe(true);
    expect(enriched.tokenSetVersion).toBe("clay-v1");
  });
});

describe("prompt section builders", () => {
  it("expose the controlled contract text verbatim", () => {
    const sections = buildClaymationSections({
      treatmentPrompt: treatment,
      creativeDirection: "Add steam.",
    });

    expect(sections.treatment).toBe(treatment);
    expect(sections.sceneDirection).toBe("Add steam.");
    expect(sections.negativeDirection).toContain("Do not create");
    expect(composeStylePrompt(sections).split("\n\n")).toHaveLength(5);

    const motionSections = buildMotionSections({
      treatmentMotionPrompt: motion,
    });
    expect(composeMotionPrompt(motionSections)).toContain(motion);
  });

  it("omits empty sections from the composed string", () => {
    const sections = buildClaymationSections({
      treatmentPrompt: treatment,
      creativeDirection: undefined,
    });

    expect(composeStylePrompt(sections).split("\n\n")).toHaveLength(4);
  });
});

describe("input schemas", () => {
  it("accepts treatment-only and full enrichment requests", () => {
    expect(enrichPromptsRequestSchema.safeParse(request()).success).toBe(true);
    expect(
      enrichPromptsRequestSchema.safeParse(
        request({ motionPrompt: motion, creativeDirection: "Add steam." }),
      ).success,
    ).toBe(true);
  });

  it("rejects empty prompts, unknown keys, and oversized input", () => {
    expect(
      enrichPromptsRequestSchema.safeParse({ claymationPrompt: "" }).success,
    ).toBe(false);
    expect(
      enrichPromptsRequestSchema.safeParse({ ...request(), extra: 1 }).success,
    ).toBe(false);
    expect(
      enrichPromptsRequestSchema.safeParse(
        request({ claymationPrompt: "a".repeat(maxTreatmentPromptLength + 1) }),
      ).success,
    ).toBe(false);
  });

  it("validates the narrower per-prompt inputs", () => {
    expect(
      claymationPromptInputSchema.safeParse({
        treatmentPrompt: treatment,
      }).success,
    ).toBe(true);
    expect(
      motionPromptInputSchema.safeParse({ treatmentMotionPrompt: motion })
        .success,
    ).toBe(true);
  });
});
