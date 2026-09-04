import { describe, expect, it } from "vitest";

import type { AgentKey } from "../../src/domain/agent-trace";
import {
  assembleStepInputs,
  blockerLabel,
  buildHandoff,
  buildHandoffSequence,
  buildOrchestrationTimeline,
  isRecoverableFailure,
  orchestrationSteps,
  planRun,
  previousStep,
  stepBlockers,
  type AgentStepObservation,
  type OrchestrationSnapshot,
} from "../../src/domain/orchestration";
import { handoffMessageSchema } from "../../src/shared/orchestration";

/**
 * Pure planner suites: ordering, idempotency, resume-from-failure, the
 * typed handoff contract, per-agent input assembly, and the timeline
 * driver. No database — snapshots stand in for persisted rows.
 */

const CANDIDATE_ID = "cand_test-001";

function observation(
  state: "COMPLETE" | "FAILED" | null,
  overrides: Partial<AgentStepObservation> = {},
): AgentStepObservation {
  return {
    latestState: state,
    attempt: state === null ? null : 1,
    decision: state === "COMPLETE" ? "Did the work." : null,
    confidence: state === "COMPLETE" ? 1 : null,
    provider: null,
    model: null,
    elapsedMs: state === null ? null : 12,
    artifactIds: state === "COMPLETE" ? ["art_styled-1"] : [],
    errorCode:
      state === "FAILED"
        ? (overrides.errorCode ?? "MEDIA_PROCESSING_FAILED")
        : null,
    ...overrides,
  };
}

function completeThrough(
  agentKey: AgentKey,
): Record<AgentKey, AgentStepObservation> {
  const observations = {} as Record<AgentKey, AgentStepObservation>;
  const index = orchestrationSteps.indexOf(agentKey);
  for (const step of orchestrationSteps) {
    const stepIndex = orchestrationSteps.indexOf(step);
    observations[step] = observation(stepIndex <= index ? "COMPLETE" : null);
  }
  return observations;
}

function makeSnapshot(
  overrides: Partial<OrchestrationSnapshot> = {},
): OrchestrationSnapshot {
  return {
    candidateId: CANDIDATE_ID,
    candidateExists: true,
    candidateApproved: true,
    rightsConfirmed: true,
    commentCount: 4,
    metricsSupplied: true,
    adaptationNoteSupplied: true,
    hasKeyframe: true,
    hasStyledFrame: false,
    hasSilentAnimation: false,
    hasFinalVideo: false,
    production: {
      id: "prod_test-1",
      status: "QUEUED",
      imageProvider: "MOCK",
      animationProvider: "MOCK",
    },
    treatment: {
      id: "treat_test-1",
      provider: "MOCK",
      claymationPromptSupplied: true,
      motionPromptSupplied: true,
      socialCaptionSupplied: true,
    },
    observations: completeThrough("trend-scout"),
    ...overrides,
  };
}

describe("planner ordering", () => {
  it("always plans exactly the six named agents in demo order", () => {
    const plan = planRun(makeSnapshot());
    expect(plan.steps.map((step) => step.agentKey)).toEqual([
      "trend-scout",
      "humor-analyst",
      "yardtoonz-director",
      "clay-artist",
      "animator",
      "qa-inspector",
    ]);
  });

  it("puts the cursor on the first incomplete step", () => {
    const plan = planRun(
      makeSnapshot({ observations: completeThrough("humor-analyst") }),
    );
    expect(plan.currentStepKey).toBe("yardtoonz-director");
    expect(plan.complete).toBe(false);
  });

  it("reports an empty trace as blocked trend-scout with the run not complete", () => {
    const empty = Object.fromEntries(
      orchestrationSteps.map((agentKey) => [agentKey, observation(null)]),
    ) as Record<AgentKey, AgentStepObservation>;
    const snapshot = makeSnapshot({
      candidateExists: false,
      rightsConfirmed: false,
      production: null,
      treatment: null,
      observations: empty,
    });
    const plan = planRun(snapshot);

    expect(plan.currentStepKey).toBe("trend-scout");
    expect(plan.complete).toBe(false);
    const trend = plan.steps[0]!;
    expect(trend.state).toBe("BLOCKED");
    expect(trend.blockers).toContain("CANDIDATE_MISSING");
  });

  it("marks every step COMPLETE when the whole trace is complete", () => {
    const plan = planRun(
      makeSnapshot({
        hasFinalVideo: true,
        observations: completeThrough("qa-inspector"),
      }),
    );
    expect(plan.complete).toBe(true);
    expect(plan.currentStepKey).toBeNull();
    expect(plan.steps.every((step) => step.state === "COMPLETE")).toBe(true);
  });

  it("keeps later steps BLOCKED while an earlier step is incomplete", () => {
    const snapshot = makeSnapshot({
      observations: completeThrough("yardtoonz-director"),
      hasStyledFrame: false,
    });
    const plan = planRun(snapshot);

    const animator = plan.steps.find((step) => step.agentKey === "animator")!;
    expect(animator.state).toBe("BLOCKED");
    expect(animator.blockers).toContain("PREVIOUS_STEP_INCOMPLETE");
  });

  it("derives previousStep for every step in the sequence", () => {
    expect(previousStep("trend-scout")).toBeNull();
    expect(previousStep("humor-analyst")).toBe("trend-scout");
    expect(previousStep("qa-inspector")).toBe("animator");
  });
});

describe("planner idempotency", () => {
  it("produces a structurally identical plan from the same snapshot", () => {
    const snapshot = makeSnapshot({
      observations: completeThrough("clay-artist"),
      hasStyledFrame: true,
    });
    const first = planRun(snapshot);
    const second = planRun(snapshot);
    expect(JSON.stringify(first)).toEqual(JSON.stringify(second));
  });

  it("produces a structurally identical plan from equal but distinct snapshots", () => {
    const first = planRun(makeSnapshot());
    const second = planRun(makeSnapshot());
    expect(JSON.stringify(first)).toEqual(JSON.stringify(second));
  });

  it("never duplicates a step across repeated planning", () => {
    const snapshot = makeSnapshot({
      observations: completeThrough("humor-analyst"),
    });
    const keys = planRun(snapshot).steps.map((step) => step.agentKey);
    expect(new Set(keys).size).toBe(6);
    planRun(snapshot);
    planRun(snapshot);
    expect(planRun(snapshot).steps).toHaveLength(6);
  });
});

describe("resume-from-failure", () => {
  it("surfaces the failed step, its safe error code, and downstream blocks", () => {
    const snapshot = makeSnapshot({
      observations: {
        ...completeThrough("yardtoonz-director"),
        "clay-artist": observation("FAILED"),
      },
    });
    const plan = planRun(snapshot);

    expect(plan.failedStepKey).toBe("clay-artist");
    expect(plan.currentStepKey).toBe("clay-artist");
    const failed = plan.steps.find((step) => step.agentKey === "clay-artist")!;
    expect(failed.state).toBe("FAILED");
    expect(failed.errorCode).toBe("MEDIA_PROCESSING_FAILED");
    // The cursor never skips past a failure.
    const animator = plan.steps.find((step) => step.agentKey === "animator")!;
    expect(animator.state).toBe("BLOCKED");
    expect(isRecoverableFailure(plan)).toBe(true);
  });

  it("reflects recovery after a retry: the failed step completes and the cursor advances", () => {
    const failed = makeSnapshot({
      observations: {
        ...completeThrough("yardtoonz-director"),
        "clay-artist": observation("FAILED"),
      },
    });
    expect(planRun(failed).failedStepKey).toBe("clay-artist");

    // The human retried the stage; the trace now records a COMPLETE run
    // for the same agent (a later attempt row).
    const recovered = makeSnapshot({
      hasStyledFrame: true,
      observations: {
        ...completeThrough("yardtoonz-director"),
        "clay-artist": observation("COMPLETE", { attempt: 2 }),
        animator: observation(null),
        "qa-inspector": observation(null),
      },
    });
    const plan = planRun(recovered);

    expect(plan.failedStepKey).toBeNull();
    expect(plan.currentStepKey).toBe("animator");
    const clay = plan.steps.find((step) => step.agentKey === "clay-artist")!;
    expect(clay.state).toBe("COMPLETE");
    expect(clay.attempt).toBe(2);
    expect(isRecoverableFailure(plan)).toBe(false);
  });

  it("does not recover while the step is still failing", () => {
    const snapshot = makeSnapshot({
      observations: {
        ...completeThrough("yardtoonz-director"),
        "clay-artist": observation("FAILED", { attempt: 2 }),
      },
    });
    const plan = planRun(snapshot);
    expect(plan.failedStepKey).toBe("clay-artist");
    expect(plan.currentStepKey).toBe("clay-artist");
  });
});

describe("human gates", () => {
  it("blocks the director step until the candidate is approved", () => {
    const snapshot = makeSnapshot({
      candidateApproved: false,
      observations: completeThrough("humor-analyst"),
    });
    const blockers = stepBlockers("yardtoonz-director", snapshot);
    expect(blockers).toContain("CANDIDATE_NOT_APPROVED");
  });

  it("blocks media steps until rights are confirmed and a production exists", () => {
    const snapshot = makeSnapshot({
      rightsConfirmed: false,
      production: null,
      observations: completeThrough("yardtoonz-director"),
    });
    const blockers = stepBlockers("clay-artist", snapshot);
    expect(blockers).toContain("RIGHTS_NOT_CONFIRMED");
    expect(blockers).toContain("PRODUCTION_MISSING");
  });

  it("blocks the clay artist until the source is uploaded (no keyframe)", () => {
    const snapshot = makeSnapshot({
      hasKeyframe: false,
      observations: completeThrough("yardtoonz-director"),
    });
    const blockers = stepBlockers("clay-artist", snapshot);
    expect(blockers).toContain("SOURCE_NOT_UPLOADED");
  });

  it("renders every blocker with a bounded human label", () => {
    for (const blocker of [
      "CANDIDATE_MISSING",
      "PREVIOUS_STEP_INCOMPLETE",
      "CANDIDATE_NOT_APPROVED",
      "RIGHTS_NOT_CONFIRMED",
      "PRODUCTION_MISSING",
      "SOURCE_NOT_UPLOADED",
    ] as const) {
      expect(blockerLabel(blocker)).toMatch(/^[A-Z][^.]+\.$/);
    }
  });
});

describe("typed handoff contract", () => {
  it("emits no handoffs before any agent completes", () => {
    const empty = Object.fromEntries(
      orchestrationSteps.map((agentKey) => [agentKey, observation(null)]),
    ) as Record<AgentKey, AgentStepObservation>;
    expect(buildHandoffSequence(makeSnapshot({ observations: empty }))).toEqual(
      [],
    );
  });

  it("emits the five handoffs in demo order when all senders are complete", () => {
    const messages = buildHandoffSequence(
      makeSnapshot({ observations: completeThrough("animator") }),
    );
    expect(messages.map((message) => message.kind)).toEqual([
      "CANDIDATE_BRIEF",
      "ANALYSIS_BRIEF",
      "TREATMENT_BRIEF",
      "STYLED_FRAME_HANDOFF",
      "ANIMATION_HANDOFF",
    ]);
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index]!;
      expect(message.fromAgent).toBe(orchestrationSteps[index]);
      expect(message.toAgent).toBe(orchestrationSteps[index + 1]);
      expect(() => handoffMessageSchema.parse(message)).not.toThrow();
    }
  });

  it("withholds the treatment handoff until a treatment exists", () => {
    const snapshot = makeSnapshot({
      observations: completeThrough("yardtoonz-director"),
      treatment: null,
    });
    const message = buildHandoff("TREATMENT_BRIEF", snapshot);
    expect(message).toBeNull();
  });

  it("withholds artifact handoffs until the producing run records the artifact", () => {
    const snapshot = makeSnapshot({
      observations: {
        ...completeThrough("yardtoonz-director"),
        "clay-artist": observation("COMPLETE", { artifactIds: [] }),
      },
    });
    expect(buildHandoff("STYLED_FRAME_HANDOFF", snapshot)).toBeNull();
  });

  it("carries the produced artifact id and provider attribution in media handoffs", () => {
    const snapshot = makeSnapshot({
      observations: {
        ...completeThrough("yardtoonz-director"),
        "clay-artist": observation("COMPLETE", {
          provider: "MOCK",
          model: "mock-style-v1",
          artifactIds: ["art_styled-42"],
        }),
      },
    });
    const message = buildHandoff("STYLED_FRAME_HANDOFF", snapshot);
    expect(message?.payload.styledFrameArtifactId).toBe("art_styled-42");
    expect(message?.payload.imageProvider).toBe("MOCK");
    expect(message?.payload.model).toBe("mock-style-v1");
  });

  it("quotes only received evidence in the candidate brief", () => {
    const message = buildHandoff(
      "CANDIDATE_BRIEF",
      makeSnapshot({ commentCount: 7, metricsSupplied: false }),
    );
    expect(message?.payload.commentCount).toBe(7);
    expect(message?.payload.metricsSupplied).toBe(false);
  });
});

describe("per-agent input assembly", () => {
  it("assembles the director's inputs from persisted presence flags", () => {
    const inputs = assembleStepInputs(
      "yardtoonz-director",
      makeSnapshot({ commentCount: 9, treatment: null }),
    );
    expect(inputs.commentCount).toBe(9);
    expect(inputs.metricsSupplied).toBe(true);
    expect(inputs.adaptationNoteSupplied).toBe(true);
    expect(inputs.treatmentExists).toBe(false);
  });

  it("assembles provider selections for media agents from the production row", () => {
    const clayInputs = assembleStepInputs("clay-artist", makeSnapshot());
    expect(clayInputs.imageProvider).toBe("MOCK");
    expect(clayInputs.keyframePresent).toBe(true);

    const animatorInputs = assembleStepInputs("animator", makeSnapshot());
    expect(animatorInputs.animationProvider).toBe("MOCK");
  });

  it("reports null providers when no production exists yet", () => {
    const snapshot = makeSnapshot({ production: null });
    const inputs = assembleStepInputs("animator", snapshot);
    expect(inputs.animationProvider).toBeNull();
    expect(
      assembleStepInputs("qa-inspector", snapshot).imageProvider,
    ).toBeNull();
  });
});

describe("timeline driver", () => {
  it("drives ordered rows with progress counters from the plan", () => {
    const plan = planRun(
      makeSnapshot({ observations: completeThrough("yardtoonz-director") }),
    );
    const timeline = buildOrchestrationTimeline(plan);

    expect(timeline.steps).toHaveLength(6);
    expect(timeline.completedCount).toBe(3);
    expect(timeline.totalCount).toBe(6);
    expect(timeline.currentStepKey).toBe("clay-artist");
    expect(timeline.failedStepKey).toBeNull();
    expect(timeline.steps.map((step) => step.agentKey)).toEqual(
      orchestrationSteps,
    );
  });

  it("carries observed decision, attempt, and elapsed fields into the rows", () => {
    const plan = planRun(
      makeSnapshot({ observations: completeThrough("trend-scout") }),
    );
    const trend = buildOrchestrationTimeline(plan).steps[0]!;
    expect(trend.decision).toBe("Did the work.");
    expect(trend.attempt).toBe(1);
    expect(trend.elapsedMs).toBe(12);
    expect(trend.handoffIn).toBeNull();
  });

  it("attaches the typed handoff to the receiving step", () => {
    const plan = planRun(
      makeSnapshot({ observations: completeThrough("humor-analyst") }),
    );
    const timeline = buildOrchestrationTimeline(plan);
    const director = timeline.steps.find(
      (step) => step.agentKey === "yardtoonz-director",
    )!;
    expect(director.handoffIn?.kind).toBe("ANALYSIS_BRIEF");
    expect(director.handoffIn?.fromAgent).toBe("humor-analyst");

    const humor = timeline.steps.find(
      (step) => step.agentKey === "humor-analyst",
    )!;
    expect(humor.handoffIn?.kind).toBe("CANDIDATE_BRIEF");
  });

  it("surfaces the failed step and its error code at the timeline level", () => {
    const plan = planRun(
      makeSnapshot({
        observations: {
          ...completeThrough("yardtoonz-director"),
          "clay-artist": observation("FAILED", { errorCode: "STYLE_FAILED" }),
        },
      }),
    );
    const timeline = buildOrchestrationTimeline(plan);
    expect(timeline.failedStepKey).toBe("clay-artist");
    expect(timeline.errorCode).toBe("STYLE_FAILED");
    expect(timeline.complete).toBe(false);
  });
});
