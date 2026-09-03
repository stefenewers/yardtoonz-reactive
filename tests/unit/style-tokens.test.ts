import { describe, expect, it } from "vitest";

import {
  brandAccentColors,
  clayStyleTokenSet,
  checkPaletteConformance,
  conformanceFactorKeys,
  conformanceQuerySchema,
  conformanceFixtureFrameNameSchema,
  fixtureImageDirectory,
  fixtureImageName,
  type ClayStyleTokenSet,
  type PaletteColor,
} from "../../src/domain/style-tokens";

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
    expect(tokenSet.version).toBe("clay-style-v1");
    expect(tokenSet.colors.map((entry) => entry.hex)).toEqual(
      expect.arrayContaining(["#ffd83d", "#71d48c", "#e0452c", "#fff9e8"]),
    );
    expect(tokenSet.qualities.length).toBeGreaterThan(2);
  });

  it("lists the three brand accent colors", () => {
    expect(brandAccentColors).toEqual([
      { r: 224, g: 69, b: 44 },
      { r: 255, g: 216, b: 61 },
      { r: 113, g: 212, b: 140 },
    ]);
  });

  it("exposes fixture paths for every frame name", () => {
    expect(fixtureImageDirectory).toBe("brand/fixtures");
    expect(fixtureImageName("conformant")).toBe(
      "brand/fixtures/conformant-frame.png",
    );
    expect(fixtureImageName("offbrand")).toBe(
      "brand/fixtures/offbrand-frame.png",
    );
  });

  it("validates fixture names and conformance queries", () => {
    expect(conformanceFixtureFrameNameSchema.safeParse("partial").success).toBe(
      true,
    );
    expect(
      conformanceFixtureFrameNameSchema.safeParse("nonsense").success,
    ).toBe(false);
    expect(
      conformanceQuerySchema.safeParse({ frame: "offbrand" }).success,
    ).toBe(true);
  });
});

describe("checkPaletteConformance", () => {
  it("rewards the brand palette with a conformant verdict", () => {
    const result = checkPaletteConformance(conformantPalette);

    expect(result.verdict).toBe("CONFORMANT");
    expect(result.version).toBe("clay-style-v1");
    const statuses = Object.fromEntries(
      result.factors.map((factor) => [factor.key, factor.status]),
    );
    expect(statuses["brand-palette"]).toBe("pass");
    expect(result.factors.map((factor) => factor.key)).toEqual(
      conformanceFactorKeys,
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
    expect(result.score).toBe(0);
    expect(result.factors.every((factor) => factor.status === "fail")).toBe(
      true,
    );
  });

  it("penalizes an off-brand cool palette", () => {
    const result = checkPaletteConformance(offbrandPalette);

    expect(result.verdict).toBe("OFF_BRAND");
    expect(result.factors.find((f) => f.key === "brand-palette")?.status).toBe(
      "fail",
    );
    expect(result.factors.find((f) => f.key === "warmth")?.status).not.toBe(
      "pass",
    );
  });

  it("respects custom thresholds for warn states", () => {
    // Same palette, but brand share must reach 0.99 to pass, else warn.
    const result = checkPaletteConformance(conformantPalette, {
      brandPaletteSharePass: 0.99,
      brandPaletteShareWarn: 0.5,
    });

    expect(result.factors.find((f) => f.key === "brand-palette")?.status).toBe(
      "warn",
    );
  });

  it("fails outline contrast for washed-out gray palettes", () => {
    const flat = [
      color("#8a8a8a", { r: 138, g: 138, b: 138 }),
      color("#9a9a9a", { r: 154, g: 154, b: 154 }),
    ];

    const result = checkPaletteConformance(flat);

    expect(
      result.factors.find((factor) => factor.key === "outline-contrast")
        ?.status,
    ).toBe("fail");
  });
});
