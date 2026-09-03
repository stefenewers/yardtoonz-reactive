import { describe, expect, it } from "vitest";

import type { PaletteColor } from "../../src/domain/style-palette";
import {
  brandAccentColors,
  checkPaletteConformance,
  clayStyleTokenSet,
  clayStyleTokenSetVersion,
  conformanceFactorKeys,
  conformanceFixtureFrameNameSchema,
  conformanceFixtureFrameNames,
  type ClayStyleTokenSet,
} from "../../src/domain/style-tokens";
import { conformanceQuerySchema } from "../../src/domain/style-api";

function color(
  hex: string,
  rgb: { r: number; g: number; b: number },
): PaletteColor {
  return { hex, rgb, weight: 0.25, pixelCount: 250 };
}

/** Palette drawn from the committed guide: yellow, green, red, warm browns, charcoal. */
const conformantPalette: PaletteColor[] = [
  color("#ffd83d", { r: 255, g: 216, b: 61 }),
  color("#71d48c", { r: 113, g: 212, b: 140 }),
  color("#e0452c", { r: 224, g: 69, b: 44 }),
  color("#7a4a21", { r: 122, g: 74, b: 33 }),
  color("#3c2d1e", { r: 60, g: 45, b: 30 }),
  color("#171512", { r: 23, g: 21, b: 18 }),
];

const offbrandPalette: PaletteColor[] = [
  color("#f2f2f2", { r: 242, g: 242, b: 242 }),
  color("#00d0ff", { r: 0, g: 208, b: 255 }),
  color("#ff00e0", { r: 255, g: 0, b: 224 }),
  color("#0b0b0b", { r: 11, g: 11, b: 11 }),
];

describe("clay style token set", () => {
  it("carries the versioned brand and quality tokens", () => {
    const tokenSet: ClayStyleTokenSet = clayStyleTokenSet;
    expect(tokenSet.version).toBe(clayStyleTokenSetVersion);
    expect(clayStyleTokenSetVersion).toBe("clay-v1");
    expect(tokenSet.colors.map((entry) => entry.hex)).toEqual(
      expect.arrayContaining(["#ffd83d", "#71d48c", "#ff746c", "#fff9e8"]),
    );
    expect(tokenSet.qualities.length).toBeGreaterThanOrEqual(5);
    expect(Object.keys(tokenSet.factorWeights)).toEqual(
      expect.arrayContaining([...conformanceFactorKeys]),
    );
  });

  it("lists the brand accent colors as RGB for palette matching", () => {
    expect(brandAccentColors().map(({ key, rgb }) => [key, rgb])).toEqual([
      ["yellow", { r: 255, g: 216, b: 61 }],
      ["green", { r: 113, g: 212, b: 140 }],
      ["red", { r: 255, g: 116, b: 108 }],
    ]);
  });

  it("names exactly the three conformance fixture frames", () => {
    expect(conformanceFixtureFrameNames).toEqual([
      "conformant",
      "partial",
      "offbrand",
    ]);
    for (const name of conformanceFixtureFrameNames) {
      expect(conformanceFixtureFrameNameSchema.safeParse(name).success).toBe(
        true,
      );
    }
    expect(
      conformanceFixtureFrameNameSchema.safeParse("nonsense").success,
    ).toBe(false);
  });

  it("validates the conformance query contract", () => {
    expect(
      conformanceQuerySchema.safeParse({ frame: "offbrand" }).success,
    ).toBe(true);
    expect(
      conformanceQuerySchema.safeParse({ frame: "nonsense" }).success,
    ).toBe(false);
    expect(conformanceQuerySchema.safeParse({}).success).toBe(false);
  });
});

describe("checkPaletteConformance", () => {
  const statuses = (result: ReturnType<typeof checkPaletteConformance>) =>
    Object.fromEntries(
      result.factors.map((factor) => [factor.key, factor.status]),
    );

  it("rewards the brand palette with a conformant verdict", () => {
    const result = checkPaletteConformance(conformantPalette);

    expect(result.verdict).toBe("CONFORMANT");
    expect(result.version).toBe(clayStyleTokenSetVersion);
    expect(statuses(result)["brand-palette"]).toBe("pass");
    expect(result.factors.map((factor) => factor.key)).toEqual([
      ...conformanceFactorKeys,
    ]);
    expect(result.factors.every((factor) => factor.status === "pass")).toBe(
      true,
    );
  });

  it("is deterministic and stable across repeated calls", () => {
    expect(checkPaletteConformance(conformantPalette)).toEqual(
      checkPaletteConformance(conformantPalette),
    );
  });

  it("fails an empty palette outright", () => {
    const result = checkPaletteConformance([]);

    expect(result.verdict).toBe("OFF_BRAND");
    expect(result.score).toBeLessThan(50);
    expect(statuses(result)["brand-palette"]).toBe("fail");
    expect(statuses(result)["outline-contrast"]).toBe("fail");
    expect(statuses(result)["controlled-saturation"]).toBe("fail");
    expect(statuses(result)["tactile-color-depth"]).toBe("fail");
  });

  it("penalizes an off-brand cool palette", () => {
    const result = checkPaletteConformance(offbrandPalette);

    expect(result.verdict).toBe("OFF_BRAND");
    expect(statuses(result)["brand-palette"]).toBe("fail");
    expect(statuses(result)["warm-lighting"]).not.toBe("pass");
  });

  it("honors a stricter token set for warn states", () => {
    // Same palette, but brand share must reach 0.99 to pass, else warn.
    const strictTokenSet: ClayStyleTokenSet = {
      ...clayStyleTokenSet,
      thresholds: {
        ...clayStyleTokenSet.thresholds,
        brandPaletteSharePass: 0.99,
        brandPaletteShareWarn: 0.5,
      },
    };

    const result = checkPaletteConformance(conformantPalette, strictTokenSet);

    expect(statuses(result)["brand-palette"]).toBe("warn");
    expect(result.score).toBeLessThan(100);
  });

  it("fails outline contrast for washed-out gray palettes", () => {
    const flat = [
      color("#8a8a8a", { r: 138, g: 138, b: 138 }),
      color("#9a9a9a", { r: 154, g: 154, b: 154 }),
    ];

    const result = checkPaletteConformance(flat);

    expect(statuses(result)["outline-contrast"]).toBe("fail");
  });

  it("warns on shallow palettes between the depth thresholds", () => {
    const shallow: PaletteColor[] = [
      color("#ffd83d", { r: 255, g: 216, b: 61 }),
      color("#e0452c", { r: 224, g: 69, b: 44 }),
      color("#7a4a21", { r: 122, g: 74, b: 33 }),
      color("#3c2d1e", { r: 60, g: 45, b: 30 }),
    ];

    const result = checkPaletteConformance(shallow);

    expect(statuses(result)["tactile-color-depth"]).toBe("warn");
    expect(result.score).toBeLessThan(100);
  });
});
