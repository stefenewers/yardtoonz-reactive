import { z } from "zod";

import {
  contrastRatio,
  type PaletteColor,
  paletteMeanColor,
  paletteMeanSaturation,
  paletteWeightNear,
  parseHexColor,
  rgbToHsl,
  type RgbColor,
} from "./style-palette";

/**
 * The clay style-token set and the frame conformance checker.
 *
 * The token set encodes the brand and visual style guide as data: the
 * semantic color jobs (§6), the claymation visual qualities (§8), the
 * image-style prompt contract (§11), and the numeric thresholds the
 * conformance checker measures against. Everything is versioned so a
 * conformance result always names the exact rule set that produced it.
 *
 * Provenance matters: the color values are the app's recorded design
 * tokens plus the synthesized brand logo fixture, NOT values sampled
 * from the official logo — the brand guide reserves final values for
 * the owner-delivered reference pack.
 */

export const clayStyleTokenSetVersion = "clay-v1";

export const clayColorTokenSchema = z
  .object({
    key: z.enum(["yellow", "green", "red", "outline", "surface", "text"]),
    hex: z.string().regex(/^#[0-9a-f]{6}$/u),
    /** The semantic job the brand guide assigns to this color. */
    role: z.string().min(1),
    family: z.enum(["accent", "signal", "neutral"]),
  })
  .readonly();
export type ClayColorToken = z.infer<typeof clayColorTokenSchema>;

export const clayQualityTokenSchema = z
  .object({
    key: z.enum([
      "tactile-surfaces",
      "warm-lighting",
      "controlled-color",
      "strong-silhouette",
      "vertical-frame",
    ]),
    label: z.string().min(1),
    /** Prompt-ready directive derived from the brand guide. */
    directive: z.string().min(1),
  })
  .readonly();
export type ClayQualityToken = z.infer<typeof clayQualityTokenSchema>;

export const clayConformanceThresholdsSchema = z
  .object({
    /** Redmean distance within which a palette color counts as a brand hit. */
    brandColorDistance: z.number().positive(),
    brandPaletteSharePass: z.number().min(0).max(1),
    brandPaletteShareWarn: z.number().min(0).max(1),
    outlineContrastPass: z.number().min(1),
    outlineContrastWarn: z.number().min(1),
    warmLightingPass: z.number(),
    warmLightingWarn: z.number(),
    saturationPassMin: z.number().min(0).max(1),
    saturationPassMax: z.number().min(0).max(1),
    saturationWarnMin: z.number().min(0).max(1),
    saturationWarnMax: z.number().min(0).max(1),
    colorDepthPass: z.number().int().min(1),
    colorDepthWarn: z.number().int().min(1),
  })
  .readonly();
export type ClayConformanceThresholds = z.infer<
  typeof clayConformanceThresholdsSchema
>;

export const conformanceFactorWeightsSchema = z
  .object({
    "brand-palette": z.number().positive(),
    "outline-contrast": z.number().positive(),
    "warm-lighting": z.number().positive(),
    "controlled-saturation": z.number().positive(),
    "tactile-color-depth": z.number().positive(),
  })
  .readonly();

export const clayStyleTokenSetSchema = z
  .object({
    version: z.literal(clayStyleTokenSetVersion),
    provenance: z.string().min(1),
    colors: z.array(clayColorTokenSchema).min(6),
    qualities: z.array(clayQualityTokenSchema).min(5),
    thresholds: clayConformanceThresholdsSchema,
    factorWeights: conformanceFactorWeightsSchema,
    promptContract: z
      .object({
        baseStyle: z.string().min(1),
        negativeDirection: z.string().min(1),
        outputRequirement: z.string().min(1),
        motionBase: z.string().min(1),
        motionClose: z.string().min(1),
      })
      .readonly(),
  })
  .readonly();
export type ClayStyleTokenSet = z.infer<typeof clayStyleTokenSetSchema>;

/**
 * The committed token set. Color values mirror the application's semantic
 * design tokens; see `provenance` for how they were recorded and when they
 * must be replaced.
 */
export const clayStyleTokenSet: ClayStyleTokenSet = {
  version: clayStyleTokenSetVersion,
  provenance:
    "Color values recorded from the committed application design tokens (src/app/globals.css) and the synthesized brand logo fixture (public/brand/yard-toonz-logo.png). Replace with values sampled from the official Yard Toonz logo when the owner delivers the reference pack (brand guide §6 and §14).",
  colors: [
    {
      key: "yellow",
      hex: "#ffd83d",
      role: "Primary actions, active stages, selected scores.",
      family: "accent",
    },
    {
      key: "green",
      hex: "#71d48c",
      role: "Confirmed rights, success, completed stages.",
      family: "signal",
    },
    {
      key: "red",
      hex: "#ff746c",
      role: "Rejection, destructive actions, blocking failures.",
      family: "signal",
    },
    {
      key: "outline",
      hex: "#070605",
      role: "Black or deep charcoal graphic outlines.",
      family: "neutral",
    },
    {
      key: "surface",
      hex: "#171512",
      role: "Warm near-black creator workspace.",
      family: "neutral",
    },
    {
      key: "text",
      hex: "#fff9e8",
      role: "Warm off-white primary text.",
      family: "neutral",
    },
  ],
  qualities: [
    {
      key: "tactile-surfaces",
      label: "Tactile surfaces",
      directive:
        "Keep tactile fingerprints, small surface imperfections, and hand-shaped forms visible.",
    },
    {
      key: "warm-lighting",
      label: "Warm lighting",
      directive:
        "Use warm, cinematic lighting with clear subject separation.",
    },
    {
      key: "controlled-color",
      label: "Controlled color",
      directive:
        "Keep color saturated but controlled; never glossy plastic or videogame render.",
    },
    {
      key: "strong-silhouette",
      label: "Strong silhouette",
      directive:
        "Make faces, mouths, and silhouettes read immediately at phone size.",
    },
    {
      key: "vertical-frame",
      label: "Vertical frame",
      directive:
        "Compose for the 9:16 vertical canvas with headroom for captions.",
    },
  ],
  thresholds: {
    brandColorDistance: 110,
    brandPaletteSharePass: 0.18,
    brandPaletteShareWarn: 0.06,
    outlineContrastPass: 7,
    outlineContrastWarn: 4.5,
    warmLightingPass: 8,
    warmLightingWarn: -10,
    saturationPassMin: 0.3,
    saturationPassMax: 0.85,
    saturationWarnMin: 0.2,
    saturationWarnMax: 0.93,
    colorDepthPass: 5,
    colorDepthWarn: 3,
  },
  factorWeights: {
    "brand-palette": 0.3,
    "outline-contrast": 0.25,
    "warm-lighting": 0.15,
    "controlled-saturation": 0.15,
    "tactile-color-depth": 0.15,
  },
  promptContract: {
    baseStyle:
      "Transform the approved reference into a handcrafted stop-motion claymation scene for Yard Toonz, a Jamaican adult comedy brand. Preserve the subject count, pose, complexion, clothing colors, defining accessories, and overall composition. Use tactile clay surfaces, expressive but recognizable facial features, miniature practical sets, warm cinematic lighting, and a strong silhouette that reads in a vertical mobile frame.",
    negativeDirection:
      "Do not create a children's gardening aesthetic. No glossy plastic, photoreal skin, flat vector art, generic tropical decorations, extra characters, duplicated limbs, warped hands, illegible text, watermarks, or unrequested captions.",
    outputRequirement:
      "Compose for 9:16 vertical output. Keep faces and essential action within the central safe area. Return one clean styled frame suitable for image-to-video animation.",
    motionBase:
      "Animate the approved clay frame as one continuous stop-motion shot. Preserve every character and identity detail.",
    motionClose:
      "Do not introduce new objects, characters, dialogue, text, or cuts.",
  },
};

export const conformanceFactorKeys = [
  "brand-palette",
  "outline-contrast",
  "warm-lighting",
  "controlled-saturation",
  "tactile-color-depth",
] as const;
export type ConformanceFactorKey = (typeof conformanceFactorKeys)[number];

export const conformanceStatuses = ["pass", "warn", "fail"] as const;
export type ConformanceStatus = (typeof conformanceStatuses)[number];

export const conformanceVerdicts = [
  "CONFORMANT",
  "PARTIAL",
  "OFF_BRAND",
] as const;
export type ConformanceVerdict = (typeof conformanceVerdicts)[number];

export const conformanceFactorSchema = z
  .object({
    key: z.enum(conformanceFactorKeys),
    label: z.string().min(1),
    status: z.enum(conformanceStatuses),
    expectation: z.string().min(1),
    measured: z.string().min(1),
    /** Numeric backing for `measured`, kept for tests and charts. */
    measuredValue: z.number(),
    explanation: z.string().min(1),
  })
  .readonly();
export type ConformanceFactor = z.infer<typeof conformanceFactorSchema>;

export const frameConformanceSchema = z
  .object({
    version: z.string().min(1),
    score: z.number().min(0).max(100),
    verdict: z.enum(conformanceVerdicts),
    /** Sorted by the fixed factor-key order so UI renders are stable. */
    factors: z.array(conformanceFactorSchema),
  })
  .readonly();
export type FrameConformance = z.infer<typeof frameConformanceSchema>;

/** Brand accent tokens the conformance checker looks for in palettes. */
export const brandAccentKeys = ["yellow", "green", "red"] as const;

function factorScore(status: ConformanceStatus): number {
  return status === "pass" ? 1 : status === "warn" ? 0.5 : 0;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * Check a frame's extracted palette against the clay token set. Five
 * named factors each map to a brand-guide rule; the weighted score
 * becomes the verdict. An empty palette fails every factor — absence of
 * pixel data is never conformance.
 */
export function checkPaletteConformance(
  palette: readonly PaletteColor[],
  tokenSet: ClayStyleTokenSet = clayStyleTokenSet,
): FrameConformance {
  const thresholds = tokenSet.thresholds;

  const accentTargets = tokenSet.colors
    .filter(({ key }) => (brandAccentKeys as readonly string[]).includes(key))
    .flatMap(({ hex }) => {
      const parsed = parseHexColor(hex);
      return parsed ? [parsed] : [];
    });

  const brandShare =
    palette.length === 0
      ? 0
      : paletteWeightNear(
          palette,
          accentTargets,
          thresholds.brandColorDistance,
        );

  const opaqueColors = palette.map((entry) => entry.rgb);
  const contrast =
    opaqueColors.length === 0
      ? 0
      : Math.max(
          ...opaqueColors.map((a) =>
            Math.max(...opaqueColors.map((b) => contrastRatio(a, b))),
          ),
        );

  const meanColor = paletteMeanColor(palette);
  const warmBias = meanColor ? meanColor.r - meanColor.b : 0;
  const saturation = paletteMeanSaturation(palette) ?? 0;

  const depth = palette.length;

  const factors: ConformanceFactor[] = [
    {
      key: "brand-palette",
      label: "Brand palette presence",
      status:
        brandShare >= thresholds.brandPaletteSharePass
          ? "pass"
          : brandShare >= thresholds.brandPaletteShareWarn
            ? "warn"
            : "fail",
      expectation: `At least ${percent(thresholds.brandPaletteSharePass)} of palette weight near a brand accent (yellow, green, red).`,
      measured: `${percent(brandShare)} of palette weight near a brand accent.`,
      measuredValue: brandShare,
      explanation:
        "The guide requires the Jamaican red/yellow/green palette to stay present in generated frames (§6).",
    },
    {
      key: "outline-contrast",
      label: "Outline contrast",
      status:
        contrast >= thresholds.outlineContrastPass
          ? "pass"
          : contrast >= thresholds.outlineContrastWarn
            ? "warn"
            : "fail",
      expectation: `Contrast ratio between the darkest and lightest palette colors is at least ${formatNumber(thresholds.outlineContrastPass)}.`,
      measured: `Maximum palette contrast ratio is ${formatNumber(contrast)}.`,
      measuredValue: contrast,
      explanation:
        "Heavy black outlines on bright fills are part of the logo's visual language (§5); flat frames without them read off-brand.",
    },
    {
      key: "warm-lighting",
      label: "Warm lighting bias",
      status:
        warmBias >= thresholds.warmLightingPass
          ? "pass"
          : warmBias >= thresholds.warmLightingWarn
            ? "warn"
            : "fail",
      expectation: `Weighted mean red-minus-blue bias is at least ${thresholds.warmLightingPass} (warm light) and not below ${thresholds.warmLightingWarn} (cool cast).`,
      measured: `Weighted mean red-minus-blue bias is ${formatNumber(warmBias)}.`,
      measuredValue: warmBias,
      explanation:
        "Frames must carry warm, cinematic lighting with clear subject separation (§8).",
    },
    {
      key: "controlled-saturation",
      label: "Controlled saturation",
      status:
        saturation >= thresholds.saturationPassMin &&
        saturation <= thresholds.saturationPassMax
          ? "pass"
          : saturation >= thresholds.saturationWarnMin &&
              saturation <= thresholds.saturationWarnMax
            ? "warn"
            : "fail",
      expectation: `Weighted mean HSL saturation between ${thresholds.saturationPassMin} and ${thresholds.saturationPassMax} (saturated but controlled).`,
      measured: `Weighted mean HSL saturation is ${formatNumber(saturation)}.`,
      measuredValue: saturation,
      explanation:
        "Color must stay saturated but controlled — neither washed out nor videogame-glossy (§8).",
    },
    {
      key: "tactile-color-depth",
      label: "Tactile color depth",
      status:
        depth >= thresholds.colorDepthPass
          ? "pass"
          : depth >= thresholds.colorDepthWarn
            ? "warn"
            : "fail",
      expectation: `At least ${thresholds.colorDepthPass} distinct palette clusters (tactile clay surfaces), warn below ${thresholds.colorDepthWarn + 1}.`,
      measured: `${depth} distinct palette clusters.`,
      measuredValue: depth,
      explanation:
        "Clay surfaces carry small tonal variation; collapsing to a couple of flat clusters reads as vector art (§8).",
    },
  ].sort(
    (a, b) =>
      conformanceFactorKeys.indexOf(a.key) -
      conformanceFactorKeys.indexOf(b.key),
  );

  const totalWeight = conformanceFactorKeys.reduce(
    (sum, key) => sum + tokenSet.factorWeights[key],
    0,
  );
  const score =
    factors.reduce(
      (sum, factor) =>
        sum + tokenSet.factorWeights[factor.key] * factorScore(factor.status),
      0,
    ) * (100 / totalWeight);

  const verdict: ConformanceVerdict =
    score >= 85 ? "CONFORMANT" : score >= 50 ? "PARTIAL" : "OFF_BRAND";

  return {
    version: tokenSet.version,
    score: Math.round(score * 10) / 10,
    verdict,
    factors,
  };
}

/** The brand accent colors as RGB, for palette matching. */
export function brandAccentColors(
  tokenSet: ClayStyleTokenSet = clayStyleTokenSet,
): { key: ClayColorToken["key"]; rgb: RgbColor }[] {
  return tokenSet.colors
    .filter(({ key }) => (brandAccentKeys as readonly string[]).includes(key))
    .flatMap(({ key, hex }) => {
      const rgb = parseHexColor(hex);
      return rgb ? [{ key, rgb }] : [];
    });
}

/** Re-export so UI layers can format color values alongside tokens. */
export { rgbToHsl };
