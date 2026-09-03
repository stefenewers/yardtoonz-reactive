import { describe, expect, it } from "vitest";

import {
  MOTION_PRESETS,
  cameraMoves,
  defaultZoompanGeometry,
  describeMotionParams,
  easingCurves,
  motionZoompanExpression,
  type EasingCurve,
  motionParamsSchema,
  parseMotionParams,
  resolveMotionPreset,
  zoompanGeometrySchema,
  type MotionParams,
  type ZoompanGeometry,
} from "../../src/domain/motion";

/** A valid params payload per move, for parse/round-trip checks. */
const validParams: Record<string, Record<string, number | string>> = {
  PAN_LEFT: { intensity: 0.2, easing: "EASE_OUT" },
  PAN_RIGHT: { intensity: 0.3, easing: "LINEAR" },
  ZOOM_IN: { intensity: 0.25, easing: "EASE_IN" },
  ZOOM_OUT: { intensity: 0.4, easing: "EASE_IN_OUT" },
  KEN_BURNS: { panIntensity: 0.1, zoomIntensity: 0.2, easing: "LINEAR" },
  STATIC: {},
};

function parseOrFail(move: keyof typeof validParams): MotionParams {
  return motionParamsSchema.parse({
    move,
    params: validParams[move],
  });
}

describe("motion preset library", () => {
  it("exposes exactly the six studio camera moves", () => {
    expect(cameraMoves).toEqual([
      "PAN_LEFT",
      "PAN_RIGHT",
      "ZOOM_IN",
      "ZOOM_OUT",
      "KEN_BURNS",
      "STATIC",
    ]);
    expect(Object.keys(MOTION_PRESETS)).toEqual([...cameraMoves]);
  });

  it("labels and describes every preset for cue cards", () => {
    for (const move of cameraMoves) {
      const preset = MOTION_PRESETS[move];
      expect(preset.key).toBe(move);
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });

  it("ships default parameters each preset itself accepts", () => {
    for (const move of cameraMoves) {
      const preset = MOTION_PRESETS[move];
      expect(() => preset.parseParams(preset.defaultParams)).not.toThrow();
    }
  });

  it("round-trips valid parameters through parseParams", () => {
    for (const move of cameraMoves) {
      const preset = MOTION_PRESETS[move];
      expect(preset.parseParams(validParams[move])).toEqual(validParams[move]);
    }
  });

  it("rejects intensities outside the 5–100% band", () => {
    for (const move of ["PAN_LEFT", "ZOOM_IN", "KEN_BURNS"] as const) {
      const preset = MOTION_PRESETS[move];
      const base = validParams[move] as Record<string, number>;
      const intensityKeys =
        move === "KEN_BURNS"
          ? ["panIntensity", "zoomIntensity"]
          : ["intensity"];
      for (const key of intensityKeys) {
        expect(() => preset.parseParams({ ...base, [key]: 0.04 })).toThrow();
        expect(() => preset.parseParams({ ...base, [key]: 1.01 })).toThrow();
        expect(() =>
          preset.parseParams({ ...base, [key]: Number.NaN }),
        ).toThrow();
      }
    }
  });

  it("rejects unknown easing curves and malformed shapes", () => {
    expect(() =>
      MOTION_PRESETS.PAN_LEFT.parseParams({
        intensity: 0.2,
        easing: "SNAP",
      }),
    ).toThrow();
    expect(() =>
      MOTION_PRESETS.PAN_LEFT.parseParams({ intensity: 0.2 }),
    ).toThrow();
    expect(() => MOTION_PRESETS.ZOOM_IN.parseParams("zoom")).toThrow();
    expect(() => MOTION_PRESETS.STATIC.parseParams({ zoom: 2 })).toThrow();
  });

  it("keeps parameter shapes strict across presets", () => {
    // A pan move must not accept Ken Burns's extra parameters, and the
    // Ken Burns preset must not accept a bare intensity.
    expect(() =>
      MOTION_PRESETS.PAN_LEFT.parseParams({
        intensity: 0.2,
        easing: "LINEAR",
        zoomIntensity: 0.1,
      }),
    ).toThrow();
    expect(() =>
      MOTION_PRESETS.KEN_BURNS.parseParams({
        panIntensity: 0.1,
        zoomIntensity: 0.1,
        easing: "LINEAR",
        intensity: 0.1,
      }),
    ).toThrow();
  });

  it("discriminates the validated union by move", () => {
    const parsed = parseMotionParams({
      move: "ZOOM_OUT",
      params: validParams.ZOOM_OUT,
    });
    expect(parsed.move).toBe("ZOOM_OUT");
    if (parsed.move === "ZOOM_OUT") {
      expect(parsed.params).toEqual(validParams.ZOOM_OUT);
    }

    expect(() => parseMotionParams({ move: "DOLLY", params: {} })).toThrow();
  });
});

describe("zoompan expression builders", () => {
  it("carries shot length, geometry, and frame rate into every expression", () => {
    for (const move of cameraMoves) {
      const expression = motionZoompanExpression(parseOrFail(move), 120);
      expect(expression).toContain("zoompan=");
      expect(expression).toContain("d=120");
      expect(expression).toContain(
        `s=${defaultZoompanGeometry.width}x${defaultZoompanGeometry.height}`,
      );
      expect(expression).toContain(`fps=${defaultZoompanGeometry.fps}`);
    }
  });

  it("anchors pans at unit zoom with a horizontal drift term", () => {
    const expression = MOTION_PRESETS.PAN_LEFT.zoompanExpression(
      { intensity: 0.2, easing: "LINEAR" },
      96,
    );
    expect(expression).toContain("z=1:");
    expect(expression).toContain("iw*0.2");
    expect(expression).toContain("x='iw/2-(iw/zoom/2)");
  });

  it("pushes zoom-in from unit scale by the eased depth", () => {
    const expression = MOTION_PRESETS.ZOOM_IN.zoompanExpression(
      { intensity: 0.25, easing: "LINEAR" },
      96,
    );
    expect(expression).toContain("z='1+0.2500*");
    expect(expression).toContain("on/(D-1)");
  });

  it("pulls zoom-out back from the deepened scale", () => {
    const expression = MOTION_PRESETS.ZOOM_OUT.zoompanExpression(
      { intensity: 0.25, easing: "LINEAR" },
      96,
    );
    expect(expression).toContain("z='1.2500-0.2500*");
  });

  it("layers a pan term under the Ken Burns zoom", () => {
    const expression = MOTION_PRESETS.KEN_BURNS.zoompanExpression(
      { panIntensity: 0.1, zoomIntensity: 0.2, easing: "LINEAR" },
      96,
    );
    expect(expression).toContain("z='1+0.2000*");
    expect(expression).toContain("iw*0.1");
  });

  it("holds the frame still for STATIC shots", () => {
    const expression = MOTION_PRESETS.STATIC.zoompanExpression({}, 96);
    expect(expression).toContain("z=1:");
    expect(expression).not.toContain("iw*");
  });

  it("reflects the easing curve in the progress term", () => {
    const snippets: Record<EasingCurve, string> = {
      LINEAR: "on/(D-1)",
      EASE_IN: "pow(on/(D-1),2)",
      EASE_OUT: "1-pow(1-on/(D-1),2)",
      EASE_IN_OUT: "1-pow(2-2*on/(D-1),2)/2",
    };
    for (const easing of easingCurves) {
      const expression = MOTION_PRESETS.ZOOM_IN.zoompanExpression(
        { intensity: 0.2, easing },
        96,
      );
      expect(expression).toContain(snippets[easing]);
    }
  });

  it("honors a caller-supplied render geometry", () => {
    const geometry: ZoompanGeometry = zoompanGeometrySchema.parse({
      width: 1080,
      height: 1920,
      fps: 30,
    });
    const expression = MOTION_PRESETS.PAN_RIGHT.zoompanExpression(
      { intensity: 0.15, easing: "LINEAR" },
      90,
      geometry,
    );
    expect(expression).toContain("d=90:s=1080x1920:fps=30");
  });

  it("rejects a malformed render geometry", () => {
    expect(() =>
      zoompanGeometrySchema.parse({ width: 0, height: 640, fps: 24 }),
    ).toThrow();
  });
});

describe("correlated dispatch", () => {
  it("resolves the preset record exhaustively by move", () => {
    for (const move of cameraMoves) {
      expect(resolveMotionPreset(move)).toBe(MOTION_PRESETS[move]);
    }
  });

  it("routes each validated pair to its preset's own expression", () => {
    // One assertion per parameter shape: pan, zoom, Ken Burns blend, and
    // the static hold — siblings share shapes so they add no coverage.
    expect(motionZoompanExpression(parseOrFail("PAN_LEFT"), 72)).toBe(
      MOTION_PRESETS.PAN_LEFT.zoompanExpression(
        { intensity: 0.2, easing: "EASE_OUT" },
        72,
      ),
    );
    expect(motionZoompanExpression(parseOrFail("ZOOM_IN"), 72)).toBe(
      MOTION_PRESETS.ZOOM_IN.zoompanExpression(
        { intensity: 0.25, easing: "EASE_IN" },
        72,
      ),
    );
    expect(motionZoompanExpression(parseOrFail("KEN_BURNS"), 72)).toBe(
      MOTION_PRESETS.KEN_BURNS.zoompanExpression(
        { panIntensity: 0.1, zoomIntensity: 0.2, easing: "LINEAR" },
        72,
      ),
    );
    expect(motionZoompanExpression(parseOrFail("STATIC"), 72)).toBe(
      MOTION_PRESETS.STATIC.zoompanExpression({}, 72),
    );
  });
});

describe("human-readable motion summaries", () => {
  it("summarizes pan direction, easing, and travel", () => {
    expect(describeMotionParams(parseOrFail("PAN_LEFT"))).toBe(
      "Pan left — easing out, 20% of frame width",
    );
    expect(describeMotionParams(parseOrFail("PAN_RIGHT"))).toBe(
      "Pan right — linear, 30% of frame width",
    );
  });

  it("summarizes zoom depth per direction", () => {
    expect(describeMotionParams(parseOrFail("ZOOM_IN"))).toBe(
      "Zoom in — easing in, 25% depth",
    );
    expect(describeMotionParams(parseOrFail("ZOOM_OUT"))).toBe(
      "Zoom out — easing in-out, 40% depth",
    );
  });

  it("summarizes the Ken Burns blend and the static hold", () => {
    expect(describeMotionParams(parseOrFail("KEN_BURNS"))).toBe(
      "Ken Burns — linear, pan 10%, zoom 20%",
    );
    expect(describeMotionParams(parseOrFail("STATIC"))).toBe(
      "Static — hold the frame",
    );
  });
});
