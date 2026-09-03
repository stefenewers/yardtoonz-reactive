import { z } from "zod";

import {
  directorTreatmentSchema,
  type DirectorTreatment,
} from "@/domain/director";
import {
  MOTION_PRESETS,
  cameraMoves,
  describeMotionParams,
  motionZoompanExpression,
  parseMotionParams,
  type CameraMove,
} from "@/domain/motion";
import {
  maxSegmentSeconds,
  minSegmentSeconds,
} from "@/domain/production-setup";

/**
 * The storyboard subsystem turns a Director treatment into an ordered
 * keyframe plan and a cue sheet. Three structural rules carry the demo's
 * comic timing and are enforced here, not by callers:
 *
 * 1. The plan tiles the Director's recommended segment completely —
 *    every moment between segment start and end belongs to exactly one
 *    frame (monotonic timing, no gaps, no overlaps).
 * 2. The canonical beat order ESTABLISH → SETUP → PAYOFF is never
 *    shuffled or repeated.
 * 3. A cue sheet's total duration sits inside the studio's 5–8 second
 *    window, mirroring the segment bounds the setup UI enforces.
 *
 * Everything the frames say is derived from the treatment — no prompt
 * invents content the Director did not produce.
 */

export const storyboardBeats = ["ESTABLISH", "SETUP", "PAYOFF"] as const;
export type StoryboardBeat = (typeof storyboardBeats)[number];

/** Zero-length spans carry no story, so their beats are coalesced away. */
const beatSpanSeconds = (
  treatment: DirectorTreatment,
  beat: StoryboardBeat,
): { startSeconds: number; endSeconds: number } => {
  const { startSeconds, endSeconds } = treatment.recommendedSegment;
  switch (beat) {
    case "ESTABLISH":
      return { startSeconds, endSeconds: treatment.setupTimestamp };
    case "SETUP":
      return {
        startSeconds: treatment.setupTimestamp,
        endSeconds: treatment.payoffTimestamp,
      };
    case "PAYOFF":
      return {
        startSeconds: treatment.payoffTimestamp,
        endSeconds,
      };
  }
};

const beatPromptLines: Record<
  StoryboardBeat,
  (t: DirectorTreatment) => string
> = {
  ESTABLISH: (t) => `Open wide on the clay set: ${t.adaptationConcept}`,
  SETUP: (t) => `Hold the setup while the joke builds: ${t.humorMechanism}`,
  PAYOFF: (t) => `Land the payoff and hold the reaction. ${t.motionPrompt}`,
};

/**
 * Deterministic camera-move pools per beat: an establish frame drifts or
 * pulls back, a setup frame follows the action, a payoff frame lands and
 * holds. Stable per candidate so the same treatment always storyboards
 * the same way.
 */
const beatMovePools: Record<StoryboardBeat, readonly CameraMove[]> = {
  ESTABLISH: ["KEN_BURNS", "ZOOM_OUT", "PAN_LEFT", "PAN_RIGHT"],
  SETUP: ["ZOOM_IN", "PAN_LEFT", "PAN_RIGHT", "KEN_BURNS"],
  PAYOFF: ["STATIC", "ZOOM_IN"],
};

/** Stable non-cryptic seed hash — the storyboard never depends on clock. */
function variantIndex(seed: string, variantCount: number): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 1000003;
  }
  return hash % variantCount;
}

function pickCameraMove(
  beat: StoryboardBeat,
  seed: string,
  previousMove: CameraMove | undefined,
): CameraMove {
  const pool = beatMovePools[beat];
  const chosen = pool[variantIndex(`${seed}:${beat}`, pool.length)]!;
  // Adjacent frames never repeat a move: a storyboard that pans twice in
  // a row reads as a mistake, not a style.
  return chosen === previousMove
    ? pool[(pool.indexOf(chosen) + 1) % pool.length]!
    : chosen;
}

const frameTimingDecimals = 3;

function round(value: number): number {
  const factor = 10 ** frameTimingDecimals;
  return Math.round(value * factor) / factor;
}

const storyboardFrameSchema = z
  .object({
    /** Zero-based position in the plan; frames arrive in cue order. */
    index: z.number().int().min(0),
    beat: z.enum(storyboardBeats),
    startSeconds: z.number().finite().min(0),
    endSeconds: z.number().finite().positive(),
    cameraMove: z.enum(cameraMoves),
    motionParams: z.object({}).passthrough(),
    prompt: z.string().trim().min(1),
  })
  .superRefine((frame, context) => {
    if (frame.endSeconds <= frame.startSeconds) {
      context.addIssue({
        code: "custom",
        message: "A storyboard frame must end after it starts.",
        path: ["endSeconds"],
      });
    }
  })
  .readonly();
export type StoryboardFrame = z.infer<typeof storyboardFrameSchema>;

export const storyboardPlanSchema = z
  .object({
    segment: z
      .object({
        startSeconds: z.number().finite().min(0),
        endSeconds: z.number().finite().positive(),
      })
      .superRefine((segment, context) => {
        if (segment.endSeconds <= segment.startSeconds) {
          context.addIssue({
            code: "custom",
            message: "The storyboard segment must end after it starts.",
            path: ["endSeconds"],
          });
        }
      })
      .readonly(),
    frames: z.array(storyboardFrameSchema).min(1),
  })
  .readonly();
export type StoryboardPlan = z.infer<typeof storyboardPlanSchema>;

export const storyboardBeatOrder: StoryboardBeat[] = [
  "ESTABLISH",
  "SETUP",
  "PAYOFF",
];

/**
 * Builds the deterministic three-beat plan for a treatment. Beats whose
 * span collapsed to zero (a payoff that lands exactly on the setup, or
 * setup at segment start) are coalesced, so the plan only carries frames
 * that occupy real time.
 */
export function buildStoryboardPlan(
  treatment: DirectorTreatment,
  seed: string,
): StoryboardPlan {
  // Parse-through so callers cannot smuggle an out-of-contract treatment
  // into the plan; the Director contract is the single input shape.
  const validated = directorTreatmentSchema.parse(treatment);
  const { startSeconds, endSeconds } = validated.recommendedSegment;

  const frames: Array<{
    index: number;
    beat: StoryboardBeat;
    startSeconds: number;
    endSeconds: number;
    cameraMove: CameraMove;
    motionParams: Record<string, number | string>;
    prompt: string;
  }> = [];
  let previousMove: CameraMove | undefined;
  for (const beat of storyboardBeatOrder) {
    const span = beatSpanSeconds(validated, beat);
    if (span.endSeconds - span.startSeconds <= 0) continue;

    const cameraMove = pickCameraMove(beat, seed, previousMove);
    const preset = MOTION_PRESETS[cameraMove];
    // Pair the move with its params through the validated union so the
    // description and the stored shape share one correlated type.
    const motion = parseMotionParams({
      move: cameraMove,
      params: preset.defaultParams,
    });
    const beatPrompt = beatPromptLines[beat](validated);
    const cameraLine = `Camera: ${preset.label.toLowerCase()} — ${preset.description} ${describeMotionParams(motion)}.`;

    frames.push({
      index: frames.length,
      beat,
      startSeconds: round(span.startSeconds),
      endSeconds: round(span.endSeconds),
      cameraMove,
      motionParams: motion.params,
      prompt: `${beatPrompt} ${cameraLine}`,
    });
    previousMove = cameraMove;
  }

  return storyboardPlanSchema.parse({
    segment: {
      startSeconds: round(startSeconds),
      endSeconds: round(endSeconds),
    },
    frames,
  });
}

/** Stable problem codes the cue-sheet builder reports, in report order. */
export const storyboardProblemCodes = [
  "EMPTY_PLAN",
  "UNSORTED_FRAMES",
  "ZERO_LENGTH_FRAME",
  "TIMING_GAP",
  "TIMING_OVERLAP",
  "COVERAGE_INCOMPLETE",
  "BEAT_OUT_OF_ORDER",
  "BEAT_DUPLICATE",
  "INVALID_MOTION_PARAMS",
  "DURATION_TOO_SHORT",
  "DURATION_TOO_LONG",
] as const;
export type StoryboardProblemCode = (typeof storyboardProblemCodes)[number];

export interface StoryboardProblem {
  code: StoryboardProblemCode;
  message: string;
}

/** Mirrors the setup module's float tolerance for duration bounds. */
const durationEpsilon = 0.001;

/**
 * Structural plan evaluation: ordered indexes, positive frame lengths,
 * gap-free tiling of the full segment, canonical beat order, and motion
 * parameters each preset itself accepts. Pure — used by the cue-sheet
 * builder and directly testable.
 */
export function evaluateStoryboardPlan(plan: {
  segment: { startSeconds: number; endSeconds: number };
  frames: Array<{
    index: number;
    beat: StoryboardBeat;
    startSeconds: number;
    endSeconds: number;
    cameraMove: CameraMove;
    motionParams: Record<string, unknown>;
    prompt: string;
  }>;
}): StoryboardProblem[] {
  const problems: StoryboardProblem[] = [];

  if (plan.frames.length === 0) {
    problems.push({
      code: "EMPTY_PLAN",
      message: "A storyboard needs at least one frame.",
    });
    return problems;
  }

  const isOrdered = plan.frames.every(
    (frame, position) => frame.index === position,
  );
  if (!isOrdered) {
    problems.push({
      code: "UNSORTED_FRAMES",
      message: "Frame indexes must run 0..n-1 in cue order.",
    });
  }

  const beatsSeen: StoryboardBeat[] = [];
  for (const frame of plan.frames) {
    if (frame.endSeconds <= frame.startSeconds) {
      problems.push({
        code: "ZERO_LENGTH_FRAME",
        message: `Frame ${frame.index} (${frame.beat}) must end after it starts.`,
      });
      continue;
    }
    beatsSeen.push(frame.beat);
    try {
      MOTION_PRESETS[frame.cameraMove].parseParams(frame.motionParams);
    } catch {
      problems.push({
        code: "INVALID_MOTION_PARAMS",
        message: `Frame ${frame.index} carries ${frame.cameraMove} parameters the preset rejects.`,
      });
    }
  }

  const [firstFrame] = plan.frames;
  const lastFrame = plan.frames[plan.frames.length - 1]!;
  if (
    Math.abs(firstFrame!.startSeconds - plan.segment.startSeconds) >
    durationEpsilon
  ) {
    problems.push({
      code: "COVERAGE_INCOMPLETE",
      message: "The first frame must start at the segment start.",
    });
  }
  if (
    Math.abs(lastFrame.endSeconds - plan.segment.endSeconds) > durationEpsilon
  ) {
    problems.push({
      code: "COVERAGE_INCOMPLETE",
      message: "The last frame must end at the segment end.",
    });
  }

  for (let position = 1; position < plan.frames.length; position += 1) {
    const previous = plan.frames[position - 1]!;
    const current = plan.frames[position]!;
    if (current.startSeconds > previous.endSeconds + durationEpsilon) {
      problems.push({
        code: "TIMING_GAP",
        message: `A timing gap opens between frame ${previous.index} and frame ${current.index}.`,
      });
    } else if (current.startSeconds < previous.endSeconds - durationEpsilon) {
      problems.push({
        code: "TIMING_OVERLAP",
        message: `Frame ${current.index} overlaps frame ${previous.index}.`,
      });
    }
  }

  const beatOrder = new Map(
    storyboardBeatOrder.map((beat, rank) => [beat, rank] as const),
  );
  let lastRank = -1;
  for (const beat of beatsSeen) {
    const rank = beatOrder.get(beat)!;
    if (rank === lastRank) {
      problems.push({
        code: "BEAT_DUPLICATE",
        message: `The ${beat.toLowerCase()} beat appears twice in a row.`,
      });
    } else if (rank < lastRank) {
      problems.push({
        code: "BEAT_OUT_OF_ORDER",
        message: "Beats must run establish, setup, payoff — never shuffled.",
      });
    }
    lastRank = rank;
  }

  return problems;
}

export const cueSchema = z
  .object({
    index: z.number().int().min(0),
    beat: z.enum(storyboardBeats),
    startSeconds: z.number().finite().min(0),
    endSeconds: z.number().finite().positive(),
    durationSeconds: z.number().finite().positive(),
    cameraMove: z.enum(cameraMoves),
    prompt: z.string().trim().min(1),
    /** Executable motion expression for the Animator stage. */
    zoompanExpression: z.string().trim().min(1),
  })
  .readonly();
export type Cue = z.infer<typeof cueSchema>;

export const cueSheetSchema = z
  .object({
    cues: z.array(cueSchema).min(1),
    totalDurationSeconds: z.number().finite().positive(),
  })
  .readonly();
export type CueSheet = z.infer<typeof cueSheetSchema>;

export type CueSheetOutcome =
  | { ok: true; cueSheet: CueSheet }
  | { ok: false; problems: StoryboardProblem[] };

/**
 * Cue-sheet builder: validates the plan structurally, enforces the 5–8 s
 * studio window on the tiled segment, and emits per-cue zoompan
 * expressions for the Animator. The duration problems only fire on an
 * otherwise valid plan — structure problems are reported first.
 */
export function buildCueSheet(plan: StoryboardPlan): CueSheetOutcome {
  const structuralProblems = evaluateStoryboardPlan(plan);
  if (structuralProblems.length > 0) {
    return { ok: false, problems: structuralProblems };
  }

  const totalDuration =
    plan.frames[plan.frames.length - 1]!.endSeconds -
    plan.frames[0]!.startSeconds;
  if (totalDuration < minSegmentSeconds - durationEpsilon) {
    return {
      ok: false,
      problems: [
        {
          code: "DURATION_TOO_SHORT",
          message: `The storyboard runs ${totalDuration}s; the studio window is ${minSegmentSeconds}-${maxSegmentSeconds} seconds.`,
        },
      ],
    };
  }
  if (totalDuration > maxSegmentSeconds + durationEpsilon) {
    return {
      ok: false,
      problems: [
        {
          code: "DURATION_TOO_LONG",
          message: `The storyboard runs ${totalDuration}s; the studio window is ${minSegmentSeconds}-${maxSegmentSeconds} seconds.`,
        },
      ],
    };
  }

  const cues: Cue[] = plan.frames.map((frame) => {
    const durationSeconds = round(frame.endSeconds - frame.startSeconds);
    const motion = parseMotionParams({
      move: frame.cameraMove,
      params: frame.motionParams,
    });
    const frameCount = Math.max(1, Math.round(durationSeconds * 24));
    return {
      index: frame.index,
      beat: frame.beat,
      startSeconds: frame.startSeconds,
      endSeconds: frame.endSeconds,
      durationSeconds,
      cameraMove: frame.cameraMove,
      prompt: frame.prompt,
      zoompanExpression: motionZoompanExpression(motion, frameCount),
    };
  });

  return {
    ok: true,
    cueSheet: cueSheetSchema.parse({
      cues,
      totalDurationSeconds: round(totalDuration),
    }),
  };
}

export const storyboardResourceSchema = z
  .object({
    id: z.string().trim().min(1),
    candidateId: z.string().trim().min(1),
    provider: z.enum(["MOCK"]),
    treatmentId: z.string().trim().min(1),
    createdAt: z.iso.datetime(),
    plan: storyboardPlanSchema,
    cueSheet: cueSheetSchema,
  })
  .readonly();
export type StoryboardResource = z.infer<typeof storyboardResourceSchema>;

export const storyboardResponseSchema = z
  .object({ storyboard: storyboardResourceSchema })
  .readonly();

export const storyboardApiErrorCodes = [
  "INVALID_REQUEST",
  "CANDIDATE_NOT_FOUND",
  "TREATMENT_NOT_FOUND",
  "STORYBOARD_NOT_FOUND",
  "STORYBOARD_CONSTRAINTS_VIOLATED",
  "INTERNAL_ERROR",
] as const;
export type StoryboardApiErrorCode = (typeof storyboardApiErrorCodes)[number];

export const storyboardErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.enum(storyboardApiErrorCodes),
      message: z.string().trim().min(1),
    }),
  })
  .readonly();

export const storyboardConstraintsErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.enum(storyboardApiErrorCodes),
      message: z.string().trim().min(1),
      problems: z.array(
        z.object({
          code: z.enum(storyboardProblemCodes),
          message: z.string().trim().min(1),
        }),
      ),
    }),
  })
  .readonly();

export const storyboardParamsSchema = z
  .object({ id: z.string().trim().min(1) })
  .strict()
  .readonly();
export type StoryboardParams = z.infer<typeof storyboardParamsSchema>;
