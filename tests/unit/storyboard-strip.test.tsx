// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { StoryboardStrip } from "../../src/components/storyboard-strip";
import { buildMockDirectorTreatment } from "../../src/domain/director";
import {
  buildCueSheet,
  buildStoryboardPlan,
  type StoryboardResource,
} from "../../src/domain/storyboard";

// A real Director treatment — the storyboard only consumes the merged
// contract, so the fixture builds one through the deterministic mock.
const treatment = buildMockDirectorTreatment({
  candidateId: "cand_strip",
  caption: "Di wuk gone up — Yard Toonz seh di yard a blaze tonight",
  metrics: {},
  commentExcerpts: ["Mi belly a quota every time him side-eye"],
});

function makeStoryboard(candidateId = "cand_strip"): StoryboardResource {
  const plan = buildStoryboardPlan(treatment, candidateId);
  const cueOutcome = buildCueSheet(plan);
  if (!cueOutcome.ok) throw new Error("Fixture plan must cue cleanly");
  return {
    id: `sb_${candidateId}`,
    candidateId,
    provider: "MOCK",
    treatmentId: `treat_${candidateId}`,
    createdAt: "2026-09-03T12:00:00.000Z",
    plan,
    cueSheet: cueOutcome.cueSheet,
  };
}

type FetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Response | Promise<Response>;

function okJson(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function errorJson(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mountWithFetch(handler: FetchHandler) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(input, init),
  ) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetchMock);
  return render(<StoryboardStrip candidateId="cand_strip" />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StoryboardStrip", () => {
  it("renders the loaded cue strip with timing, moves, and prompts", async () => {
    const storyboard = makeStoryboard();
    mountWithFetch(() => okJson({ storyboard }));

    await waitFor(() =>
      expect(screen.getByLabelText("Storyboard strip")).toBeDefined(),
    );

    const cueCount = storyboard.cueSheet.cues.length;
    expect(cueCount).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(`${cueCount} cues`)).toBeDefined();
    expect(screen.getByText(/total · 5–8s window/)).toBeDefined();
    expect(screen.getByText("Beats: Establish → Setup → Payoff")).toBeDefined();

    expect(screen.getAllByText(/Frame \d/)).toHaveLength(cueCount);
    expect(screen.getByText("Establish")).toBeDefined();
    expect(screen.getByText("Setup")).toBeDefined();
    expect(screen.getByText("Payoff")).toBeDefined();

    for (const frame of storyboard.plan.frames) {
      expect(screen.getByText(frame.prompt)).toBeDefined();
    }
    expect(screen.getAllByText(/s → /)).toHaveLength(cueCount);
  });

  it("renders every camera move from the plan", async () => {
    const storyboard = makeStoryboard();
    mountWithFetch(() => okJson({ storyboard }));

    await waitFor(() =>
      expect(screen.getByLabelText("Storyboard strip")).toBeDefined(),
    );
    const moves = storyboard.plan.frames.map((frame) =>
      frame.cameraMove.replace(/_/g, " ").toLowerCase(),
    );
    for (const move of moves) {
      expect(screen.getByText(move)).toBeDefined();
    }
  });

  it("shows the empty state and builds the storyboard on demand", async () => {
    const storyboard = makeStoryboard();
    mountWithFetch((input, init) => {
      if (init?.method === "POST") {
        return okJson({ storyboard });
      }
      return errorJson(404, "STORYBOARD_NOT_FOUND", "No storyboard yet.");
    });

    const build = await screen.findByRole("button", {
      name: "Build the storyboard",
    });
    expect(screen.getByText("No storyboard yet")).toBeDefined();
    fireEvent.click(build);

    await waitFor(() =>
      expect(screen.getByLabelText("Storyboard strip")).toBeDefined(),
    );
  });

  it("explains the missing-treatment dependency instead of erroring", async () => {
    mountWithFetch((input, init) => {
      if (init?.method === "POST") {
        return errorJson(
          409,
          "TREATMENT_NOT_FOUND",
          "No director treatment exists for this candidate yet.",
        );
      }
      return errorJson(404, "STORYBOARD_NOT_FOUND", "No storyboard yet.");
    });

    const build = await screen.findByRole("button", {
      name: "Build the storyboard",
    });
    fireEvent.click(build);

    expect(await screen.findByText("Treatment required")).toBeDefined();
    expect(
      screen.getByText(/Ask the Director for a treatment first/),
    ).toBeDefined();
  });

  it("offers a retry after a failed load", async () => {
    let failing = true;
    mountWithFetch(() => {
      if (failing) {
        return errorJson(500, "STORYBOARD_REQUEST_FAILED", "Boom.");
      }
      return okJson({ storyboard: makeStoryboard() });
    });

    await screen.findByText("We hit a snag");
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Storyboard strip")).toBeDefined(),
    );
  });

  it("keeps the service-unavailable copy for network failures", async () => {
    mountWithFetch(() => {
      throw new TypeError("fetch failed");
    });

    expect(
      await screen.findByText(/storyboard service could not be reached/i),
    ).toBeDefined();
  });
});
