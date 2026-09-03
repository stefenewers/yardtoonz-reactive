import { readFile } from "node:fs/promises";
import path from "node:path";

import { decodePng } from "@/lib/png-image";
import { extractPalette, type PaletteColor } from "@/domain/style-palette";
import type { EnrichPromptsRequest } from "@/domain/style-prompt";
import { enrichTreatmentPrompts } from "@/domain/style-prompt";
import {
  brandAccentColors,
  checkPaletteConformance,
  clayStyleTokenSet,
  type ClayStyleTokenSet,
  type FrameConformance,
} from "@/domain/style-tokens";

/**
 * Clay style service — reads the committed brand assets, extracts their
 * palettes, and serves the guide/conformance/prompt surfaces. Pure pixel
 * functions plus `node:fs`; no database, no provider calls, and no
 * Director ownership (prompt enrichment composes at this layer from
 * plain treatment strings).
 */

export const brandAssetRoot = path.join(process.cwd(), "public", "brand");

export const conformanceFixtureNames = [
  "conformant",
  "partial",
  "offbrand",
] as const;
export type ConformanceFixtureName = (typeof conformanceFixtureNames)[number];

export const frameFixtureMetadata = [
  {
    name: "conformant" as const,
    label: "Conformant clay frame",
    description:
      "Warm brown clay bands, charcoal outline, terracotta subject, and a bottom strip of brand accents — every factor should pass.",
    path: "fixtures/clay-frame-conformant.png",
  },
  {
    name: "partial" as const,
    label: "Partial frame",
    description:
      "Warm but washed out: desaturated tans, shallow palette, one muted brand-adjacent accent — warns across the board.",
    path: "fixtures/clay-frame-partial.png",
  },
  {
    name: "offbrand" as const,
    label: "Off-brand frame",
    description:
      "Flat vector look: cool white background, saturated cyan and magenta fills, no dark outline — hard brand failures.",
    path: "fixtures/clay-frame-offbrand.png",
  },
] as const;

export type FrameFixture = (typeof frameFixtureMetadata)[number];

export const styleGuideErrorCode = {
  assetUnavailable: "STYLE_ASSET_UNAVAILABLE",
  unknownFixture: "STYLE_FIXTURE_NOT_FOUND",
} as const;

export type StyleGuideErrorCode =
  (typeof styleGuideErrorCode)[keyof typeof styleGuideErrorCode];

export type StyleServiceOutcome<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: StyleGuideErrorCode;
      message: string;
      cause?: unknown;
    };

export interface StyleGuideReport {
  tokenSet: ClayStyleTokenSet;
  logo: {
    path: string;
    width: number;
    height: number;
    palette: PaletteColor[];
    conformance: FrameConformance;
  };
  brandAccents: { key: string; hex: string }[];
}

export interface FixtureConformanceReport {
  name: ConformanceFixtureName;
  label: string;
  description: string;
  path: string;
  width: number;
  height: number;
  palette: PaletteColor[];
  conformance: FrameConformance;
}

function resolveAssetPath(relativePath: string): string {
  if (relativePath.includes("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid style asset path: ${relativePath}`);
  }
  return path.join(brandAssetRoot, relativePath);
}

async function readImage(relativePath: string): Promise<{
  width: number;
  height: number;
  palette: PaletteColor[];
}> {
  const bytes = await readFile(resolveAssetPath(relativePath));
  const image = decodePng(bytes);
  return {
    width: image.width,
    height: image.height,
    palette: extractPalette(image),
  };
}

/**
 * The full style guide: versioned tokens, the committed logo's extracted
 * palette and conformance, and the brand accent hexes the checker
 * matches against. Asset reads can fail when the generated fixtures are
 * missing, so outcomes are explicit instead of thrown.
 */
export async function getStyleGuide(): Promise<
  StyleServiceOutcome<StyleGuideReport>
> {
  try {
    const logo = await readImage("yard-toonz-logo.png");
    return {
      ok: true,
      value: {
        tokenSet: clayStyleTokenSet,
        logo: {
          path: "brand/yard-toonz-logo.png",
          ...logo,
          conformance: checkPaletteConformance(logo.palette),
        },
        brandAccents: brandAccentColors().map(({ key, rgb }) => ({
          key,
          hex: `#${[rgb.r, rgb.g, rgb.b]
            .map((channel) => channel.toString(16).padStart(2, "0"))
            .join("")}`,
        })),
      },
    };
  } catch (error) {
    return {
      ok: false,
      code: styleGuideErrorCode.assetUnavailable,
      message:
        "The committed brand assets could not be read. Run `npm run brand:assets` to regenerate them.",
      cause: error,
    };
  }
}

/**
 * Palette + conformance for one named fixture frame. Unknown names are
 * a normal (client-fixable) outcome, not an exception.
 */
export async function checkFixtureFrame(
  name: string,
): Promise<StyleServiceOutcome<FixtureConformanceReport>> {
  const fixture = frameFixtureMetadata.find((entry) => entry.name === name);
  if (!fixture) {
    return {
      ok: false,
      code: styleGuideErrorCode.unknownFixture,
      message: `Unknown fixture frame "${name}". Known frames: ${frameFixtureMetadata
        .map((entry) => entry.name)
        .join(", ")}.`,
    };
  }

  try {
    const image = await readImage(fixture.path);
    return {
      ok: true,
      value: {
        name: fixture.name,
        label: fixture.label,
        description: fixture.description,
        path: `brand/${fixture.path}`,
        ...image,
        conformance: checkPaletteConformance(image.palette),
      },
    };
  } catch (error) {
    return {
      ok: false,
      code: styleGuideErrorCode.assetUnavailable,
      message: `The fixture frame "${name}" could not be read. Run \`npm run brand:assets\` to regenerate it.`,
      cause: error,
    };
  }
}

/**
 * Prompt enrichment: composition is a pure domain call, so this is a
 * thin async wrapper kept for symmetry with the other service outcomes.
 */
export async function enrichPrompts(
  request: EnrichPromptsRequest,
): Promise<StyleServiceOutcome<ReturnType<typeof enrichTreatmentPrompts>>> {
  return {
    ok: true,
    value: enrichTreatmentPrompts(request),
  };
}

export function getClayStyleService() {
  return {
    getStyleGuide,
    checkFixtureFrame,
    enrichPrompts,
  };
}
