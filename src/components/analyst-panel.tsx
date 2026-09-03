"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { HumorAnalysisResource } from "@/domain/humor-analysis";

import {
  createApiHumorAnalysisClient,
  HumorAnalysisApiError,
} from "@/lib/humor-analysis-client";

/**
 * The analyst panel: the candidate's comment corpus read through the
 * deterministic laughter analysis. Read-mostly — if no analysis exists
 * yet, one click runs the analyst and persists the evidence.
 */

type PanelState =
  | { phase: "loading" }
  | { phase: "loaded"; analysis: HumorAnalysisResource }
  | { phase: "missing" }
  | { phase: "analyzing" }
  | { phase: "error"; code: string; message: string };

/** Pure load-failure classifier shared by the mount effect and retry. */
function classifyLoadError(error: unknown): PanelState {
  if (error instanceof HumorAnalysisApiError) {
    return error.code === "HUMOR_ANALYSIS_NOT_FOUND"
      ? { phase: "missing" }
      : { phase: "error", code: error.code, message: error.message };
  }
  return {
    phase: "error",
    code: "UNKNOWN",
    message: "The humor analysis could not be loaded.",
  };
}

const sentimentLabels: Record<string, string> = {
  POSITIVE: "positive",
  NEUTRAL: "neutral",
  NEGATIVE: "negative",
};

function formatSentimentCounts(counts: {
  POSITIVE: number;
  NEUTRAL: number;
  NEGATIVE: number;
}): string {
  return `${counts.POSITIVE} positive, ${counts.NEUTRAL} neutral, ${counts.NEGATIVE} negative`;
}

export function AnalystPanel({ candidateId }: { candidateId: string }) {
  const client = useMemo(() => createApiHumorAnalysisClient(), []);
  const [state, setState] = useState<PanelState>({ phase: "loading" });

  /** Retry path: an explicit user action may set state synchronously. */
  const fetchAnalysis = useCallback(async () => {
    try {
      const analysis = await client.getForCandidate(candidateId);
      setState({ phase: "loaded", analysis });
    } catch (error) {
      setState(classifyLoadError(error));
    }
  }, [client, candidateId]);

  // Mount read mirrors the repo effect pattern: the async body only
  // touches state after its first await, guarded by an active flag.
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const analysis = await client.getForCandidate(candidateId);
        if (!active) return;
        setState({ phase: "loaded", analysis });
      } catch (error) {
        if (!active) return;
        setState(classifyLoadError(error));
      }
    }
    void refresh();
    return () => {
      active = false;
    };
  }, [client, candidateId]);

  const runAnalysis = useCallback(async () => {
    setState({ phase: "analyzing" });
    try {
      const analysis = await client.createForCandidate(candidateId);
      setState({ phase: "loaded", analysis });
    } catch (error) {
      setState(classifyLoadError(error));
    }
  }, [client, candidateId]);

  if (state.phase === "loading" || state.phase === "analyzing") {
    return (
      <div className="analyst-panel" aria-live="polite">
        <h2>Humor analyst</h2>
        <p className="analyst-panel__status">
          {state.phase === "loading"
            ? "Reading the laughter evidence…"
            : "Running the laughter analysis…"}
        </p>
      </div>
    );
  }

  if (state.phase === "missing") {
    return (
      <div className="analyst-panel" aria-live="polite">
        <h2>Humor analyst</h2>
        <p className="analyst-panel__status">
          No laughter analysis has been run for this candidate yet.
        </p>
        <button className="primary-button" type="button" onClick={runAnalysis}>
          Run the humor analysis
        </button>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="analyst-panel" aria-live="polite">
        <h2>Humor analyst</h2>
        <p className="analyst-panel__status analyst-panel__status--error">
          {state.message}
        </p>
        <button
          className="primary-button"
          type="button"
          onClick={fetchAnalysis}
        >
          Try loading again
        </button>
      </div>
    );
  }

  const { analysis } = state;
  const { summary } = analysis.analysis;

  return (
    <div className="analyst-panel" aria-live="polite">
      <div className="analyst-panel__heading">
        <h2>Humor analyst</h2>
        <span className="analyst-panel__source">{analysis.corpusSource}</span>
      </div>
      <p className="analyst-panel__explanation">{summary.summaryExplanation}</p>
      <dl className="analyst-panel__metrics">
        <div>
          <dt>Corpus</dt>
          <dd>
            {analysis.analysis.corpusSize} comments
            {summary.laughterCommentCount > 0
              ? ` · ${summary.laughterCommentCount} with laughter markers`
              : ""}
          </dd>
        </div>
        <div>
          <dt>Coverage</dt>
          <dd>
            {Math.round(summary.laughterCoverage * 100)}% of comments carried
            laughter
          </dd>
        </div>
        <div>
          <dt>Sentiment</dt>
          <dd>
            {sentimentLabels[summary.dominantSentiment]} —{" "}
            {formatSentimentCounts(summary.sentimentCounts)}
          </dd>
        </div>
        <div>
          <dt>Top markers</dt>
          <dd>
            {summary.topMarkers.length > 0
              ? summary.topMarkers
                  .map((marker) => `${marker.label} ×${marker.count}`)
                  .join(", ")
              : "No configured markers appeared"}
          </dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{Math.round(analysis.analysis.confidence * 100)}%</dd>
        </div>
      </dl>
      {analysis.analysis.evidenceGaps.length > 0 && (
        <div className="analyst-panel__gaps">
          <h3>Evidence gaps</h3>
          <ul>
            {analysis.analysis.evidenceGaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      )}
      <button className="secondary-button" type="button" onClick={runAnalysis}>
        Refresh analysis
      </button>
      <p className="analyst-panel__note">
        Evidence read only — these numbers never change the candidate scores.
      </p>
    </div>
  );
}
