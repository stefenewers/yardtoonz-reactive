// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { StyleGuideInspector } from "../../src/components/style-guide-inspector";
import type {
  FixtureConformanceResponse,
  StyleGuideResponse,
} from "../../src/domain/style-api";
import type { PaletteColor } from "../../src/domain/style-palette";
import {
  brandAccentColors,
  checkPaletteConformance,
  clayStyleTokenSet,
} from "../../src/domain/style-tokens";

const fixturePaths = {
  conformant: "brand/fixtures/clay-frame-conformant.png",
  partial: "brand/fixtures/clay-frame-partial.png",
  offbrand: "brand/fixtures/clay-frame-offbrand.png",
} as const;

function color(hex: string, rgb: PaletteColor["rgb"]): PaletteColor {
  return { hex, rgb, weight: 0.5, pixelCount: 500 };
}

const brandPalette: PaletteColor[] = [
  color("#ffd83d", { r: 255, g: 216, b: 61 }),
  color("#71d48c", { r: 113, g: 212, b: 140 }),
  color("#ff746c", { r: 255, g: 116, b: 108 }),
  color("#7a4a21", { r: 122, g: 74, b: 33 }),
  color("#3c2d1e", { r: 60, g: 45, b: 30 }),
  color("#171512", { r: 23, g: 21, b: 18 }),
];

/** Warm brand colors but too few for full tactile depth — scores PARTIAL. */
const shallowPalette: PaletteColor[] = [
  color("#ffd83d", { r: 255, g: 216, b: 61 }),
  color("#ff746c", { r: 255, g: 116, b: 108 }),
  color("#7a4a21", { r: 122, g: 74, b: 33 }),
  color("#3c2d1e", { r: 60, g: 45, b: 30 }),
];

const coolPalette: PaletteColor[] = [
  color("#00d0ff", { r: 0, g: 208, b: 255 }),
  color("#ff00e0", { r: 255, g: 0, b: 224 }),
  color("#f2f2f2", { r: 242, g: 242, b: 242 }),
  color("#0b0b0b", { r: 11, g: 11, b: 11 }),
];

function frameReport(
  name: FixtureConformanceResponse["name"],
  palette: PaletteColor[],
): FixtureConformanceResponse {
  return {
    name,
    label: `${name} fixture`,
    description: `Frame used to demonstrate the ${name} outcome.`,
    path: fixturePaths[name],
    width: 32,
    height: 18,
    palette,
    conformance: checkPaletteConformance(palette),
  };
}

const frameReports: Record<
  FixtureConformanceResponse["name"],
  FixtureConformanceResponse
> = {
  conformant: frameReport("conformant", brandPalette),
  partial: frameReport("partial", shallowPalette),
  offbrand: frameReport("offbrand", coolPalette),
};

function makeGuide(): StyleGuideResponse {
  return {
    tokenSet: clayStyleTokenSet,
    brandAccents: brandAccentColors().map(({ key, rgb }) => ({
      key,
      hex: `#${[rgb.r, rgb.g, rgb.b]
        .map((channel) => channel.toString(16).padStart(2, "0"))
        .join("")}`,
    })),
    logo: {
      path: "brand/yard-toonz-logo.png",
      width: 32,
      height: 32,
      palette: brandPalette,
      conformance: checkPaletteConformance(brandPalette),
    },
  };
}

type FetchStub = (input: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

function stubFetch(handler: FetchStub) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => handler(input)),
  );
}

function renderInspector() {
  return render(<StyleGuideInspector guide={makeGuide()} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StyleGuideInspector", () => {
  it("renders brand tokens, the logo palette, and the prompt contract", () => {
    stubFetch(() => {
      throw new Error("should not fetch during server render data");
    });

    renderInspector();

    expect(
      screen.getByRole("heading", { name: "Style guide inspector" }),
    ).toBeDefined();
    expect(screen.getAllByText("#ffd83d").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/handcrafted stop-motion claymation/),
    ).toBeDefined();
    expect(screen.getByText(clayStyleTokenSet.provenance)).toBeDefined();
    // Logo conformance is server-rendered and never waits on fetch.
    expect(screen.getAllByText("CONFORMANT").length).toBeGreaterThan(0);
  });

  it("loads fixture frame conformance from the API", async () => {
    stubFetch(async (input) => {
      const frame = new URL(input, "http://localhost").searchParams.get(
        "frame",
      );
      return {
        ok: true,
        status: 200,
        json: async () => frameReports[frame as "conformant"],
      };
    });

    renderInspector();

    // Wait for every frame card to land before counting verdict chips —
    // findAllByText returns on the first match (the server-rendered logo).
    await screen.findByText("PARTIAL", { selector: ".verdict-chip" });
    await screen.findByText("OFF_BRAND", { selector: ".verdict-chip" });
    expect(
      screen.getAllByText("CONFORMANT", { selector: ".verdict-chip" }),
    ).toHaveLength(2);
    // Factor explanations surface under each frame card.
    expect(
      await screen.findAllByText(/Jamaican red\/yellow\/green palette/),
    ).toHaveLength(3);
  });

  it("shows a per-frame error state when the API fails", async () => {
    stubFetch(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "Brand asset missing." } }),
    }));

    renderInspector();

    expect(await screen.findAllByText("Brand asset missing.")).toHaveLength(3);
  });

  it("recovers through the retry button", async () => {
    let failing = true;
    stubFetch(async (input) => {
      if (failing) {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      const frame = new URL(input, "http://localhost").searchParams.get(
        "frame",
      );
      return {
        ok: true,
        status: 200,
        json: async () => frameReports[frame as "conformant"],
      };
    });

    renderInspector();
    await screen.findAllByText(/Conformance check failed/);

    fireEvent.click(screen.getByRole("button", { name: "Re-check fixtures" }));
    expect(await screen.findAllByText("Checking conformance…")).toHaveLength(3);

    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Re-check fixtures" }));
    expect(
      await screen.findByText("PARTIAL", { selector: ".verdict-chip" }),
    ).toBeDefined();
  });
});
