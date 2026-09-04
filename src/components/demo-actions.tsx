"use client";

import { useMemo, useState } from "react";

import { createApiDemoClient, type DemoApiClient } from "@/lib/demo-client";

export interface DemoActionsProps {
  /** Opens the pinned walkthrough candidate in the review flow. */
  onUseDemoCandidate: () => void;
  /** Called after a successful reset so the workspace refreshes the inbox. */
  onReset: () => void;
  /** Locks both controls while the workspace is mid-request. */
  busy?: boolean;
  client?: DemoApiClient;
}

/**
 * The demo spine's inbox panel: one click to the pinned walkthrough
 * candidate, plus the guarded rehearsal reset built on the proven
 * `demo:reset` semantics (the server re-verifies every guard).
 */
export function DemoActions({
  onUseDemoCandidate,
  onReset,
  busy = false,
  client,
}: DemoActionsProps) {
  const fallbackClient = useMemo(() => createApiDemoClient(), []);
  const demoClient = client ?? fallbackClient;
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string>();

  async function resetDemo() {
    if (resetting) return;
    setResetting(true);
    setResetError(undefined);
    try {
      await demoClient.resetDemo();
      setConfirmingReset(false);
      onReset();
    } catch (caught) {
      setResetError(
        caught instanceof Error
          ? caught.message
          : "The demo reset failed. Try again.",
      );
    } finally {
      setResetting(false);
    }
  }

  const locked = busy || resetting;

  return (
    <aside className="demo-panel" aria-label="Demo controls">
      <div className="demo-panel-row">
        <button
          type="button"
          className="primary-button"
          onClick={onUseDemoCandidate}
          disabled={locked}
        >
          Use demo candidate
        </button>
        <p className="demo-hint">
          Jumps straight to the pinned walkthrough candidate (rain-day laundry
          run) with its owner-cleared source clip.
        </p>
      </div>
      <div className="demo-panel-row demo-rehearsal">
        {confirmingReset ? (
          <div
            className="retry-approval"
            role="group"
            aria-label="Confirm demo data reset"
          >
            <p>
              Reset wipes the local demo database and every generated artifact,
              then reseeds the ten fixtures. Confirm to proceed.
            </p>
            <button
              type="button"
              className="danger-button"
              onClick={() => void resetDemo()}
              disabled={resetting}
            >
              {resetting ? "Resetting…" : "Confirm reset"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setConfirmingReset(false)}
              disabled={resetting}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="secondary-button"
            onClick={() => setConfirmingReset(true)}
            disabled={locked}
            aria-expanded={confirmingReset}
          >
            Reset demo data
          </button>
        )}
        <p className="demo-hint">
          Rehearsal reset — same semantics as <code>npm run demo:reset</code>,
          refused outside local MOCK mode.
        </p>
      </div>
      {resetError && (
        <div className="error-message" role="alert">
          <strong>Reset failed.</strong> {resetError}
        </div>
      )}
    </aside>
  );
}
