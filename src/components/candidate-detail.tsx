"use client";

import { useState } from "react";

import {
  formatDecisionTimestamp,
  formatMetric,
  scoreLabel,
  type Candidate,
  type ScoreEvidence,
} from "@/domain/candidate";
import { overallWeightingSummary, platformLabels } from "@/domain/inbox";

import { AnalystPanel } from "./analyst-panel";

export interface CandidateDetailProps {
  candidate: Candidate;
  busy: boolean;
  onBack: () => void;
  onApprove: () => void;
  /** Reason is optional editorial context; undefined means rejected without one. */
  onReject: (reason?: string) => void;
  onRestore: () => void;
  onContinue: () => void;
}

function ScoreCard({
  label,
  evidence,
}: {
  label: string;
  evidence: ScoreEvidence;
}) {
  return (
    <article className="score-card">
      <div className="score-card__heading">
        <span>{label}</span>
        <strong>{evidence.score}</strong>
      </div>
      <p className="score-label">{scoreLabel(evidence.score)}</p>
      <p>{evidence.explanation}</p>
      <small>
        {evidence.inputsUsed.length > 0
          ? `Based on: ${evidence.inputsUsed.join(", ")}`
          : "No supporting comment inputs supplied"}
      </small>
    </article>
  );
}

function DecisionBanner({ candidate }: { candidate: Candidate }) {
  if (candidate.status === "NEW") return null;

  const approved = candidate.status === "APPROVED";
  return (
    <div
      className={`decision-banner decision-banner--${
        approved ? "approved" : "rejected"
      }`}
      role="status"
    >
      <strong>{approved ? "✓ Approved for production" : "Rejected"}</strong>
      <p>
        Decision recorded{" "}
        <time dateTime={candidate.decidedAt}>
          {candidate.decidedAt
            ? formatDecisionTimestamp(candidate.decidedAt)
            : "without a timestamp"}
        </time>
        .{" "}
        {approved
          ? "Approval does not start generation."
          : "This moment is off the production desk."}
      </p>
      {!approved && (
        <p>
          {candidate.decisionReason
            ? `Reason: ${candidate.decisionReason}`
            : "No reason was recorded."}
        </p>
      )}
    </div>
  );
}

function DecisionActions({
  candidate,
  busy,
  onApprove,
  onReject,
  onRestore,
  onContinue,
}: {
  candidate: Candidate;
  busy: boolean;
} & Pick<
  CandidateDetailProps,
  "onApprove" | "onReject" | "onRestore" | "onContinue"
>) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  function closeRejection() {
    setRejectOpen(false);
    setRejectReason("");
  }

  function submitRejection() {
    const reason = rejectReason.trim();
    onReject(reason === "" ? undefined : reason);
  }

  if (candidate.status === "APPROVED") {
    return (
      <div className="action-stack">
        <button className="primary-button" type="button" onClick={onContinue}>
          Continue to production
        </button>
        <p>
          Approval is recorded. Rights confirmation is the next gate before any
          upload.
        </p>
      </div>
    );
  }

  if (candidate.status === "REJECTED") {
    return (
      <div className="action-stack">
        <button
          className="primary-button"
          type="button"
          onClick={onRestore}
          disabled={busy}
        >
          {busy ? "Restoring…" : "Restore to inbox"}
        </button>
        <p>
          Restoring returns this candidate to New so it can be decided again.
        </p>
      </div>
    );
  }

  return (
    <div className="action-stack">
      <button
        className="primary-button"
        type="button"
        onClick={onApprove}
        disabled={busy}
      >
        {busy ? "Approving…" : "Approve for production"}
      </button>
      {rejectOpen ? (
        <div className="reject-area">
          <label htmlFor="reject-reason">Reason (optional)</label>
          <textarea
            id="reject-reason"
            name="reject-reason"
            rows={3}
            value={rejectReason}
            placeholder="What held this moment back?"
            onChange={(event) => setRejectReason(event.target.value)}
          />
          <div className="reject-area__buttons">
            <button
              className="danger-button"
              type="button"
              onClick={submitRejection}
              disabled={busy}
            >
              {busy ? "Rejecting…" : "Record rejection"}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={closeRejection}
              disabled={busy}
            >
              Keep as new
            </button>
          </div>
        </div>
      ) : (
        <button
          className="danger-button"
          type="button"
          onClick={() => setRejectOpen(true)}
          disabled={busy}
        >
          Reject candidate
        </button>
      )}
      <p>
        Approval records an editorial decision. It does not start generation.
      </p>
    </div>
  );
}

export function CandidateDetail({
  candidate,
  busy,
  onBack,
  onApprove,
  onReject,
  onRestore,
  onContinue,
}: CandidateDetailProps) {
  const muted = candidate.status === "REJECTED";

  return (
    <section aria-labelledby="review-title">
      <button className="back-button" type="button" onClick={onBack}>
        ← Candidate inbox
      </button>
      <div className="review-grid">
        <div>
          <p className="eyebrow">Candidate review</p>
          <h1 id="review-title">{candidate.caption}</h1>
          <p className="source-line">
            {platformLabels[candidate.platform]} · {candidate.sourceLabel}
          </p>
          <DecisionBanner candidate={candidate} />
          <div
            className={`detail-evidence${muted ? " detail-evidence--muted" : ""}`}
          >
            <div className="premise-card">
              <span>Yard Toonz angle</span>
              <p>
                {candidate.adaptationNote ?? "No adaptation note supplied."}
              </p>
            </div>
            <div className="metrics">
              <div>
                <small>Views</small>
                <strong>{formatMetric(candidate.metrics.views)}</strong>
              </div>
              <div>
                <small>Likes</small>
                <strong>{formatMetric(candidate.metrics.likes)}</strong>
              </div>
              <div>
                <small>Comments</small>
                <strong>{formatMetric(candidate.metrics.comments)}</strong>
              </div>
              <div>
                <small>Shares</small>
                <strong>{formatMetric(candidate.metrics.shares)}</strong>
              </div>
            </div>
            <div className="comments">
              <h2>Audience evidence</h2>
              {candidate.commentExcerpts.length > 0 ? (
                candidate.commentExcerpts.map((comment) => (
                  <blockquote key={comment}>“{comment}”</blockquote>
                ))
              ) : (
                <p>No comment evidence was supplied for this candidate.</p>
              )}
            </div>
            <AnalystPanel candidateId={candidate.id} />
          </div>
        </div>
        <aside className="review-panel">
          <div className="overall-score">
            <span>Overall opportunity</span>
            <strong>{candidate.scores.overall}</strong>
            <em>{scoreLabel(candidate.scores.overall)}</em>
          </div>
          <p className="weighting-note">{overallWeightingSummary()}</p>
          <ScoreCard
            label="Viral momentum"
            evidence={candidate.scores.viralMomentum}
          />
          <ScoreCard
            label="Humor response"
            evidence={candidate.scores.humorResponse}
          />
          <ScoreCard
            label="Yard Toonz fit"
            evidence={candidate.scores.yardToonzFit}
          />
          <DecisionActions
            candidate={candidate}
            busy={busy}
            onApprove={onApprove}
            onReject={onReject}
            onRestore={onRestore}
            onContinue={onContinue}
          />
        </aside>
      </div>
    </section>
  );
}
