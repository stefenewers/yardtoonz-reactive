// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CandidateInbox } from "../../src/components/candidate-inbox";
import type { Candidate } from "../../src/domain/candidate";
import { defaultInboxSort } from "../../src/domain/inbox";

function makeCandidate(input: {
  id: string;
  overall: number;
  viralMomentum?: number;
  status?: Candidate["status"];
  metrics?: Candidate["metrics"];
}): Candidate {
  const viralMomentum = input.viralMomentum ?? input.overall;
  return {
    id: input.id,
    platform: "TIKTOK",
    sourceLabel: `Source ${input.id}`,
    caption: `Caption for ${input.id}`,
    publishedAt: "2026-09-02T12:00:00.000Z",
    metrics: input.metrics ?? { views: 1_000, likes: 100 },
    commentExcerpts: [],
    scores: {
      viralMomentum: {
        score: viralMomentum,
        explanation: `viral explanation for ${input.id}`,
        inputsUsed: ["views"],
      },
      humorResponse: {
        score: input.overall,
        explanation: `humor explanation for ${input.id}`,
        inputsUsed: [],
      },
      yardToonzFit: {
        score: input.overall,
        explanation: `fit explanation for ${input.id}`,
        inputsUsed: ["clearPremise"],
      },
      overall: input.overall,
      scoringVersion: "candidate-v1",
    },
    status: input.status ?? "NEW",
  };
}

function renderInbox(
  props: Partial<Parameters<typeof CandidateInbox>[0]> = {},
) {
  const handlers = {
    onSortChange: vi.fn(),
    onRetry: vi.fn(),
    onLoadDemo: vi.fn(),
    onOpenCandidate: vi.fn(),
  };
  render(
    <CandidateInbox
      candidates={[]}
      loading={false}
      sort={defaultInboxSort}
      nowMs={Date.parse("2026-09-03T12:00:00.000Z")}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("CandidateInbox state inventory", () => {
  afterEach(cleanup);

  it("first visit: offers the demo load instead of a dead end", () => {
    const { onLoadDemo } = renderInbox();

    expect(
      screen.getByRole("heading", { name: "Your desk is clear" }),
    ).toBeTruthy();
    const loadButton = screen.getByRole("button", {
      name: "Load demo candidates",
    });
    fireEvent.click(loadButton);
    expect(onLoadDemo).toHaveBeenCalledTimes(1);
  });

  it("loading: shows skeleton table marked busy before any data exists", () => {
    renderInbox({ loading: true });

    const loading = screen.getByLabelText("Loading candidates");
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("columnheader", { name: /Overall/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load demo candidates" })).toBe(
      null,
    );
  });

  it("loaded: renders the ranked table with counts and weighting legend", () => {
    renderInbox({
      candidates: [
        makeCandidate({ id: "top", overall: 92 }),
        makeCandidate({ id: "mid", overall: 80 }),
        makeCandidate({ id: "low", overall: 65 }),
      ],
    });

    const table = screen.getByRole("table");
    expect(table.getAttribute("aria-busy")).toBe("false");
    expect(screen.getByText("3 candidates")).toBeTruthy();
    expect(
      screen.getByText(/sorted by overall score, highest first/),
    ).toBeTruthy();
    expect(
      screen.getAllByText(/Overall = 40% viral momentum \+ 30% humor response/),
    ).not.toHaveLength(0);
    expect(
      screen.getByRole("columnheader", { name: /Viral momentum/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("columnheader", { name: /Yard Toonz fit/ }),
    ).toBeTruthy();

    const ranks = screen.getAllByText(/^#\d+$/);
    expect(ranks.map((element) => element.textContent)).toEqual([
      "#1",
      "#2",
      "#3",
    ]);
  });

  it("loaded: pairs every score with a numeric value and text label", () => {
    renderInbox({
      candidates: [
        makeCandidate({ id: "strong", overall: 91 }),
        makeCandidate({ id: "promising", overall: 75 }),
        makeCandidate({ id: "review", overall: 55 }),
      ],
    });

    for (const caption of [
      "Caption for strong",
      "Caption for promising",
      "Caption for review",
    ]) {
      expect(screen.getByRole("button", { name: caption })).toBeTruthy();
    }
    // Three component cells plus the overall cell per candidate share a band.
    for (const label of ["Strong", "Promising", "Review"]) {
      expect(screen.getAllByText(label).length).toBe(4);
    }
    expect(screen.getAllByText("91").length).toBe(4);
  });

  it("partial metrics: shows Not supplied and exposes explanations beyond color", () => {
    renderInbox({
      candidates: [
        makeCandidate({
          id: "partial",
          overall: 70,
          metrics: { views: 5_000 },
        }),
      ],
    });

    // views supplied; likes, comments, shares, and saves are missing
    const missing = screen.getAllByText("Not supplied");
    expect(missing.length).toBe(4);

    expect(screen.getByTitle("viral explanation for partial")).toBeTruthy();
    expect(
      screen.getByText(/Score explanation: humor explanation for partial/),
    ).toBeTruthy();
  });

  it("status column: labels New, Approved, and Rejected in text", () => {
    renderInbox({
      candidates: [
        makeCandidate({ id: "fresh", overall: 80, status: "NEW" }),
        makeCandidate({ id: "ok", overall: 78, status: "APPROVED" }),
        makeCandidate({ id: "nope", overall: 40, status: "REJECTED" }),
      ],
    });

    expect(screen.getByText("New")).toBeTruthy();
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByText("Rejected")).toBeTruthy();
  });

  it("sorting: announces state with aria-sort and toggles through callbacks", () => {
    const { onSortChange } = renderInbox({
      candidates: [makeCandidate({ id: "solo", overall: 77 })],
    });

    const overallHeader = screen.getByRole("columnheader", {
      name: /Overall/,
    });
    expect(overallHeader.getAttribute("aria-sort")).toBe("descending");

    fireEvent.click(screen.getByRole("button", { name: /^Humor response/ }));
    expect(onSortChange).toHaveBeenCalledWith({
      field: "humorResponse",
      order: "desc",
    });

    fireEvent.click(overallHeader.querySelector("button") as HTMLButtonElement);
    expect(onSortChange).toHaveBeenCalledWith({
      field: "overall",
      order: "asc",
    });
  });

  it("selection: the caption button opens the candidate review", () => {
    const candidate = makeCandidate({ id: "open-me", overall: 88 });
    const { onOpenCandidate } = renderInbox({ candidates: [candidate] });

    fireEvent.click(
      screen.getByRole("button", { name: "Caption for open-me" }),
    );
    expect(onOpenCandidate).toHaveBeenCalledWith(candidate);
  });

  it("error with data: retryable alert while existing rows stay visible", () => {
    const { onRetry } = renderInbox({
      candidates: [makeCandidate({ id: "kept", overall: 66 })],
      error: "Candidates could not be loaded.",
    });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Candidates could not be loaded.");
    expect(
      screen.getByText(/still shows the last successful load/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Caption for kept" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("error without data: retryable alert and no false empty state", () => {
    renderInbox({ error: "The candidate service is unreachable." });

    expect(screen.getByRole("alert").textContent).toContain(
      "The candidate service is unreachable.",
    );
    expect(screen.queryByRole("table")).toBe(null);
    expect(screen.queryByRole("heading", { name: "Your desk is clear" })).toBe(
      null,
    );
  });
});

describe("CandidateInbox demo keyframe thumbnails", () => {
  afterEach(cleanup);

  it("shows the committed keyframe for the pinned demo candidate", () => {
    renderInbox({
      candidates: [makeCandidate({ id: "cand-rain-laundry-003", overall: 90 })],
    });

    const thumb = document.querySelector<HTMLImageElement>(
      ".candidate-row img.thumbnail-frame",
    );
    expect(thumb).not.toBeNull();
    expect(thumb!.getAttribute("src")).toBe(
      "/brand/demo/keyframes/keyframe-1.jpg",
    );
    expect(thumb!.getAttribute("alt")).toBe("");
  });

  it("keeps platform initials for candidates without demo media", () => {
    renderInbox({
      candidates: [makeCandidate({ id: "cand-other-001", overall: 70 })],
    });

    expect(
      document.querySelector(".candidate-row img.thumbnail-frame"),
    ).toBeNull();
    expect(screen.getByText("Ti")).toBeTruthy();
  });
});
