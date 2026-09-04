"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { StoryboardBeat } from "@/domain/storyboard";

import { describeMotionParams, parseMotionParams } from "@/domain/motion";
import {
  createApiStoryboardClient,
  StoryboardApiError,
} from "@/lib/storyboard-client";
import type { StoryboardResource } from "@/domain/storyboard";
import { BrandMark } from "@/components/brand-mark";

/**
 * The storyboard strip: the candidate's keyframe plan rendered as an
 * ordered cue strip. Read-mostly — if no storyboard exists yet, one
 * click builds it from the candidate's persisted Director treatment.
 */

type StripState =
  | { phase: "loading" }
  | { phase: "loaded"; storyboard: StoryboardResource }
  | { phase: "missing" }
  | { phase: "creating" }
  | { phase: "blocked"; message: string }
  | { phase: "error"; code: string; message: string };

const beatLabels: Record<StoryboardBeat, string> = {
  ESTABLISH: "Establish",
  SETUP: "Setup",
  PAYOFF: "Payoff",
};

function formatSeconds(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}s`;
}

/** Pure load-failure classifier shared by the mount effect and retry. */
function classifyLoadError(error: unknown): StripState {
  if (error instanceof StoryboardApiError) {
    return error.code === "STORYBOARD_NOT_FOUND"
      ? { phase: "missing" }
      : { phase: "error", code: error.code, message: error.message };
  }
  return {
    phase: "error",
    code: "UNKNOWN",
    message: "The storyboard could not be loaded.",
  };
}

const storyboardBackHref = "/";

export function StoryboardStrip({ candidateId }: { candidateId: string }) {
  const client = useMemo(() => createApiStoryboardClient(), []);
  const [state, setState] = useState<StripState>({ phase: "loading" });

  /** Retry path: an explicit user action may set state synchronously. */
  const fetchStoryboard = useCallback(async () => {
    try {
      const storyboard = await client.getForCandidate(candidateId);
      setState({ phase: "loaded", storyboard });
    } catch (error) {
      setState(classifyLoadError(error));
    }
  }, [client, candidateId]);

  const load = useCallback(() => {
    setState({ phase: "loading" });
    return fetchStoryboard();
  }, [fetchStoryboard]);

  // Mount read mirrors the repo effect pattern: the async body only
  // touches state after its first await, guarded by an active flag.
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const storyboard = await client.getForCandidate(candidateId);
        if (!active) return;
        setState({ phase: "loaded", storyboard });
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

  async function buildStoryboard() {
    setState({ phase: "creating" });
    try {
      const storyboard = await client.createForCandidate(candidateId);
      setState({ phase: "loaded", storyboard });
    } catch (error) {
      if (error instanceof StoryboardApiError) {
        if (error.code === "TREATMENT_NOT_FOUND") {
          setState({
            phase: "blocked",
            message:
              "No Director treatment exists for this candidate yet. Ask the Director for a treatment first, then return here.",
          });
        } else {
          setState({
            phase: "error",
            code: error.code,
            message: error.message,
          });
        }
      } else {
        setState({
          phase: "error",
          code: "UNKNOWN",
          message: "The storyboard could not be built.",
        });
      }
    }
  }

  return (
    <div className="workspace-shell">
      <header className="app-header">
        <a
          className="brand"
          href={storyboardBackHref}
          aria-label="Return to the candidate workspace"
        >
          <BrandMark />
          <span>
            YardToonz <b>Reactive</b>
          </span>
        </a>
        <div className="header-meta">
          <span className="mode-pill">Storyboard</span>
        </div>
      </header>

      <main className="workspace-main">
        <div className="page-heading">
          <p className="eyebrow">Candidate · {candidateId}</p>
          <h1>Storyboard</h1>
          <p className="lede">
            The Director treatment, broken into an ordered keyframe plan with
            camera moves and per-frame prompts.
          </p>
        </div>

        {state.phase === "loading" && (
          <p className="storyboard-status" role="status" aria-busy="true">
            Loading the storyboard…
          </p>
        )}

        {state.phase === "creating" && (
          <p className="storyboard-status" role="status" aria-busy="true">
            Building the storyboard from the treatment…
          </p>
        )}

        {state.phase === "blocked" && (
          <div className="error-banner" role="alert">
            <div>
              <strong>Treatment required</strong>
              <p>{state.message}</p>
            </div>
            <a className="back-button" href={storyboardBackHref}>
              Back to workspace
            </a>
          </div>
        )}

        {state.phase === "missing" && (
          <div className="empty-state">
            <p className="empty-sticker" aria-hidden="true" />
            <h2>No storyboard yet</h2>
            <p>
              Build the keyframe plan from this candidate&apos;s Director
              treatment — three beats, one camera move each.
            </p>
            <button type="button" onClick={() => void buildStoryboard()}>
              Build the storyboard
            </button>
          </div>
        )}

        {state.phase === "error" && (
          <div className="error-banner" role="alert">
            <div>
              <strong>We hit a snag</strong>
              <p>
                {state.code === "STORYBOARD_UNAVAILABLE"
                  ? state.message
                  : `${state.message} (${state.code})`}
              </p>
            </div>
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          </div>
        )}

        {state.phase === "loaded" && (
          <LoadedStrip storyboard={state.storyboard} />
        )}
      </main>
    </div>
  );
}

function LoadedStrip({ storyboard }: { storyboard: StoryboardResource }) {
  const { plan, cueSheet } = storyboard;
  const beatSequence = plan.frames.map((frame) => frame.beat);
  return (
    <section aria-label="Storyboard strip">
      <p className="storyboard-summary">
        <span className="storyboard-chip">
          {cueSheet.cues.length} cue{cueSheet.cues.length === 1 ? "" : "s"}
        </span>
        <span className="storyboard-chip">
          {formatSeconds(cueSheet.totalDurationSeconds)} total · 5–8s window
        </span>
        <span className="storyboard-chip">
          Beats: {beatSequence.map((beat) => beatLabels[beat]).join(" → ")}
        </span>
      </p>
      <ol className="storyboard-strip">
        {cueSheet.cues.map((cue) => {
          const frame = plan.frames[cue.index]!;
          return (
            <li className="storyboard-frame" key={cue.index}>
              <p className="storyboard-frame-beat">
                {beatLabels[cue.beat]}
                <span>Frame {cue.index + 1}</span>
              </p>
              <p className="storyboard-frame-timing">
                {formatSeconds(cue.startSeconds)} →{" "}
                {formatSeconds(cue.endSeconds)}
                <span> · {formatSeconds(cue.durationSeconds)}</span>
              </p>
              <p className="storyboard-frame-move">
                {frame.cameraMove.replace(/_/g, " ").toLowerCase()}
              </p>
              <p className="storyboard-frame-motion">
                {describeMotionParams(
                  parseMotionParams({
                    move: frame.cameraMove,
                    params: frame.motionParams,
                  }),
                )}
              </p>
              <p className="storyboard-frame-prompt">{frame.prompt}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
