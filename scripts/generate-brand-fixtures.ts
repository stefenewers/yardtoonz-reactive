/**
 * Deterministic brand fixture generator.
 *
 * The repository carries no official Yard Toonz logo yet (brand guide §14
 * reserves it for the owner's reference pack), so the style subsystem
 * commits synthesized, reproducible stand-ins: a sticker-style logo
 * fixture in the brand palette, plus three 9:16 fixture frames that
 * demonstrate the conformance verdicts (CONFORMANT, PARTIAL, OFF_BRAND).
 *
 * Run `npm run brand:assets` after changing anything here; the output
 * must be byte-stable for identical inputs.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { encodePng } from "../src/lib/png-image";
import {
  createRgbaImage,
  extractPalette,
  rgbToHex,
  setPixel,
  type RgbaImage,
  type RgbColor,
} from "../src/domain/style-palette";
import { checkPaletteConformance } from "../src/domain/style-tokens";

const brandRoot = path.join(process.cwd(), "public", "brand");
const fixtureRoot = path.join(brandRoot, "fixtures");

const brandColors = {
  yellow: { r: 255, g: 216, b: 61 },
  red: { r: 255, g: 116, b: 108 },
  green: { r: 113, g: 212, b: 140 },
  outline: { r: 7, g: 6, b: 5 },
  text: { r: 255, g: 249, b: 232 },
  surface: { r: 23, g: 21, b: 18 },
} satisfies Record<string, RgbColor>;

function fillRect(
  image: RgbaImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: RgbColor,
): void {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      setPixel(image, x, y, color);
    }
  }
}

function fillDisc(
  image: RgbaImage,
  cx: number,
  cy: number,
  radius: number,
  color: RgbColor,
): void {
  for (let y = Math.floor(cy - radius); y <= cy + radius; y += 1) {
    for (let x = Math.floor(cx - radius); x <= cx + radius; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) setPixel(image, x, y, color);
    }
  }
}

/** Outlined disc = fill + ring, the logo's sticker language. */
function outlinedDisc(
  image: RgbaImage,
  cx: number,
  cy: number,
  radius: number,
  fill: RgbColor,
  outline: RgbColor,
  outlineWidth = 6,
): void {
  fillDisc(image, cx, cy, radius, outline);
  fillDisc(image, cx, cy, radius - outlineWidth, fill);
}

function ring(
  image: RgbaImage,
  cx: number,
  cy: number,
  radius: number,
  color: RgbColor,
): void {
  for (let y = Math.floor(cy - radius); y <= cy + radius; y += 1) {
    for (let x = Math.floor(cx - radius); x <= cx + radius; x += 1) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (Math.abs(d - radius) < 1) setPixel(image, x, y, color);
    }
  }
}

/**
 * The logo fixture: bubbly sticker shapes in the brand palette with heavy
 * outlines and starburst dots. A stand-in for the official wordmark.
 */
function buildLogoFixture(): RgbaImage {
  const image = createRgbaImage(512, 512);
  outlinedDisc(image, 216, 236, 150, brandColors.yellow, brandColors.outline);
  outlinedDisc(image, 396, 120, 66, brandColors.red, brandColors.outline);
  outlinedDisc(image, 392, 384, 78, brandColors.green, brandColors.outline);
  // Wordmark band across the yellow disc.
  fillRect(image, 116, 208, 330, 268, brandColors.text);
  fillRect(image, 116, 208, 122, 268, brandColors.outline);
  fillRect(image, 324, 208, 330, 268, brandColors.outline);
  fillRect(image, 116, 208, 330, 214, brandColors.outline);
  fillRect(image, 116, 262, 330, 268, brandColors.outline);
  // Starburst energy dots.
  for (const [x, y] of [
    [96, 96],
    [416, 264],
    [140, 420],
  ] as const) {
    fillDisc(image, x, y, 18, brandColors.yellow);
    ring(image, x, y, 24, brandColors.outline);
  }
  return image;
}

/**
 * Conformant clay frame: warm brown bands, charcoal outline, terracotta
 * subject, and a bottom strip of brand accents. Every conformance factor
 * should pass.
 */
function buildConformantFrame(): RgbaImage {
  const image = createRgbaImage(90, 160);
  // Banded warm backdrop with tonal variation.
  fillRect(image, 0, 0, 89, 63, { r: 80, g: 50, b: 32 });
  fillRect(image, 0, 64, 89, 109, { r: 150, g: 100, b: 62 });
  fillRect(image, 0, 110, 89, 129, { r: 215, g: 170, b: 125 });
  // Clay subject with charcoal outline; charcoal eyes merge into the
  // outline cluster, keeping the reported palette at eight clusters.
  outlinedDisc(
    image,
    45,
    74,
    30,
    { r: 196, g: 134, b: 84 },
    brandColors.outline,
    4,
  );
  fillDisc(image, 32, 68, 4, brandColors.outline);
  fillDisc(image, 58, 68, 4, brandColors.outline);
  fillDisc(image, 45, 84, 6, brandColors.red);
  // Brand accent strip along the bottom, sized to clear the 18%
  // brand-share pass threshold.
  fillRect(image, 4, 126, 30, 159, brandColors.yellow);
  fillRect(image, 33, 126, 57, 159, brandColors.green);
  fillRect(image, 60, 126, 86, 159, brandColors.red);
  return image;
}

/**
 * Partial frame: warm but washed out — desaturated tans, shallow
 * palette, one muted brand-adjacent accent. Should land PARTIAL
 * (warns across the board, warm lighting still passes).
 */
function buildPartialFrame(): RgbaImage {
  const image = createRgbaImage(90, 160);
  fillRect(image, 0, 0, 89, 79, { r: 216, g: 206, b: 192 });
  fillRect(image, 0, 80, 89, 159, { r: 180, g: 166, b: 148 });
  fillDisc(image, 45, 70, 28, { r: 95, g: 82, b: 68 });
  fillRect(image, 30, 120, 60, 150, { r: 197, g: 122, b: 106 });
  return image;
}

/**
 * Off-brand frame: flat vector look — cool white background, saturated
 * cyan/magenta fills, no dark outline, shallow palette. Should fail the
 * brand-palette, contrast, and warmth factors outright.
 */
function buildOffBrandFrame(): RgbaImage {
  const image = createRgbaImage(90, 160);
  fillRect(image, 0, 0, 89, 159, { r: 245, g: 248, b: 252 });
  fillDisc(image, 40, 64, 30, { r: 0, g: 190, b: 230 });
  fillRect(image, 8, 110, 44, 150, { r: 235, g: 30, b: 170 });
  fillRect(image, 52, 112, 84, 148, { r: 0, g: 200, b: 90 });
  return image;
}

function report(label: string, image: RgbaImage): void {
  const palette = extractPalette(image);
  const conformance = checkPaletteConformance(palette);
  console.log(
    `${label}: ${palette.length} clusters [${palette
      .map((entry) => rgbToHex(entry.rgb))
      .join(", ")}] -> ${conformance.verdict} (${conformance.score})`,
  );
  for (const factor of conformance.factors) {
    console.log(`  ${factor.key}: ${factor.status}`);
  }
}

function main(): void {
  mkdirSync(fixtureRoot, { recursive: true });

  const logo = buildLogoFixture();
  writeFileSync(path.join(brandRoot, "yard-toonz-logo.png"), encodePng(logo));

  const frames: [string, RgbaImage][] = [
    ["clay-frame-conformant.png", buildConformantFrame()],
    ["clay-frame-partial.png", buildPartialFrame()],
    ["clay-frame-offbrand.png", buildOffBrandFrame()],
  ];
  for (const [name, image] of frames) {
    writeFileSync(path.join(fixtureRoot, name), encodePng(image));
  }

  report("logo", logo);
  for (const [name, image] of frames) {
    report(name, image);
  }
}

main();
