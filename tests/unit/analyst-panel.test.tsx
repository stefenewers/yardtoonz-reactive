// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { AnalystPanel } from "../../src/components/analyst-panel";
import {
  analyzeCommentCorpus,
  commentCorpusAnalysisSchema,
} from "../../src/domain/humor-analysis";
import type { HumorAnalysisResource } from "../../src/domain/humor-analysis";
import { commentCorpusForCandidate } from "../../fixtures/comment-corpora";

// A real corpus run keeps the fixture honest: the panel must render the
// same evidence the service would persist for a candidate.
const candidateId = "cand_bus-stop-001";

function makeAnalysis(): HumorAnalysisResource {
  const corpus = commentCorpusForCandidate(candidateId);
  return {
    id: `ha_${candidateId}`,
    candidateId,
    corpusSource: "DEMO_CORPUS",
    createdAt: "2026-09-03T12:00:00.000Z",
    analysis: commentCorpusAnalysisSchema.parse(analyzeCommentCorpus(corpus)),
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
  return render(<AnalystPanel candidateId={candidateId} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AnalystPanel", () => {
  it("renders the loaded analysis with plain-language evidence", async () => {
    const analysis = makeAnalysis();
    mountWithFetch(() => okJson({ analysis }));
    // The "Humor analyst" heading renders during the loading state too, so
    // waiting on it raced the fetch behind the assertions (CI failure on
    // PR #40). Wait for loaded-state content instead.
    await screen.findByText(/of 10 comments carried laughter markers/);
    expect(
      screen.getByText(analysis.analysis.summary.summaryExplanation),
    ).toBeDefined();
    expect(screen.getByText("DEMO_CORPUS")).toBeDefined();
    expect(screen.getByText(/with laughter markers/)).toBeDefined();
    expect(screen.getByText("Refresh analysis")).toBeDefined();
    expect(
      screen.getByText(
        /Evidence read only — these numbers never change the candidate scores/,
      ),
    ).toBeDefined();
  });

  it("keeps evidence metrics honest for an empty corpus", async () => {
    const analysis: HumorAnalysisResource = {
      id: `ha_${candidateId}`,
      candidateId,
      corpusSource: "PERSISTED_EXCERPTS",
      createdAt: "2026-09-03T12:00:00.000Z",
      analysis: commentCorpusAnalysisSchema.parse(analyzeCommentCorpus([])),
    };
    mountWithFetch(() => okJson({ analysis }));

    // The "Humor analyst" heading renders during the loading state too, so
    // waiting on it raced the fetch behind the assertions (CI failure on
    // PR #40). Wait for loaded-state content instead.
    await screen.findByText("Evidence gaps");
    expect(
      screen.getByText(
        "No comment excerpts were supplied, so there is no corpus to analyze.",
      ),
    ).toBeDefined();
    expect(screen.getByText("No configured markers appeared")).toBeDefined();
  });

  it("shows the never-analyzed state and runs the analysis on demand", async () => {
    const analysis = makeAnalysis();
    mountWithFetch((input, init) => {
      if (init?.method === "POST") {
        return okJson({ analysis });
      }
      return errorJson(
        404,
        "HUMOR_ANALYSIS_NOT_FOUND",
        "No humor analysis exists for this candidate yet.",
      );
    });

    const run = await screen.findByRole("button", {
      name: "Run the humor analysis",
    });
    expect(screen.getByText(/No laughter analysis has been run/)).toBeDefined();
    fireEvent.click(run);

    await waitFor(() =>
      expect(
        screen.getByText(/of 10 comments carried laughter markers/),
      ).toBeDefined(),
    );
  });

  it("explains a server rejection instead of failing silently", async () => {
    mountWithFetch((input, init) => {
      if (init?.method === "POST") {
        return errorJson(404, "CANDIDATE_NOT_FOUND", "Candidate not found.");
      }
      return errorJson(
        404,
        "HUMOR_ANALYSIS_NOT_FOUND",
        "No humor analysis exists for this candidate yet.",
      );
    });

    const run = await screen.findByRole("button", {
      name: "Run the humor analysis",
    });
    fireEvent.click(run);

    await waitFor(() =>
      expect(screen.getByText("Candidate not found.")).toBeDefined(),
    );
    expect(screen.getByText("Try loading again")).toBeDefined();
  });

  it("surfaces transport failures with a retry path", async () => {
    mountWithFetch(() => {
      throw new TypeError("network down");
    });

    await waitFor(() =>
      expect(
        screen.getByText(
          "The humor analysis service could not be reached. Try again.",
        ),
      ).toBeDefined(),
    );
    expect(screen.getByText("Try loading again")).toBeDefined();
  });
});
