"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  deriveAgentCards,
  deriveApprovalHandoff,
  mediaAgentRoster,
  sixAgentRoster,
  type AgentCardView,
} from "@/domain/agent-control-center";
import { isJobActive } from "@/domain/job-output";
import { createAgentTraceClient } from "@/lib/agent-trace-client";
import { AgentControlCenter } from "@/components/agent-control-center";
import type { ProductionStatus } from "@/domain/production";
import type { AgentRunView } from "@/shared/agents";

const pollIntervalMs = 3000;

export interface AgentTraceMonitorProps {
  /** Candidate subject: renders the full six-agent roster. */
  candidateId?: string;
  /** Production subject: renders the media-agent roster. */
  productionId?: string;
  /** Production subject only: derives RUNNING cards and the handoff. */
  productionStatus?: ProductionStatus;
  activeStage?: string;
  /** Optional safe href for one artifact id (production scope). */
  artifactHref?: (artifactId: string) => string;
  headingId?: string;
}

/**
 * Authoritative agent-trace monitor: polls the persisted trace API every
 * 3s (the proven job-output idiom) and feeds the presentational Control
 * Center. State lives on the server, so a refresh restores the same
 * history instead of a blank slate.
 */
export function AgentTraceMonitor({
  candidateId,
  productionId,
  productionStatus,
  activeStage,
  artifactHref,
  headingId,
}: AgentTraceMonitorProps) {
  const client = useMemo(() => createAgentTraceClient(), []);
  const [runs, setRuns] = useState<AgentRunView[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "idle" | "error">(
    "loading",
  );
  const [loadError, setLoadError] = useState<string>();
  const [refreshToken, setRefreshToken] = useState(0);

  // Poll only while the subject can still change: candidate traces have no
  // status, so they always poll; a production outside its active window is
  // terminal until a retry re-arms it.
  const polling =
    candidateId !== undefined || isJobActive(productionStatus ?? "COMPLETE");
  const pollingRef = useRef(polling);
  useEffect(() => {
    pollingRef.current = polling;
  }, [polling]);

  useEffect(() => {
    let active = true;

    async function refresh() {
      try {
        const fetched = await client.getTrace(
          candidateId !== undefined
            ? { candidateId }
            : { productionId: productionId ?? "" },
        );
        if (!active) return;
        setRuns(fetched.runs);
        setLoadState("idle");
        setLoadError(undefined);
      } catch (error) {
        if (!active) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "The agent trace could not be loaded. Try again.",
        );
        setLoadState("error");
      }
    }

    void refresh();
    const interval = window.setInterval(() => {
      if (!pollingRef.current) return;
      void refresh();
    }, pollIntervalMs);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [client, candidateId, productionId, refreshToken]);

  const roster = candidateId !== undefined ? sixAgentRoster : mediaAgentRoster;
  const cards: readonly AgentCardView[] = useMemo(
    () =>
      deriveAgentCards({ runs, productionStatus, activeStage, agents: roster }),
    [runs, productionStatus, activeStage, roster],
  );
  const handoff = useMemo(
    () => deriveApprovalHandoff({ runs, productionStatus }),
    [runs, productionStatus],
  );

  if (loadState === "loading") {
    return (
      <p className="processing-message" role="status">
        Loading the agent trace…
      </p>
    );
  }

  if (loadState === "error") {
    return (
      <div className="error-banner" role="alert">
        <div>
          <strong>The agent trace could not be loaded</strong>
          <p>{loadError ?? "The trace service could not be reached."}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoadState("loading");
            setRefreshToken((token) => token + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <AgentControlCenter
      cards={cards}
      handoff={handoff}
      artifactHref={artifactHref}
      headingId={headingId}
    />
  );
}
