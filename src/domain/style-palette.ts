/**
 * Pure pixel-color functions behind the clay style subsystem.
 *
 * Everything here operates on already-decoded RGBA pixel buffers
 * (`RgbaImage`) — no file system, no image format, no server state. The
 * brand palette is extracted by quantizing pixel colors into a small
 * perceptually separated set of dominant clusters, so downstream
 * conformance checks and palette swatches are stable and testable.
 */

import type { RgbaImage } from "@/lib/png-image";

export type { RgbaImage };

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface PaletteColor {
  hex: string;
  rgb: RgbColor;
  /** Share of sampled (non-transparent) pixels, 0–1. */
  weight: number;
  /** Exact pixel count behind this cluster. */
  pixelCount: number;
}

export interface PaletteExtractionOptions {
  /** Maximum number of distinct clusters to report. */
  maxColors: number;
  /** Pixels with alpha below this are treated as transparent background. */
  minAlpha: number;
  /**
   * Minimum perceptual distance (redmean, 0–~765 scale) between two
   * reported clusters; nearer buckets merge into the heavier one.
   */
  mergeDistance: number;
}

export const defaultPaletteExtractionOptions: PaletteExtractionOptions = {
  maxColors: 8,
  minAlpha: 16,
  mergeDistance: 90,
};

export function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

/** Lowercase `#rrggbb`. Channels clamp into 0–255. */
export function rgbToHex({ r, g, b }: RgbColor): string {
  const channel = (value: number) =>
    clampChannel(value).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Parses `#rgb` or `#rrggbb`; anything else is not a color. */
export function parseHexColor(value: string): RgbColor | undefined {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/u.exec(
    value.trim().toLowerCase(),
  );
  if (!match) return undefined;
  const digits = match[1]!;
  if (digits.length === 3) {
    return {
      r: Number.parseInt(digits[0]! + digits[0]!, 16),
      g: Number.parseInt(digits[1]! + digits[1]!, 16),
      b: Number.parseInt(digits[2]! + digits[2]!, 16),
    };
  }
  return {
    r: Number.parseInt(digits.slice(0, 2), 16),
    g: Number.parseInt(digits.slice(2, 4), 16),
    b: Number.parseInt(digits.slice(4, 6), 16),
  };
}

function srgbChannelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an sRGB color. */
export function relativeLuminance({ r, g, b }: RgbColor): number {
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

/** WCAG contrast ratio (1–21). Order-independent. */
export function contrastRatio(a: RgbColor, b: RgbColor): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export interface HslColor {
  /** Degrees 0–360. */
  h: number;
  /** 0–1. */
  s: number;
  /** 0–1. */
  l: number;
}

export function rgbToHsl({ r, g, b }: RgbColor): HslColor {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };

  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;
  if (max === rn) {
    h = ((gn - bn) / delta) % 6;
  } else if (max === gn) {
    h = (bn - rn) / delta + 2;
  } else {
    h = (rn - gn) / delta + 4;
  }
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

/**
 * Cheap perceptual distance (the "redmean" approximation). The maximum
 * is roughly 765, and blue differences count less than red ones — close
 * enough for palette merging and brand-color matching.
 */
export function colorDistance(a: RgbColor, b: RgbColor): number {
  const rMean = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(
    (2 + rMean / 256) * dr * dr +
      4 * dg * dg +
      (2 + (255 - rMean) / 256) * db * db,
  );
}

interface ColorAccumulator {
  count: number;
  r: number;
  g: number;
  b: number;
}

/**
 * Extract the dominant palette from an RGBA image. Transparent pixels are
 * excluded first, then colors are bucketed to 5 bits per channel, averaged
 * per bucket, and greedily merged by perceptual distance so the reported
 * clusters stay visually distinct. Clusters sort by pixel weight.
 */
export function extractPalette(
  image: RgbaImage,
  options: PaletteExtractionOptions = defaultPaletteExtractionOptions,
): PaletteColor[] {
  const buckets = new Map<number, ColorAccumulator>();
  let sampled = 0;

  for (let i = 0; i < image.width * image.height; i += 1) {
    const alpha = image.pixels[i * 4 + 3]!;
    if (alpha < options.minAlpha) continue;
    const key =
      ((image.pixels[i * 4]! >> 3) << 10) |
      ((image.pixels[i * 4 + 1]! >> 3) << 5) |
      (image.pixels[i * 4 + 2]! >> 3);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.r += image.pixels[i * 4]!;
      bucket.g += image.pixels[i * 4 + 1]!;
      bucket.b += image.pixels[i * 4 + 2]!;
    } else {
      buckets.set(key, {
        count: 1,
        r: image.pixels[i * 4]!,
        g: image.pixels[i * 4 + 1]!,
        b: image.pixels[i * 4 + 2]!,
      });
    }
    sampled += 1;
  }

  if (sampled === 0) return [];

  const ranked = [...buckets.values()]
    .map((bucket) => ({
      rgb: {
        r: Math.round(bucket.r / bucket.count),
        g: Math.round(bucket.g / bucket.count),
        b: Math.round(bucket.b / bucket.count),
      },
      pixelCount: bucket.count,
    }))
    .sort(
      (a, b) =>
        b.pixelCount - a.pixelCount ||
        a.rgb.r - b.rgb.r ||
        a.rgb.g - b.rgb.g ||
        a.rgb.b - b.rgb.b,
    );

  const clusters: { rgb: RgbColor; pixelCount: number }[] = [];
  for (const candidate of ranked) {
    if (clusters.length >= options.maxColors) break;
    const absorbing = clusters.find(
      (cluster) =>
        colorDistance(cluster.rgb, candidate.rgb) < options.mergeDistance,
    );
    if (absorbing) {
      // Fold merged buckets into the absorbing cluster so palette weights
      // conserve the full sampled pixel count instead of losing pixels.
      absorbing.pixelCount += candidate.pixelCount;
      continue;
    }
    clusters.push(candidate);
  }

  return clusters.map((cluster) => ({
    rgb: cluster.rgb,
    hex: rgbToHex(cluster.rgb),
    pixelCount: cluster.pixelCount,
    weight: cluster.pixelCount / sampled,
  }));
}

/** Empty palettes report `undefined` — absence is not black. */
export function nearestPaletteColor(
  palette: readonly PaletteColor[],
  target: RgbColor,
): { color: PaletteColor; distance: number } | undefined {
  let best: { color: PaletteColor; distance: number } | undefined;
  for (const color of palette) {
    const distance = colorDistance(color.rgb, target);
    if (!best || distance < best.distance) best = { color, distance };
  }
  return best;
}

/** Total palette weight within `maxDistance` of any target color. */
export function paletteWeightNear(
  palette: readonly PaletteColor[],
  targets: readonly RgbColor[],
  maxDistance: number,
): number {
  return palette
    .filter((entry) =>
      targets.some((target) => colorDistance(entry.rgb, target) <= maxDistance),
    )
    .reduce((sum, entry) => sum + entry.weight, 0);
}

/** Weight-mean color of a palette (transparent pixels already excluded). */
export function paletteMeanColor(
  palette: readonly PaletteColor[],
): RgbColor | undefined {
  if (palette.length === 0) return undefined;
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (const entry of palette) {
    r += entry.rgb.r * entry.weight;
    g += entry.rgb.g * entry.weight;
    b += entry.rgb.b * entry.weight;
    total += entry.weight;
  }
  if (total === 0) return undefined;
  return {
    r: clampChannel(r / total),
    g: clampChannel(g / total),
    b: clampChannel(b / total),
  };
}

/** Weight-mean HSL saturation of a palette. */
export function paletteMeanSaturation(
  palette: readonly PaletteColor[],
): number | undefined {
  if (palette.length === 0) return undefined;
  let total = 0;
  for (const entry of palette) {
    total += entry.weight * rgbToHsl(entry.rgb).s;
  }
  return total;
}

/** Build a synthetic RGBA image (tests and the fixture generator use it). */
export function createRgbaImage(
  width: number,
  height: number,
  fill?: RgbColor | undefined,
): RgbaImage {
  const pixels = new Uint8Array(width * height * 4);
  if (fill) {
    for (let i = 0; i < width * height; i += 1) {
      pixels[i * 4] = fill.r;
      pixels[i * 4 + 1] = fill.g;
      pixels[i * 4 + 2] = fill.b;
      pixels[i * 4 + 3] = 255;
    }
  }
  return { width, height, pixels };
}

/** Paint one pixel with bounds-safe clamping. */
export function setPixel(
  image: RgbaImage,
  x: number,
  y: number,
  color: RgbColor,
  alpha = 255,
): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const offset = (y * image.width + x) * 4;
  image.pixels[offset] = clampChannel(color.r);
  image.pixels[offset + 1] = clampChannel(color.g);
  image.pixels[offset + 2] = clampChannel(color.b);
  image.pixels[offset + 3] = alpha;
}
