import { describe, expect, it } from "vitest";

import { buildMockDirectorTreatment } from "../../src/domain/director";
import { MOTION_PRESETS } from "../../src/domain/motion";
import {
  buildCueSheet,
  buildStoryboardPlan,
  evaluateStoryboardPlan,
  storyboardBeatOrder,
  storyboardParamsSchema,
  storyboardPlanSchema,
  storyboardProblemCodes,
  storyboardResourceSchema,
  type StoryboardPlan,
} from "../../src/domain/storyboard";

const treatment = buildMockDirectorTreatment({
  candidateId: "cand_domain",
  caption: "Big yard energy — di whole a August Town a chat",
  metrics: { likes: 1200, shares: 300 },
  commentExcerpts: ["Him face when di beat drop mi dead"],
});

const seed = "cand_domain";

function freshPlan(): StoryboardPlan {
  return buildStoryboardPlan(treatment, seed);
}

function planWith(
  transform: (plan: StoryboardPlan) => StoryboardPlan,
): StoryboardPlan {
  return transform(freshPlan());
}

describe("storyboard plan building", () => {
  it("tiles the Director's recommended segment edge to edge", () => {
    const plan = freshPlan();
    const [firstFrame] = plan.frames;
    const lastFrame = plan.frames[plan.frames.length - 1]!;

    expect(plan.segment).toEqual(treatment.recommendedSegment);
    expect(firstFrame!.startSeconds).toBe(plan.segment.startSeconds);
    expect(lastFrame.endSeconds).toBe(plan.segment.endSeconds);
    for (let position = 1; position < plan.frames.length; position += 1) {
      expect(plan.frames[position]!.startSeconds).toBe(
        plan.frames[position - 1]!.endSeconds,
      );
    }
  });

  it("orders indexes 0..n-1 and runs beats in the canonical order", () => {
    const plan = freshPlan();

    plan.frames.forEach((frame, index) => {
      expect(frame.index).toBe(index);
      expect(frame.endSeconds).toBeGreaterThan(frame.startSeconds);
      expect(frame.prompt.length).toBeGreaterThan(0);
    });

    const ranks = plan.frames.map((frame) =>
      storyboardBeatOrder.indexOf(frame.beat),
    );
    for (let position = 1; position < ranks.length; position += 1) {
      expect(ranks[position]!).toBeGreaterThan(ranks[position - 1]!);
    }
  });

  it("derives every prompt from the treatment, never from thin air", () => {
    const plan = freshPlan();

    for (const frame of plan.frames) {
      switch (frame.beat) {
        case "ESTABLISH":
          expect(frame.prompt).toContain(treatment.adaptationConcept);
          break;
        case "SETUP":
          expect(frame.prompt).toContain(treatment.humorMechanism);
          break;
        case "PAYOFF":
          expect(frame.prompt).toContain(treatment.motionPrompt);
          break;
      }
      expect(frame.prompt).toMatch(/Camera: /);
    }
  });

  it("stores motion parameters the frame's own preset accepts", () => {
    const plan = freshPlan();

    for (const frame of plan.frames) {
      expect(() =>
        MOTION_PRESETS[frame.cameraMove].parseParams(frame.motionParams),
      ).not.toThrow();
    }
  });

  it("never repeats the same camera move on adjacent frames", () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const plan = buildStoryboardPlan(treatment, `${seed}:${attempt}`);
      for (let position = 1; position < plan.frames.length; position += 1) {
        expect(plan.frames[position]!.cameraMove).not.toBe(
          plan.frames[position - 1]!.cameraMove,
        );
      }
    }
  });

  it("is deterministic for the same treatment and seed", () => {
    expect(buildStoryboardPlan(treatment, seed)).toEqual(freshPlan());
  });

  it("picks the payoff pool for the payoff frame", () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const plan = buildStoryboardPlan(treatment, `${seed}:${attempt}`);
      const payoff = plan.frames.find((frame) => frame.beat === "PAYOFF");
      if (payoff) {
        expect(["STATIC", "ZOOM_IN"]).toContain(payoff.cameraMove);
      }
    }
  });

  it("rejects a treatment that does not satisfy the Director contract", () => {
    expect(() =>
      buildStoryboardPlan(
        {
          ...treatment,
          payoffTimestamp: treatment.setupTimestamp - 1,
        },
        seed,
      ),
    ).toThrow();
  });
});

describe("structural plan evaluation", () => {
  it("accepts the deterministic plan without problems", () => {
    expect(evaluateStoryboardPlan(freshPlan())).toEqual([]);
  });

  it("reports an empty plan instead of indexing into nothing", () => {
    const plan = planWith((current) => ({ ...current, frames: [] }));
    expect(evaluateStoryboardPlan(plan).map((problem) => problem.code)).toEqual(
      ["EMPTY_PLAN"],
    );
  });

  it("reports frames whose indexes drift from cue order", () => {
    const plan = planWith((current) => ({
      ...current,
      frames: current.frames.map((frame) => ({
        ...frame,
        index: frame.index + 1,
      })),
    }));
    expect(
      evaluateStoryboardPlan(plan).map((problem) => problem.code),
    ).toContain("UNSORTED_FRAMES");
  });

  it("reports a frame that ends before it starts", () => {
    const plan = planWith((current) => ({
      ...current,
      frames: current.frames.map((frame, index) =>
        index === 0
          ? { ...frame, endSeconds: frame.startSeconds - 0.1 }
          : frame,
      ),
    }));
    expect(
      evaluateStoryboardPlan(plan).map((problem) => problem.code),
    ).toContain("ZERO_LENGTH_FRAME");
  });

  it("reports a timing gap between adjacent frames", () => {
    const plan = planWith((current) => ({
      ...current,
      frames: current.frames.map((frame, index) =>
        index > 0
          ? { ...frame, startSeconds: frame.startSeconds + 0.5 }
          : frame,
      ),
    }));
    expect(
      evaluateStoryboardPlan(plan).map((problem) => problem.code),
    ).toContain("TIMING_GAP");
  });

  it("reports overlapping frames", () => {
    const plan = planWith((current) => ({
      ...current,
      frames: current.frames.map((frame, index) =>
        index > 0
          ? { ...frame, startSeconds: frame.startSeconds - 0.5 }
          : frame,
      ),
    }));
    expect(
      evaluateStoryboardPlan(plan).map((problem) => problem.code),
    ).toContain("TIMING_OVERLAP");
  });

  it("reports incomplete coverage of the segment", () => {
    const plan = planWith((current) => ({
      ...current,
      segment: {
        ...current.segment,
        endSeconds: current.segment.endSeconds + 2,
      },
    }));
    expect(evaluateStoryboardPlan(plan).map((problem) => problem.code)).toEqual(
      expect.arrayContaining(["COVERAGE_INCOMPLETE"]),
    );
  });

  it("reports beats shuffled out of the canonical order", () => {
    // Swap the labels of the first two frames: setup then establish is a
    // rank decrease, while every other structural property stays intact.
    const plan = planWith((current) => ({
      ...current,
      frames: current.frames.map((frame, index) =>
        index === 0
          ? { ...frame, beat: "SETUP" }
          : index === 1
            ? { ...frame, beat: "ESTABLISH" }
            : frame,
      ),
    }));
    expect(
      evaluateStoryboardPlan(plan).map((problem) => problem.code),
    ).toContain("BEAT_OUT_OF_ORDER");
  });

  it("reports a beat appearing twice in a row", () => {
    const plan = planWith((current) => {
      const duplicated = current.frames.map((frame, index) =>
        index === 1 ? { ...frame, beat: current.frames[0]!.beat } : frame,
      );
      return { ...current, frames: duplicated };
    });
    expect(
      evaluateStoryboardPlan(plan).map((problem) => problem.code),
    ).toContain("BEAT_DUPLICATE");
  });

  it("reports motion parameters the preset itself rejects", () => {
    const plan = planWith((current) => ({
      ...current,
      frames: current.frames.map((frame, index) =>
        index === 0
          ? { ...frame, motionParams: { ...frame.motionParams, intensity: 9 } }
          : frame,
      ),
    }));
    expect(
      evaluateStoryboardPlan(plan).map((problem) => problem.code),
    ).toContain("INVALID_MOTION_PARAMS");
  });

  it("reports several independent problems in one pass", () => {
    const plan = planWith((current) => ({
      ...current,
      frames: [
        ...current.frames,
        {
          index: current.frames.length,
          beat: "ESTABLISH",
          startSeconds: current.segment.endSeconds + 1,
          endSeconds: current.segment.endSeconds + 0.5,
          cameraMove: "PAN_LEFT",
          motionParams: {},
          prompt: "Broken",
        },
      ],
    }));
    const codes = evaluateStoryboardPlan(plan).map((problem) => problem.code);
    expect(codes).toContain("ZERO_LENGTH_FRAME");
    expect(codes).toContain("COVERAGE_INCOMPLETE");
    expect(codes).toContain("TIMING_GAP");
  });

  it("carries human-readable messages for every problem", () => {
    const plan = planWith((current) => ({ ...current, frames: [] }));
    for (const problem of evaluateStoryboardPlan(plan)) {
      expect(problem.message.length).toBeGreaterThan(0);
      expect(storyboardProblemCodes).toContain(problem.code);
    }
  });
});

describe("cue-sheet builder", () => {
  it("emits one cue per frame with per-cue durations", () => {
    const plan = freshPlan();
    const outcome = buildCueSheet(plan);
    if (!outcome.ok) throw new Error("Expected a valid cue sheet");

    expect(outcome.cueSheet.cues).toHaveLength(plan.frames.length);
    for (const [position, cue] of outcome.cueSheet.cues.entries()) {
      const frame = plan.frames[position]!;
      expect(cue.index).toBe(frame.index);
      expect(cue.beat).toBe(frame.beat);
      expect(cue.cameraMove).toBe(frame.cameraMove);
      expect(cue.prompt).toBe(frame.prompt);
      expect(cue.startSeconds).toBe(frame.startSeconds);
      expect(cue.endSeconds).toBe(frame.endSeconds);
      expect(cue.durationSeconds).toBeCloseTo(
        frame.endSeconds - frame.startSeconds,
        3,
      );
      expect(cue.zoompanExpression).toContain("zoompan=");
    }
  });

  it("totals the tiled segment duration", () => {
    const plan = freshPlan();
    const outcome = buildCueSheet(plan);
    if (!outcome.ok) throw new Error("Expected a valid cue sheet");

    expect(outcome.cueSheet.totalDurationSeconds).toBeCloseTo(
      plan.segment.endSeconds - plan.segment.startSeconds,
      2,
    );
    expect(outcome.cueSheet.totalDurationSeconds).toBeGreaterThanOrEqual(5);
    expect(outcome.cueSheet.totalDurationSeconds).toBeLessThanOrEqual(8);
  });

  it("rounds the frame count from duration at 24 fps", () => {
    const plan = freshPlan();
    const outcome = buildCueSheet(plan);
    if (!outcome.ok) throw new Error("Expected a valid cue sheet");

    const cue = outcome.cueSheet.cues[0]!;
    expect(cue.zoompanExpression).toContain(
      `d=${Math.max(1, Math.round(cue.durationSeconds * 24))}`,
    );
  });

  it("rejects a plan that runs shorter than the 5-second floor", () => {
    const plan: StoryboardPlan = {
      segment: { startSeconds: 0, endSeconds: 3 },
      frames: [
        {
          index: 0,
          beat: "ESTABLISH",
          startSeconds: 0,
          endSeconds: 1.5,
          cameraMove: "STATIC",
          motionParams: {},
          prompt: "Hold the open.",
        },
        {
          index: 1,
          beat: "SETUP",
          startSeconds: 1.5,
          endSeconds: 3,
          cameraMove: "STATIC",
          motionParams: {},
          prompt: "Hold the setup.",
        },
      ],
    };
    const shortOutcome = buildCueSheet(plan);
    expect(shortOutcome.ok).toBe(false);
    if (shortOutcome.ok) return;
    expect(shortOutcome.problems.map((problem) => problem.code)).toEqual([
      "DURATION_TOO_SHORT",
    ]);
  });

  it("rejects a plan that runs longer than the 8-second ceiling", () => {
    const plan: StoryboardPlan = {
      segment: { startSeconds: 0, endSeconds: 9 },
      frames: [
        {
          index: 0,
          beat: "ESTABLISH",
          startSeconds: 0,
          endSeconds: 4.5,
          cameraMove: "STATIC",
          motionParams: {},
          prompt: "Hold the open.",
        },
        {
          index: 1,
          beat: "SETUP",
          startSeconds: 4.5,
          endSeconds: 9,
          cameraMove: "STATIC",
          motionParams: {},
          prompt: "Hold the setup.",
        },
      ],
    };
    const longOutcome = buildCueSheet(plan);
    expect(longOutcome.ok).toBe(false);
    if (longOutcome.ok) return;
    expect(longOutcome.problems.map((problem) => problem.code)).toEqual([
      "DURATION_TOO_LONG",
    ]);
  });

  it("reports structural problems before duration problems", () => {
    const plan = planWith((current) => ({
      ...current,
      segment: {
        ...current.segment,
        endSeconds: current.segment.endSeconds + 5,
      },
      frames: current.frames.slice(0, 1),
    }));
    const outcome = buildCueSheet(plan);
    if (outcome.ok) throw new Error("Expected structural problems");
    expect(outcome.problems.map((problem) => problem.code)).not.toContain(
      "DURATION_TOO_LONG",
    );
    expect(outcome.problems.map((problem) => problem.code)).toContain(
      "COVERAGE_INCOMPLETE",
    );
  });
});

describe("resource and request contracts", () => {
  it("round-trips a storyboard resource through its schema", () => {
    const plan = freshPlan();
    const cueOutcome = buildCueSheet(plan);
    if (!cueOutcome.ok) throw new Error("Fixture plan must cue cleanly");

    const resource = storyboardResourceSchema.parse({
      id: "sb_cand_domain",
      candidateId: "cand_domain",
      provider: "MOCK",
      treatmentId: "treat_cand_domain",
      createdAt: "2026-09-03T12:00:00.000Z",
      plan,
      cueSheet: cueOutcome.cueSheet,
    });
    expect(resource.id).toBe("sb_cand_domain");
    expect(resource.cueSheet.cues.length).toBe(plan.frames.length);
  });

  it("rejects a resource whose provider is not the MOCK contract", () => {
    expect(() =>
      storyboardResourceSchema.parse({
        id: "sb_x",
        candidateId: "cand_x",
        provider: "OPENAI",
        treatmentId: "treat_x",
        createdAt: "2026-09-03T12:00:00.000Z",
        plan: storyboardPlanSchema.parse(freshPlan()),
        cueSheet: { cues: [], totalDurationSeconds: 1 },
      }),
    ).toThrow();
  });

  it("requires a non-empty id in route params", () => {
    expect(() => storyboardParamsSchema.parse({ id: "" })).toThrow();
    expect(storyboardParamsSchema.parse({ id: "sb_1" })).toEqual({
      id: "sb_1",
    });
    expect(() => storyboardParamsSchema.parse({})).toThrow();
  });
});
