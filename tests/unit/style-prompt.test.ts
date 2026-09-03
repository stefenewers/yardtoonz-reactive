import { describe, expect, it } from "vitest";

import {
  claymationImagePrompt,
  claymationMotionPrompt,
  enrichPromptsRequestSchema,
  enrichTreatmentPrompts,
  promptEnrichmentSchema,
} from "../../src/domain/style-prompt";

const treatment = "A goat opens a dutch pot and finds festival food.";

describe("enrichTreatmentPrompts", () => {
  it("places the treatment between the base style and negative direction", () => {
    const enriched = enrichTreatmentPrompts(treatment, undefined);
    const treatmentAt = enriched.imagePrompt.indexOf(treatment);
    const baseAt = enriched.imagePrompt.indexOf("Hand-built claymation");
    const negativeAt = enriched.imagePrompt.indexOf("Never");

    expect(treatmentAt).toBeGreaterThan(baseAt);
    expect(negativeAt).toBeGreaterThan(treatmentAt);
  });

  it("is deterministic for identical inputs", () => {
    expect(enrichTreatmentPrompts(treatment, "Goat grins.")).toEqual(
      enrichTreatmentPrompts(treatment, "Goat grins."),
    );
  });

  it("returns only an image prompt when no motion prompt is given", () => {
    const enriched = enrichTreatmentPrompts(treatment, undefined);

    expect(enriched.imagePrompt).toContain(treatment);
    expect(enriched.motionPrompt).toBeUndefined();
  });

  it("includes creative direction and motion composition when supplied", () => {
    const enriched = enrichTreatmentPrompts(treatment, "Goat grins wide.");

    expect(enriched.motionPrompt).toContain(treatment);
    expect(enriched.motionPrompt).toContain("Goat grins wide.");
    expect(enriched.motionPrompt).toContain("stop-motion");
  });

  it("always satisfies the enrichment response contract", () => {
    expect(
      promptEnrichmentSchema.safeParse(enrichTreatmentPrompts(treatment, "x"))
        .success,
    ).toBe(true);
  });
});

describe("prompt atom builders", () => {
  it("keep the controlled contract text verbatim", () => {
    expect(claymationImagePrompt("scene")).toContain("Hand-built claymation");
    expect(claymationImagePrompt("scene")).toContain("18:9");
    expect(claymationMotionPrompt("scene", "action")).toContain("action");
  });
});

describe("enrichPromptsRequestSchema", () => {
  it("accepts a treatment-only request", () => {
    expect(
      enrichPromptsRequestSchema.safeParse({ treatment }).success,
    ).toBe(true);
  });

  it("accepts treatment with creative direction", () => {
    expect(
      enrichPromptsRequestSchema.safeParse({
        treatment,
        creativeDirection: "Add steam",
      }).success,
    ).toBe(true);
  });

  it("rejects empty treatments and unknown keys", () => {
    expect(enrichPromptsRequestSchema.safeParse({ treatment: "" }).success).toBe(
      false,
    );
    expect(
      enrichPromptsRequestSchema.safeParse({ treatment, extra: 1 }).success,
    ).toBe(false);
  });

  it("rejects treatments beyond the 2000 character cap", () => {
    expect(
      enrichPromptsRequestSchema.safeParse({ treatment: "a".repeat(2001) })
        .success,
    ).toBe(false);
  });
});
