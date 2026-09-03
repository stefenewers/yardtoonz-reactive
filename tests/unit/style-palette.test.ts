import { describe, expect, it } from "vitest";

import {
  contrastRatio,
  createRgbaImage,
  extractPalette,
  nearestPaletteColor,
  paletteMeanColor,
  paletteMeanSaturation,
  paletteWeightNear,
  parseHexColor,
  rgbToHex,
  rgbToHsl,
  setPixel,
  type RgbColor,
} from "../../src/domain/style-palette";
import { decodePng, encodePng } from "../../src/lib/png-image";

const red: RgbColor = { r: 220, g: 40, b: 40 };
const nearRed: RgbColor = { r: 210, g: 48, b: 44 };
const blue: RgbColor = { r: 40, g: 60, b: 220 };

describe("png codec", () => {
  it("round-trips a synthetic RGBA image byte-exactly", () => {
    const image = createRgbaImage(7, 5, red);
    setPixel(image, 3, 2, blue, 128);

    const decoded = decodePng(encodePng(image));

    expect(decoded.width).toBe(7);
    expect(decoded.height).toBe(5);
    expect(decoded.pixels).toEqual(image.pixels);
  });

  it("rejects bytes without the PNG signature", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow(/PNG signature/);
  });
});

describe("extractPalette", () => {
  it("reports one cluster for a flat image", () => {
    const palette = extractPalette(createRgbaImage(20, 20, red));
    expect(palette).toHaveLength(1);
    expect(palette[0]?.hex).toBe(rgbToHex(red));
    expect(palette[0]?.weight).toBeCloseTo(1, 5);
  });

  it("separates distinct color clusters and sorts by weight", () => {
    const image = createRgbaImage(40, 10, red);
    for (let y = 5; y < 10; y += 1) {
      for (let x = 0; x < 40; x += 1) setPixel(image, x, y, blue);
    }
    // A thin near-red stripe that must merge into the red cluster.
    for (let x = 0; x < 4; x += 1) setPixel(image, x, 0, nearRed);

    const palette = extractPalette(image);

    expect(palette).toHaveLength(2);
    expect(palette[0]?.hex).toBe(rgbToHex(red));
    expect(palette[1]?.hex).toBe(rgbToHex(blue));
    expect(palette[0]?.weight).toBeGreaterThan(palette[1]?.weight ?? 1);
    expect(palette.reduce((sum, entry) => sum + entry.weight, 0)).toBeCloseTo(
      1,
      5,
    );
  });

  it("excludes transparent pixels from the palette", () => {
    const image = createRgbaImage(10, 10);
    for (let y = 5; y < 10; y += 1) {
      for (let x = 0; x < 10; x += 1) setPixel(image, x, y, red);
    }

    const palette = extractPalette(image);

    expect(palette).toHaveLength(1);
    expect(palette[0]?.hex).toBe(rgbToHex(red));
    expect(palette[0]?.weight).toBeCloseTo(1, 5);
  });

  it("respects the maxColors cap", () => {
    const image = createRgbaImage(50, 10, red);
    const others = [blue, { r: 20, g: 200, b: 90 }, { r: 200, g: 200, b: 20 }];
    others.forEach((color, index) => {
      for (let y = 2 + index * 2; y < 4 + index * 2; y += 1) {
        for (let x = 0; x < 50; x += 1) setPixel(image, x, y, color);
      }
    });

    const palette = extractPalette(image, {
      maxColors: 2,
      minAlpha: 16,
      mergeDistance: 90,
    });

    expect(palette).toHaveLength(2);
  });
});

describe("color math", () => {
  it("parses and formats hex colors", () => {
    expect(parseHexColor("#ff746c")).toEqual({ r: 255, g: 116, b: 108 });
    expect(parseHexColor("ff746c")).toBeUndefined();
    expect(parseHexColor("#ff746")).toBeUndefined();
    expect(rgbToHex({ r: 7, g: 6, b: 5 })).toBe("#070605");
  });

  it("computes WCAG contrast ratios", () => {
    expect(
      contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }),
    ).toBe(21);
    expect(contrastRatio(red, red)).toBe(1);
  });

  it("converts RGB to HSL", () => {
    const hsl = rgbToHsl({ r: 255, g: 216, b: 61 });
    expect(hsl.h).toBeCloseTo(47, 0);
    expect(hsl.s).toBeGreaterThan(0.99);
    expect(hsl.l).toBeCloseTo(0.62, 2);
  });

  it("finds the nearest palette color", () => {
    const palette = [
      { hex: "#dc2828", rgb: red, weight: 0.5, pixelCount: 100 },
      { hex: "#283cdc", rgb: blue, weight: 0.5, pixelCount: 100 },
    ];
    expect(nearestPaletteColor(palette, nearRed)?.hex).toBe("#dc2828");
    expect(nearestPaletteColor([], red)).toBeUndefined();
  });
});

describe("palette statistics", () => {
  const palette = [
    { hex: "#dc2828", rgb: red, weight: 0.75, pixelCount: 300 },
    { hex: "#283cdc", rgb: blue, weight: 0.25, pixelCount: 100 },
  ];

  it("weights the mean color by cluster weight", () => {
    const mean = paletteMeanColor(palette);
    expect(mean?.r).toBeCloseTo((red.r * 3 + blue.r) / 4, 5);
    expect(paletteMeanColor([])).toBeUndefined();
  });

  it("weights the mean saturation", () => {
    const saturation = paletteMeanSaturation(palette);
    expect(saturation).toBeGreaterThan(0.5);
    expect(paletteMeanSaturation([])).toBeUndefined();
  });

  it("sums weight near target colors within a distance", () => {
    expect(paletteWeightNear(palette, [red], 60)).toBeCloseTo(0.75, 5);
    expect(paletteWeightNear(palette, [red], 0)).toBe(0);
    expect(paletteWeightNear([], [red], 110)).toBe(0);
  });
});
