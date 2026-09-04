// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { AgentControlCenter } from "../../src/components/agent-control-center";
import { AgentTraceMonitor } from "../../src/components/agent-trace-monitor";
import {
  deriveAgentCards,
  deriveApprovalHandoff,
  evidenceRows,
  formatConfidence,
  formatElapsedMs,
  humanizeEvidenceKey,
  mediaAgentRoster,
} from "../../src/domain/agent-control-center";
import type { AgentRunView } from "../../src/shared/agents";

const ISO = "2026-09-03T12:00:00.000Z";
let nextRunId = 1;

function makeRun(overrides: Record<string, unknown> = {}): AgentRunView {
  return {
    id: nextRunId++,
    agentKey: "trend-scout",
    state: "COMPLETE",
    attempt: 1,
    artifactIds: [],
    inputEvidence: {
      platform: "tiktok",
      suppliedMetricCount: 3,
      publishedAtSupplied: true,
      scoringVersion: "1.0.0",
    },
    candidateId: "cand-1",
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  } as AgentRunView;
}

const SCOUT_RUN = makeRun({
  agentKey: "trend-scout",
  decision: "Ranked third of ten: steady comment momentum on a fresh sound.",
  inputEvidence: {
    platform: "tiktok",
    suppliedMetricCount: 3,
    publishedAtSupplied: true,
    scoringVersion: "1.0.0",
  },
});

const MEDIA_EVIDENCE = {
  provider: "MOCK",
  fingerprint: "fp-1",
  validationReport: null,
} as const;

const CLAY_RUN = makeRun({
  agentKey: "clay-artist",
  candidateId: undefined,
  productionId: "prod-1",
  provider: "MOCK",
  model: "mock-style-v1",
  elapsedMs: 800,
  inputEvidence: MEDIA_EVIDENCE,
});

const ANIMATOR_RUN = makeRun({
  agentKey: "animator",
  candidateId: undefined,
  productionId: "prod-1",
  provider: "MOCK",
  model: "mock-zoompan-v1",
  elapsedMs: 900,
  inputEvidence: MEDIA_EVIDENCE,
});

const DIRECTOR_RUN = makeRun({
  agentKey: "yardtoonz-director",
  decision: "Rain-soaked laundry becomes a clay dance-off.",
  confidence: 0.87,
  provider: "MOCK",
  model: "mock-director-1",
  elapsedMs: 1420,
  inputEvidence: {
    provider: "MOCK",
    metricCount: 4,
    commentCount: 2,
    adaptationNoteSupplied: true,
    transcriptSupplied: false,
    sourceVideoMetadataSupplied: true,
    keyframeCount: 3,
    creativeDirectionSupplied: false,
  },
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined) => Promise<Response>,
) {
  const fetchMock = vi.fn(handler);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  nextRunId = 1;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("deriveAgentCards", () => {
  it("renders the full six-agent roster in demo-story order", () => {
    const cards = deriveAgentCards({ runs: [DIRECTOR_RUN] });
    expect(cards.map((card) => card.label)).toEqual([
      "Trend Scout",
      "Humor Analyst",
      "YardToonz Director",
      "Clay Artist",
      "Animator",
      "QA Inspector",
    ]);
  });

  it("renders the media subset for a production surface", () => {
    const cards = deriveAgentCards({
      runs: [],
      agents: mediaAgentRoster,
    });
    expect(cards.map((card) => card.agentKey)).toEqual([
      "clay-artist",
      "animator",
      "qa-inspector",
    ]);
  });

  it("derives WAITING for an agent with no run", () => {
    const cards = deriveAgentCards({ runs: [SCOUT_RUN] });
    const analyst = cards.find((card) => card.agentKey === "humor-analyst");
    expect(analyst?.state).toBe("WAITING");
    expect(analyst?.runCount).toBe(0);
    expect(analyst?.latestRun).toBeUndefined();
  });

  it("derives RUNNING from the production's active stage, not a persisted row", () => {
    const cards = deriveAgentCards({
      runs: [],
      productionStatus: "STYLING",
      activeStage: "STYLE_IMAGE",
      agents: mediaAgentRoster,
    });
    expect(cards.find((card) => card.agentKey === "clay-artist")?.state).toBe(
      "RUNNING",
    );
    expect(cards.find((card) => card.agentKey === "animator")?.state).toBe(
      "WAITING",
    );
  });

  it("keeps FAILED visible from the persisted run", () => {
    const cards = deriveAgentCards({
      runs: [
        makeRun({
          agentKey: "animator",
          state: "FAILED",
          attempt: 1,
          decision: "The animation provider rejected the request.",
          provider: "RUNWAY",
          inputEvidence: { errorCode: "RUNWAY_SUBMISSION_FAILED" },
        }),
      ],
      agents: mediaAgentRoster,
    });
    const animator = cards.find((card) => card.agentKey === "animator");
    expect(animator?.state).toBe("FAILED");
    expect(animator?.latestRun?.decision).toBe(
      "The animation provider rejected the request.",
    );
  });

  it("shows the retry's complete run as latest with both runs counted", () => {
    const cards = deriveAgentCards({
      runs: [
        makeRun({
          agentKey: "clay-artist",
          state: "FAILED",
          attempt: 1,
          decision: "The style provider timed out.",
        }),
        makeRun({
          agentKey: "clay-artist",
          state: "COMPLETE",
          attempt: 2,
          decision: "Styled the keyframe with the Mock image provider.",
          provider: "MOCK",
        }),
      ],
      agents: mediaAgentRoster,
    });
    const clay = cards.find((card) => card.agentKey === "clay-artist");
    expect(clay?.state).toBe("COMPLETE");
    expect(clay?.runCount).toBe(2);
    expect(clay?.latestRun?.attempt).toBe(2);
    expect(clay?.latestRun?.decision).toBe(
      "Styled the keyframe with the Mock image provider.",
    );
  });

  it("reports RUNNING again while a retry re-runs the failed agent's stage", () => {
    const cards = deriveAgentCards({
      runs: [
        makeRun({
          agentKey: "clay-artist",
          state: "FAILED",
          attempt: 1,
        }),
      ],
      productionStatus: "STYLING",
      activeStage: "STYLE_IMAGE",
      agents: mediaAgentRoster,
    });
    expect(cards.find((card) => card.agentKey === "clay-artist")?.state).toBe(
      "RUNNING",
    );
  });
});

describe("deriveApprovalHandoff", () => {
  it("stays idle before the Director has produced anything", () => {
    expect(deriveApprovalHandoff({ runs: [] })).toBe("IDLE");
  });

  it("hands off to AWAITING_APPROVAL once the Director completes", () => {
    expect(deriveApprovalHandoff({ runs: [SCOUT_RUN, DIRECTOR_RUN] })).toBe(
      "AWAITING_APPROVAL",
    );
  });

  it("keeps AWAITING_APPROVAL for a drafted or rights-confirmed production", () => {
    expect(deriveApprovalHandoff({ runs: [], productionStatus: "DRAFT" })).toBe(
      "AWAITING_APPROVAL",
    );
    expect(
      deriveApprovalHandoff({
        runs: [],
        productionStatus: "RIGHTS_CONFIRMED",
      }),
    ).toBe("AWAITING_APPROVAL");
  });

  it("shows APPROVED once media generation is queued or running", () => {
    expect(
      deriveApprovalHandoff({ runs: [], productionStatus: "QUEUED" }),
    ).toBe("APPROVED");
    expect(
      deriveApprovalHandoff({ runs: [], productionStatus: "STYLING" }),
    ).toBe("APPROVED");
    expect(
      deriveApprovalHandoff({ runs: [], productionStatus: "FAILED" }),
    ).toBe("APPROVED");
  });

  it("shows COMPLETE for a validated production", () => {
    expect(
      deriveApprovalHandoff({ runs: [], productionStatus: "COMPLETE" }),
    ).toBe("COMPLETE");
  });
});

describe("formatting helpers", () => {
  it("formats confidence as a whole percent", () => {
    expect(formatConfidence(0.87)).toBe("87%");
    expect(formatConfidence(1)).toBe("100%");
    expect(formatConfidence(0)).toBe("0%");
  });

  it("formats elapsed time honest to the recorded unit", () => {
    expect(formatElapsedMs(850)).toBe("850ms");
    expect(formatElapsedMs(1420)).toBe("1.4s");
    expect(formatElapsedMs(125_000)).toBe("2m 5s");
  });

  it("humanizes evidence keys and bounded scalars", () => {
    expect(humanizeEvidenceKey("suppliedMetricCount")).toBe(
      "Supplied Metric Count",
    );
    const rows = evidenceRows({
      publishedAtSupplied: true,
      transcriptSupplied: false,
      metricCount: 4,
      providerRequestId: null,
    });
    expect(rows).toEqual([
      { label: "Published At Supplied", value: "yes" },
      { label: "Transcript Supplied", value: "no" },
      { label: "Metric Count", value: "4" },
      { label: "Provider Request Id", value: "—" },
    ]);
  });
});

describe("AgentControlCenter", () => {
  it("renders an empty trace as six waiting cards with an honest empty note", () => {
    render(
      <AgentControlCenter
        cards={deriveAgentCards({ runs: [] })}
        handoff="IDLE"
      />,
    );

    expect(screen.getByText(/No agent runs are recorded/)).toBeTruthy();
    for (const label of [
      "Trend Scout: Waiting",
      "Humor Analyst: Waiting",
      "YardToonz Director: Waiting",
      "Clay Artist: Waiting",
      "Animator: Waiting",
      "QA Inspector: Waiting",
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.queryByText(/Awaiting approval/)).toBeNull();
  });

  it("renders complete runs with decision, confidence, provider, model, elapsed, and evidence", () => {
    render(
      <AgentControlCenter
        cards={deriveAgentCards({ runs: [SCOUT_RUN, DIRECTOR_RUN] })}
        handoff="AWAITING_APPROVAL"
      />,
    );

    expect(screen.getByLabelText("YardToonz Director: Complete")).toBeTruthy();
    expect(
      screen.getByText("Rain-soaked laundry becomes a clay dance-off."),
    ).toBeTruthy();
    expect(screen.getByText("87%")).toBeTruthy();
    expect(screen.getByText("Mock")).toBeTruthy();
    expect(screen.getByText("mock-director-1")).toBeTruthy();
    expect(screen.getByText("1.4s")).toBeTruthy();
    expect(screen.getByText("Adaptation Note Supplied")).toBeTruthy();
    expect(screen.getAllByText("no").length).toBeGreaterThan(0);
  });

  it("never invents missing attribution values", () => {
    const bare = makeRun({ agentKey: "trend-scout", decision: undefined });
    render(
      <AgentControlCenter
        cards={deriveAgentCards({ runs: [bare] })}
        handoff="IDLE"
      />,
    );

    expect(screen.getByText("Not reported")).toBeTruthy();
    expect(screen.getByText("None (deterministic)")).toBeTruthy();
    expect(screen.getByText("Not disclosed")).toBeTruthy();
    expect(screen.getByText("Not measured")).toBeTruthy();
  });

  it("shows the AWAITING_APPROVAL handoff as text, not color", () => {
    render(
      <AgentControlCenter
        cards={deriveAgentCards({ runs: [DIRECTOR_RUN] })}
        handoff="AWAITING_APPROVAL"
      />,
    );

    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("Awaiting approval");
    expect(banner.textContent).toContain("Media generation is gated");
  });

  it("shows a failed run with its safe error decision", () => {
    render(
      <AgentControlCenter
        cards={deriveAgentCards({
          runs: [
            makeRun({
              agentKey: "clay-artist",
              state: "FAILED",
              decision: "The style provider timed out.",
              inputEvidence: { errorCode: "STYLE_TIMEOUT" },
            }),
          ],
          agents: mediaAgentRoster,
        })}
        handoff="APPROVED"
      />,
    );

    expect(screen.getByLabelText("Clay Artist: Failed")).toBeTruthy();
    expect(screen.getByText("The style provider timed out.")).toBeTruthy();
    expect(screen.getByText("Error Code")).toBeTruthy();
    expect(screen.getByText("STYLE_TIMEOUT")).toBeTruthy();
  });

  it("renders a running card with its in-progress note", () => {
    render(
      <AgentControlCenter
        cards={deriveAgentCards({
          runs: [],
          productionStatus: "STYLING",
          activeStage: "STYLE_IMAGE",
          agents: mediaAgentRoster,
        })}
        handoff="APPROVED"
      />,
    );

    expect(screen.getByLabelText("Clay Artist: Running")).toBeTruthy();
    expect(
      screen.getByText(/this card fills in when the run persists/),
    ).toBeTruthy();
  });

  it("links artifacts through the safe href resolver", () => {
    render(
      <AgentControlCenter
        cards={deriveAgentCards({
          runs: [
            makeRun({
              agentKey: "clay-artist",
              artifactIds: ["art-styled-9"],
            }),
          ],
          agents: mediaAgentRoster,
        })}
        handoff="APPROVED"
        artifactHref={(artifactId) =>
          `/api/productions/prod-1/artifacts/${artifactId}`
        }
      />,
    );

    const link = screen.getByRole("link", { name: "Open artifact" });
    expect(link.getAttribute("href")).toBe(
      "/api/productions/prod-1/artifacts/art-styled-9",
    );
  });
});

describe("AgentTraceMonitor", () => {
  it("polls the trace API every 3s and never erases the persisted history", async () => {
    vi.useFakeTimers();
    try {
      let call = 0;
      const fetchMock = installFetch(async () => {
        call += 1;
        return jsonResponse(
          200,
          call === 1
            ? { runs: [SCOUT_RUN] }
            : { runs: [SCOUT_RUN, DIRECTOR_RUN] },
        );
      });

      render(<AgentTraceMonitor candidateId="cand-1" />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // First load: the scout's decision is on the record.
      expect(
        screen.getByText(
          "Ranked third of ten: steady comment momentum on a fresh sound.",
        ),
      ).toBeTruthy();

      // Two poll cycles later the Director's run arrives — and the scout's
      // history is still on the page, not blanked by the refresh.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000 * 2 + 100);
      });
      expect(
        screen.getByText(
          "Ranked third of ten: steady comment momentum on a fresh sound.",
        ),
      ).toBeTruthy();
      expect(
        screen.getByText("Rain-soaked laundry becomes a clay dance-off."),
      ).toBeTruthy();
      expect(fetchMock.mock.calls.length).toBe(3);
      expect(String(fetchMock.mock.calls[0][0])).toBe(
        "/api/agent-trace?candidateId=cand-1",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders the media roster for a production subject with derived running state", async () => {
    installFetch(async () => jsonResponse(200, { runs: [] }));
    render(
      <AgentTraceMonitor
        productionId="prod-1"
        productionStatus="ANIMATING"
        activeStage="ANIMATE_IMAGE"
      />,
    );

    await screen.findByLabelText("Animator: Running");
    expect(screen.getByLabelText("Clay Artist: Waiting")).toBeTruthy();
    expect(screen.getByLabelText("QA Inspector: Waiting")).toBeTruthy();
    expect(screen.queryByLabelText("Trend Scout: Waiting")).toBeNull();
  });

  it("fetches once more when the job turns terminal so the cards land complete", async () => {
    vi.useFakeTimers();
    try {
      let call = 0;
      const fetchMock = installFetch(async () => {
        call += 1;
        return jsonResponse(
          200,
          call === 1
            ? { runs: [CLAY_RUN] }
            : { runs: [CLAY_RUN, ANIMATOR_RUN] },
        );
      });

      const view = render(
        <AgentTraceMonitor
          productionId="prod-1"
          productionStatus="ANIMATING"
          activeStage="ANIMATE_IMAGE"
        />,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByLabelText("Animator: Running")).toBeTruthy();

      // The status flips to COMPLETE: the monitor re-arms and fetches the
      // terminal truth once, instead of freezing on the last mid-run poll.
      await act(async () => {
        view.rerender(
          <AgentTraceMonitor
            productionId="prod-1"
            productionStatus="COMPLETE"
          />,
        );
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByLabelText("Clay Artist: Complete")).toBeTruthy();
      expect(screen.getByLabelText("Animator: Complete")).toBeTruthy();

      // And then it rests: no further polls once the job is terminal.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000 * 2 + 100);
      });
      expect(fetchMock.mock.calls.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces load failures and recovers through Try again", async () => {
    const fetchMock = installFetch(async () => {
      throw new TypeError("network down");
    });

    render(<AgentTraceMonitor candidateId="cand-1" />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The agent trace could not be loaded");

    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { runs: [SCOUT_RUN] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Trend Scout: Complete")).toBeTruthy(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
