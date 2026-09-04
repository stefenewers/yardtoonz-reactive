"use client";

import {
  agentProviderLabel,
  evidenceRows,
  formatConfidence,
  formatElapsedMs,
  type AgentCardView,
  type AgentHandoffState,
} from "@/domain/agent-control-center";

/**
 * Presentational Agent Control Center: every prop is derived by the pure
 * domain module from the persisted trace, so this component renders state
 * and never computes it. State chips pair a glyph with a text label so the
 * state never relies on color alone.
 */

export interface AgentControlCenterProps {
  cards: readonly AgentCardView[];
  handoff: AgentHandoffState;
  /** Optional safe href for one artifact id (production scope). */
  artifactHref?: (artifactId: string) => string;
  headingId?: string;
}

const stateGlyphs: Record<AgentCardView["state"], string> = {
  WAITING: "·",
  RUNNING: "●",
  COMPLETE: "✓",
  FAILED: "✕",
};

const stateLabels: Record<AgentCardView["state"], string> = {
  WAITING: "Waiting",
  RUNNING: "Running",
  COMPLETE: "Complete",
  FAILED: "Failed",
};

function AgentArtifacts({
  artifactIds,
  artifactHref,
}: {
  artifactIds: readonly string[];
  artifactHref?: (artifactId: string) => string;
}) {
  if (artifactIds.length === 0) return null;
  return (
    <div className="agent-artifacts">
      <h4>Artifacts</h4>
      <ul>
        {artifactIds.map((artifactId) => (
          <li key={artifactId}>
            <code>{artifactId}</code>
            {artifactHref && (
              <a href={artifactHref(artifactId)}>Open artifact</a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AgentRunFacts({
  card,
  artifactHref,
}: {
  card: AgentCardView;
  artifactHref?: (artifactId: string) => string;
}) {
  const run = card.latestRun;
  if (!run) {
    return card.state === "RUNNING" ? (
      <p className="agent-note">
        Working now — this card fills in when the run persists.
      </p>
    ) : (
      <p className="agent-note">No run recorded yet.</p>
    );
  }

  const provider = agentProviderLabel(run.provider);
  const rows = evidenceRows(run.evidence);

  return (
    <div className="agent-run-facts">
      {run.decision && (
        <p className="agent-decision">
          <strong>Decision.</strong> {run.decision}
        </p>
      )}
      <dl className="agent-attribution">
        <div>
          <dt>Confidence</dt>
          <dd>
            {run.confidence !== undefined
              ? formatConfidence(run.confidence)
              : "Not reported"}
          </dd>
        </div>
        <div>
          <dt>Provider</dt>
          <dd>{provider ?? "None (deterministic)"}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{run.model ?? "Not disclosed"}</dd>
        </div>
        <div>
          <dt>Elapsed</dt>
          <dd>
            {run.elapsedMs !== undefined
              ? formatElapsedMs(run.elapsedMs)
              : "Not measured"}
          </dd>
        </div>
      </dl>
      <div className="agent-evidence">
        <h4>Input evidence</h4>
        {rows.length > 0 ? (
          <ul>
            {rows.map((row) => (
              <li key={row.label}>
                <span>{row.label}</span> {row.value}
              </li>
            ))}
          </ul>
        ) : (
          <p>No evidence was recorded for this run.</p>
        )}
      </div>
      <AgentArtifacts
        artifactIds={run.artifactIds}
        artifactHref={artifactHref}
      />
    </div>
  );
}

function HandoffBanner({ handoff }: { handoff: AgentHandoffState }) {
  if (handoff === "IDLE") return null;

  if (handoff === "AWAITING_APPROVAL") {
    return (
      <div className="handoff-banner" role="status">
        <span className="handoff-chip">Awaiting approval</span>
        <p>
          Media generation is gated. The human approval and rights confirmation
          stay in charge: approve the treatment and confirm rights to queue
          production. Nothing runs until then.
        </p>
      </div>
    );
  }

  if (handoff === "APPROVED") {
    return (
      <div className="handoff-banner handoff-banner--approved" role="status">
        <span className="handoff-chip">Media approved</span>
        <p>
          The human gate is cleared. The Clay Artist, Animator, and QA Inspector
          run on the persisted job.
        </p>
      </div>
    );
  }

  return (
    <div className="handoff-banner handoff-banner--complete" role="status">
      <span className="handoff-chip">Media complete</span>
      <p>
        Every media agent finished; the validated output awaits the human
        decision.
      </p>
    </div>
  );
}

export function AgentControlCenter({
  cards,
  handoff,
  artifactHref,
  headingId = "agent-center-title",
}: AgentControlCenterProps) {
  const totalRuns = cards.reduce((sum, card) => sum + card.runCount, 0);

  return (
    <section className="agent-center" aria-labelledby={headingId}>
      <p className="eyebrow">Agent Control Center</p>
      <h2 id={headingId}>What each agent did</h2>
      <p className="lede">
        Every card reads the persisted run trace — a refresh shows the same
        history, never a blank slate.
        {totalRuns === 0
          ? " No agent runs are recorded for this subject yet."
          : ""}
      </p>

      <HandoffBanner handoff={handoff} />

      <ol className="agent-grid" aria-label="Agent cards">
        {cards.map((card) => (
          <li
            key={card.agentKey}
            className={`agent-card agent-card--${card.state.toLowerCase()}`}
            aria-label={`${card.label}: ${stateLabels[card.state]}`}
          >
            <header className="agent-card-heading">
              <h3>{card.label}</h3>
              <p className="agent-role">{card.role}</p>
            </header>
            <p
              className={`agent-state-chip agent-state-chip--${card.state.toLowerCase()}`}
            >
              <span aria-hidden="true">{stateGlyphs[card.state]}</span>
              <span className="sr-only">State: </span>
              {stateLabels[card.state]}
              {card.runCount > 1 ? (
                <small> · {card.runCount} runs</small>
              ) : null}
            </p>
            <AgentRunFacts card={card} artifactHref={artifactHref} />
          </li>
        ))}
      </ol>
    </section>
  );
}
