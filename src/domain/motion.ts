import { z } from "zod";

/**
 * The motion preset library: the six camera moves a storyboard frame can
 * call for, each with its own typed parameters, defaults, and a pure
 * FFmpeg zoompan expression builder. The library is domain-level — it
 * describes motion; executing it against pixels stays in the pipeline.
 *
 * Every preset validates its parameters, so a cue sheet can never carry a
 * move whose parameters the preset itself would reject.
 */

export const cameraMoves = [
  "PAN_LEFT",
  "PAN_RIGHT",
  "ZOOM_IN",
  "ZOOM_OUT",
  "KEN_BURNS",
  "STATIC",
] as const;
export type CameraMove = (typeof cameraMoves)[number];

export const easingCurves = [
  "LINEAR",
  "EASE_IN",
  "EASE_OUT",
  "EASE_IN_OUT",
] as const;
export type EasingCurve = (typeof easingCurves)[number];

/** Shared motion intensity: fraction of frame dimension the move traverses. */
export const intensitySchema = z.number().min(0.05).max(1);

const panParamsSchema = z
  .object({
    /** Horizontal travel as a fraction of frame width. */
    intensity: intensitySchema,
    easing: z.enum(easingCurves),
  })
  .strict()
  .readonly();
export type PanParams = z.infer<typeof panParamsSchema>;

const zoomParamsSchema = z
  .object({
    /** Zoom depth as a fraction of the starting scale. */
    intensity: intensitySchema,
    easing: z.enum(easingCurves),
  })
  .strict()
  .readonly();
export type ZoomParams = z.infer<typeof zoomParamsSchema>;

const kenBurnsParamsSchema = z
  .object({
    panIntensity: intensitySchema,
    zoomIntensity: intensitySchema,
    easing: z.enum(easingCurves),
  })
  .strict()
  .readonly();
export type KenBurnsParams = z.infer<typeof kenBurnsParamsSchema>;

const staticParamsSchema = z.object({}).strict().readonly();
export type StaticParams = z.infer<typeof staticParamsSchema>;

export const motionParamsSchema = z.discriminatedUnion("move", [
  z.object({ move: z.literal("PAN_LEFT"), params: panParamsSchema }).readonly(),
  z
    .object({ move: z.literal("PAN_RIGHT"), params: panParamsSchema })
    .readonly(),
  z.object({ move: z.literal("ZOOM_IN"), params: zoomParamsSchema }).readonly(),
  z
    .object({ move: z.literal("ZOOM_OUT"), params: zoomParamsSchema })
    .readonly(),
  z
    .object({ move: z.literal("KEN_BURNS"), params: kenBurnsParamsSchema })
    .readonly(),
  z
    .object({ move: z.literal("STATIC"), params: staticParamsSchema })
    .readonly(),
]);
export type MotionParams = z.infer<typeof motionParamsSchema>;

/**
 * Geometry a zoompan expression is computed against. The demo pipeline is
 * 9:16 portrait at 24 fps; the defaults pin that, callers may override.
 */
export const zoompanGeometrySchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().positive(),
  })
  .strict()
  .readonly();
export type ZoompanGeometry = z.infer<typeof zoompanGeometrySchema>;

export const defaultZoompanGeometry: ZoompanGeometry = {
  width: 360,
  height: 640,
  fps: 24,
};

/**
 * Easing maps normalized progress (0..1) onto eased progress (0..1).
 * Expressed as a zoompan-evaluable expression over the output frame
 * index `on` against the shot length `D`.
 */
const easingExpressions: Record<EasingCurve, string> = {
  LINEAR: "on/(D-1)",
  EASE_IN: "pow(on/(D-1),2)",
  EASE_OUT: "1-pow(1-on/(D-1),2)",
  EASE_IN_OUT: "(on/(D-1)<0.5)?2*pow(on/(D-1),2):1-pow(2-2*on/(D-1),2)/2",
};

export interface MotionPreset<P> {
  readonly key: CameraMove;
  readonly label: string;
  readonly description: string;
  readonly defaultParams: P;
  /** Validates parameters for this preset specifically. */
  readonly parseParams: (params: unknown) => P;
  /**
   * Pure FFmpeg zoompan expression for the move over one shot. `frames`
   * is the shot length in frames; the caller owns frame-count rounding.
   */
  readonly zoompanExpression: (
    params: P,
    frames: number,
    geometry?: ZoompanGeometry,
  ) => string;
}

function panZoompan(
  params: PanParams,
  frames: number,
  geometry: ZoompanGeometry,
): string {
  const easing = easingExpressions[params.easing]!;
  // x/y anchor the crop window; the pan drifts it across the frame while
  // staying centered vertically, so pans never read past the edges.
  const drift = params.intensity;
  return [
    "zoompan=",
    "z=1:",
    `x='iw/2-(iw/zoom/2)-iw*${drift}/2+iw*${drift}*(${easing})':`,
    "y='ih/2-(ih/zoom/2)':",
    `d=${frames}:s=${geometry.width}x${geometry.height}:fps=${geometry.fps}`,
  ].join("");
}

function zoomZoompan(
  params: ZoomParams,
  direction: "in" | "out",
  frames: number,
  geometry: ZoompanGeometry,
): string {
  const easing = easingExpressions[params.easing]!;
  // ZOOM_IN scales 1 → 1+depth; ZOOM_OUT scales 1+depth → 1. The eased
  // progress term drives the scale so the push respects the curve.
  const depth = 1 + params.intensity;
  const scale =
    direction === "in"
      ? `1+${(depth - 1).toFixed(4)}*(${easing})`
      : `${depth.toFixed(4)}-${(depth - 1).toFixed(4)}*(${easing})`;
  return [
    "zoompan=",
    `z='${scale}':`,
    "x='iw/2-(iw/zoom/2)':",
    "y='ih/2-(ih/zoom/2)':",
    `d=${frames}:s=${geometry.width}x${geometry.height}:fps=${geometry.fps}`,
  ].join("");
}

function kenBurnsZoompan(
  params: KenBurnsParams,
  frames: number,
  geometry: ZoompanGeometry,
): string {
  const easing = easingExpressions[params.easing]!;
  const zoomDepth = 1 + params.zoomIntensity;
  return [
    "zoompan=",
    `z='${1}+${(zoomDepth - 1).toFixed(4)}*(${easing})':`,
    `x='iw/2-(iw/zoom/2)-iw*${params.panIntensity}/2+iw*${params.panIntensity}*(${easing})':`,
    "y='ih/2-(ih/zoom/2)':",
    `d=${frames}:s=${geometry.width}x${geometry.height}:fps=${geometry.fps}`,
  ].join("");
}

function staticZoompan(frames: number, geometry: ZoompanGeometry): string {
  return [
    "zoompan=",
    "z=1:",
    "x='iw/2-(iw/zoom/2)':",
    "y='ih/2-(ih/zoom/2)':",
    `d=${frames}:s=${geometry.width}x${geometry.height}:fps=${geometry.fps}`,
  ].join("");
}

export const MOTION_PRESETS: {
  [K in CameraMove]: MotionPreset<
    K extends "PAN_LEFT" | "PAN_RIGHT"
      ? PanParams
      : K extends "ZOOM_IN" | "ZOOM_OUT"
        ? ZoomParams
        : K extends "KEN_BURNS"
          ? KenBurnsParams
          : StaticParams
  >;
} = {
  PAN_LEFT: {
    key: "PAN_LEFT",
    label: "Pan left",
    description: "Drifts the frame leftward to reveal what waits off-frame.",
    defaultParams: { intensity: 0.12, easing: "EASE_IN_OUT" },
    parseParams: (params) => panParamsSchema.parse(params),
    zoompanExpression: (params, frames, geometry = defaultZoompanGeometry) =>
      panZoompan(params, frames, geometry),
  },
  PAN_RIGHT: {
    key: "PAN_RIGHT",
    label: "Pan right",
    description: "Drifts the frame rightward to follow the action.",
    defaultParams: { intensity: 0.12, easing: "EASE_IN_OUT" },
    parseParams: (params) => panParamsSchema.parse(params),
    zoompanExpression: (params, frames, geometry = defaultZoompanGeometry) =>
      panZoompan(params, frames, geometry),
  },
  ZOOM_IN: {
    key: "ZOOM_IN",
    label: "Zoom in",
    description: "Pushes into the scene to tighten on the reaction.",
    defaultParams: { intensity: 0.15, easing: "EASE_IN" },
    parseParams: (params) => zoomParamsSchema.parse(params),
    zoompanExpression: (params, frames, geometry = defaultZoompanGeometry) =>
      zoomZoompan(params, "in", frames, geometry),
  },
  ZOOM_OUT: {
    key: "ZOOM_OUT",
    label: "Zoom out",
    description: "Pulls back to establish the full clay set.",
    defaultParams: { intensity: 0.15, easing: "EASE_OUT" },
    parseParams: (params) => zoomParamsSchema.parse(params),
    zoompanExpression: (params, frames, geometry = defaultZoompanGeometry) =>
      zoomZoompan(params, "out", frames, geometry),
  },
  KEN_BURNS: {
    key: "KEN_BURNS",
    label: "Ken Burns",
    description:
      "Slow pan-and-zoom drift that keeps a still frame feeling alive.",
    defaultParams: { panIntensity: 0.08, zoomIntensity: 0.1, easing: "LINEAR" },
    parseParams: (params) => kenBurnsParamsSchema.parse(params),
    zoompanExpression: (params, frames, geometry = defaultZoompanGeometry) =>
      kenBurnsZoompan(params, frames, geometry),
  },
  STATIC: {
    key: "STATIC",
    label: "Static",
    description: "Holds the frame still so the payoff can land.",
    defaultParams: {},
    parseParams: (params) => staticParamsSchema.parse(params),
    zoompanExpression: (_params, frames, geometry = defaultZoompanGeometry) =>
      staticZoompan(frames, geometry),
  },
};

/** Exhaustive accessor: unknown moves are a type error, not a lookup miss. */
export function resolveMotionPreset<K extends CameraMove>(
  move: K,
): (typeof MOTION_PRESETS)[K] {
  return MOTION_PRESETS[move];
}

/** Validates a move/params pair against the discriminated union. */
export function parseMotionParams(params: unknown): MotionParams {
  return motionParamsSchema.parse(params);
}

/**
 * Correlated move↔params dispatch: routes a validated pair to the
 * preset's own expression builder. The preset record cannot pair the
 * union by itself — indexing by a move-typed key hands TypeScript an
 * uncorrelated params union, so the switch narrows both sides at once.
 */
export function motionZoompanExpression(
  params: MotionParams,
  frames: number,
  geometry?: ZoompanGeometry,
): string {
  switch (params.move) {
    case "PAN_LEFT":
    case "PAN_RIGHT":
      return MOTION_PRESETS[params.move].zoompanExpression(
        params.params,
        frames,
        geometry,
      );
    case "ZOOM_IN":
    case "ZOOM_OUT":
      return MOTION_PRESETS[params.move].zoompanExpression(
        params.params,
        frames,
        geometry,
      );
    case "KEN_BURNS":
      return MOTION_PRESETS[params.move].zoompanExpression(
        params.params,
        frames,
        geometry,
      );
    case "STATIC":
      return MOTION_PRESETS[params.move].zoompanExpression(
        params.params,
        frames,
        geometry,
      );
  }
}

/**
 * Human-readable one-line motion summary for cue cards and prompts,
 * e.g. "Pan left — easing in-out, 12% of frame width".
 */
export function describeMotionParams(params: MotionParams): string {
  const preset = MOTION_PRESETS[params.move];
  switch (params.move) {
    case "PAN_LEFT":
    case "PAN_RIGHT": {
      const pan = params.params;
      return `${preset.label} — ${formatEasing(pan.easing)}, ${formatPercent(pan.intensity)} of frame width`;
    }
    case "ZOOM_IN":
    case "ZOOM_OUT": {
      const zoom = params.params;
      return `${preset.label} — ${formatEasing(zoom.easing)}, ${formatPercent(zoom.intensity)} depth`;
    }
    case "KEN_BURNS": {
      const kenBurns = params.params;
      return `${preset.label} — ${formatEasing(kenBurns.easing)}, pan ${formatPercent(kenBurns.panIntensity)}, zoom ${formatPercent(kenBurns.zoomIntensity)}`;
    }
    case "STATIC":
      return `${preset.label} — hold the frame`;
  }
}

function formatEasing(easing: EasingCurve): string {
  const labels: Record<EasingCurve, string> = {
    LINEAR: "linear",
    EASE_IN: "easing in",
    EASE_OUT: "easing out",
    EASE_IN_OUT: "easing in-out",
  };
  return labels[easing]!;
}

function formatPercent(intensity: number): string {
  return `${Math.round(intensity * 100)}%`;
}
