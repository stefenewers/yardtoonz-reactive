"use client";

import { useEffect, useMemo, useState } from "react";

import {
  describeFeedRunCounts,
  feedRunStatusLabel,
  formatScoutRunRecency,
} from "@/domain/trend-scout";
import { createApiScoutClient } from "@/lib/scout-client";
import type { ScoutApiClient } from "@/lib/scout-client";
import type { FeedRunResource } from "@/shared/trend-scout";

export interface ScoutHeaderActionProps {
  /**
   * Called after a run imports new candidates so the workspace can refresh
   * the inbox without a manual reload.
   */
  onImported?: (run: FeedRunResource) => void;
  client?: ScoutApiClient;
}

/**
 * Inbox header action for the Trend Scout: one button to run every themed
 * feed, plus the persisted last-run status (label, recency, and the
 * discovered/imported/duplicate counts) so an editor can trust the desk
 * without opening anything.
 */
export function ScoutHeaderAction({
  onImported,
  client,
}: ScoutHeaderActionProps) {
  // One client per component instance: a fresh object every render would
  // re-trigger the latest-run effect on each state change.
  const fallbackClient = useMemo(() => createApiScoutClient(), []);
  const scoutClient = client ?? fallbackClient;
  const [latestRun, setLatestRun] = useState<FeedRunResource>();
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [statusError, setStatusError] = useState<string>();
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string>();
  // Recency is computed only after mount so server and client markup agree.
  const [nowMs, setNowMs] = useState<number>();

  useEffect(() => {
    let active = true;
    async function loadLatestRun() {
      try {
        const run = await scoutClient.fetchLatestRun();
        if (!active) return;
        // Recency is stamped after mount so server and client markup agree.
        setNowMs(Date.now());
        setLatestRun(run);
        setStatusError(undefined);
      } catch {
        if (!active) return;
        setStatusError("Last scout run status could not be loaded.");
      } finally {
        if (active) setStatusLoaded(true);
      }
    }
    void loadLatestRun();
    return () => {
      active = false;
    };
  }, [scoutClient]);

  async function runScout() {
    setRunning(true);
    setRunError(undefined);
    try {
      const run = await scoutClient.runScout();
      setLatestRun(run);
      setNowMs(Date.now());
      if (run.importedCount > 0) onImported?.(run);
    } catch (caught) {
      setRunError(
        caught instanceof Error
          ? caught.message
          : "The scout run failed. Try again.",
      );
    } finally {
      setRunning(false);
    }
  }

  const statusLabel = latestRun
    ? `${feedRunStatusLabel(latestRun.status)} · ${formatScoutRunRecency(latestRun, nowMs) || latestRun.completedAt} · ${describeFeedRunCounts(latestRun)}`
    : statusLoaded
      ? "No scout runs yet"
      : "Checking last scout run…";

  return (
    <div className="scout-action">
      <span
        className={`scout-status${latestRun ? ` scout-status--${latestRun.status.toLowerCase()}` : ""}`}
        role="status"
        aria-label="Last scout run status"
      >
        {statusError ?? statusLabel}
      </span>
      {runError && (
        <span className="scout-error" role="alert">
          {runError}
        </span>
      )}
      <button
        className="secondary-button scout-run-button"
        type="button"
        onClick={() => void runScout()}
        disabled={running}
        aria-busy={running}
      >
        {running ? "Scouting…" : "Run Scout"}
      </button>
    </div>
  );
}
