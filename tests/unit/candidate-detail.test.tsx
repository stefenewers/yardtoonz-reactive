// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CandidateDetail } from "../../src/components/candidate-detail";
import {
  formatDecisionTimestamp,
  type Candidate,
} from "../../src/domain/candidate";

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "cand-detail-001",
    platform: "TIKTOK",
    sourceLabel: "Kingston street interview",
    caption: "A confident answer falls apart under one follow-up question.",
    publishedAt: "2026-09-02T12:00:00.000Z",
    metrics: { views: 94_000, likes: 8_100, comments: 950 },
    commentExcerpts: ["Mi cyaan 😂", "The timing weak me"],
    adaptationNote:
      "Hold on the queue's synchronized side-eye before the payoff.",
    scores: {
      viralMomentum: {
        score: 88,
        explanation: "Fast share velocity for a recently observed clip.",
        inputsUsed: ["views", "likes"],
      },
      humorResponse: {
        score: 84,
        explanation: "Supplied comments repeat laughter language.",
        inputsUsed: ["2 comment excerpts"],
      },
      yardToonzFit: {
        score: 91,
        explanation: "One clear reaction reads in a single short shot.",
        inputsUsed: ["clear premise", "short payoff"],
      },
      overall: 88,
      scoringVersion: "candidate-v1",
    },
    status: "NEW",
    ...overrides,
  };
}

function renderDetail(
  candidate: Candidate,
  props: Partial<Parameters<typeof CandidateDetail>[0]> = {},
) {
  const handlers = {
    onBack: vi.fn(),
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onRestore: vi.fn(),
    onContinue: vi.fn(),
  };
  render(
    <CandidateDetail
      candidate={candidate}
      busy={false}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("CandidateDetail decision flows", () => {
  afterEach(cleanup);

  it("new candidate: shows the full evidence record with approve and reject actions", () => {
    renderDetail(makeCandidate());

    expect(
      screen.getByRole("heading", {
        name: "A confident answer falls apart under one follow-up question.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Hold on the queue's synchronized side-eye before the payoff.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("“Mi cyaan 😂”")).toBeTruthy();
    expect(screen.getByText("94,000")).toBeTruthy();
    expect(
      screen.getByText("Fast share velocity for a recently observed clip."),
    ).toBeTruthy();

    expect(
      screen.getByRole("button", { name: "Approve for production" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Reject candidate" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restore to inbox" })).toBe(
      null,
    );
    expect(screen.queryByText(/Decision recorded/)).toBe(null);
  });

  it("new candidate: rejecting without a reason records an unexplained rejection", () => {
    const { onReject } = renderDetail(makeCandidate());

    fireEvent.click(screen.getByRole("button", { name: "Reject candidate" }));
    expect(
      screen.getByRole("button", { name: "Record rejection" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Record rejection" }));

    expect(onReject).toHaveBeenCalledWith(undefined);
  });

  it("new candidate: a typed reason travels with the rejection", () => {
    const { onReject } = renderDetail(makeCandidate());

    fireEvent.click(screen.getByRole("button", { name: "Reject candidate" }));
    fireEvent.change(screen.getByLabelText("Reason (optional)"), {
      target: { value: "  Audio rights are unresolved  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record rejection" }));

    expect(onReject).toHaveBeenCalledWith("Audio rights are unresolved");
  });

  it("new candidate: keep as new cancels the rejection without a decision", () => {
    const { onReject } = renderDetail(makeCandidate());

    fireEvent.click(screen.getByRole("button", { name: "Reject candidate" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep as new" }));

    expect(onReject).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Record rejection" })).toBe(
      null,
    );
    expect(
      screen.getByRole("button", { name: "Reject candidate" }),
    ).toBeTruthy();
  });

  it("rejected candidate: muted state with reason, timestamp, and restore", () => {
    const { onRestore } = renderDetail(
      makeCandidate({
        status: "REJECTED",
        decisionReason: "Audio rights are unresolved",
        decidedAt: "2026-09-03T18:29:09.000Z",
      }),
    );

    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("Rejected");
    expect(banner.textContent).toContain("Reason: Audio rights are unresolved");
    expect(banner.textContent).toContain(
      formatDecisionTimestamp("2026-09-03T18:29:09.000Z"),
    );

    expect(
      screen.getByRole("button", { name: "Restore to inbox" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Approve for production" }),
    ).toBe(null);
    expect(screen.queryByRole("button", { name: "Reject candidate" })).toBe(
      null,
    );

    fireEvent.click(screen.getByRole("button", { name: "Restore to inbox" }));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("approved candidate: confirmation with timestamp and continue action", () => {
    const { onContinue } = renderDetail(
      makeCandidate({
        status: "APPROVED",
        decidedAt: "2026-09-03T18:29:09.000Z",
      }),
    );

    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("Approved for production");
    expect(banner.textContent).toContain(
      formatDecisionTimestamp("2026-09-03T18:29:09.000Z"),
    );

    expect(
      screen.getByRole("button", { name: "Continue to production" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Approve for production" }),
    ).toBe(null);
    expect(screen.queryByRole("button", { name: "Reject candidate" })).toBe(
      null,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Continue to production" }),
    );
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("busy: in-flight decisions state what is happening and block double submits", () => {
    renderDetail(makeCandidate(), { busy: true });

    const approve = screen.getByRole("button", {
      name: "Approving…",
    }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Reject candidate",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("busy restore: the primary action explains the wait", () => {
    renderDetail(
      makeCandidate({
        status: "REJECTED",
        decidedAt: "2026-09-03T18:29:09.000Z",
      }),
      { busy: true },
    );

    const restore = screen.getByRole("button", {
      name: "Restoring…",
    }) as HTMLButtonElement;
    expect(restore.disabled).toBe(true);
  });
});
