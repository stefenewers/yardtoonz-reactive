"use client";

import { useMemo, useState } from "react";

import {
  formatMetric,
  scoreLabel,
  type Candidate,
  type ScoreEvidence,
} from "@/domain/candidate";
import { createMockCandidateClient } from "@/lib/candidate-client";
import type { AnimationProvider, ImageProvider } from "@/lib/providers";
import { ProductionStudio } from "@/app/produce/production-studio";

type Screen = "inbox" | "review" | "rights" | "upload";
type RequestState = "idle" | "loading" | "error";

interface CandidateWorkspaceProps {
  imageProvider: ImageProvider;
  animationProvider: AnimationProvider;
}

const platformLabels: Record<Candidate["platform"], string> = {
  TIKTOK: "TikTok",
  INSTAGRAM: "Instagram",
  YOUTUBE: "YouTube",
  OTHER: "Other",
};

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

function ProviderDisclosure({
  imageProvider,
  animationProvider,
}: CandidateWorkspaceProps) {
  return (
    <dl className="provider-strip" aria-label="Configured production providers">
      <div>
        <dt>Image provider</dt>
        <dd>{imageProvider}</dd>
      </div>
      <div>
        <dt>Animation provider</dt>
        <dd>{animationProvider}</dd>
      </div>
    </dl>
  );
}

export function CandidateWorkspace({
  imageProvider,
  animationProvider,
}: CandidateWorkspaceProps) {
  const client = useMemo(() => createMockCandidateClient(), []);
  const [screen, setScreen] = useState<Screen>("inbox");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate>();
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [error, setError] = useState<string>();
  const [rightsChecked, setRightsChecked] = useState(false);

  async function loadCandidates() {
    setRequestState("loading");
    setError(undefined);
    try {
      const loaded = await client.listCandidates();
      setCandidates(
        [...loaded].sort((a, b) => b.scores.overall - a.scores.overall),
      );
      setRequestState("idle");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Candidates could not be loaded.",
      );
      setRequestState("error");
    }
  }

  function openCandidate(candidate: Candidate) {
    setSelected(candidate);
    setScreen("review");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function approveCandidate() {
    if (!selected) return;
    setRequestState("loading");
    setError(undefined);
    try {
      const approved = await client.approveCandidate(selected.id);
      setSelected(approved);
      setCandidates((current) =>
        current.map((candidate) =>
          candidate.id === approved.id ? approved : candidate,
        ),
      );
      setScreen("rights");
      setRequestState("idle");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Approval failed. Try again.",
      );
      setRequestState("error");
    }
  }

  async function confirmRights() {
    if (!selected || !rightsChecked) return;
    setRequestState("loading");
    setError(undefined);
    try {
      await client.confirmRights({
        candidateId: selected.id,
        confirmationTextVersion: "2026-09-03",
      });
      setScreen("upload");
      setRequestState("idle");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Rights confirmation failed. Try again.",
      );
      setRequestState("error");
    }
  }

  const busy = requestState === "loading";

  return (
    <div className="workspace-shell">
      <header className="app-header">
        <button
          className="brand"
          type="button"
          onClick={() => setScreen("inbox")}
          aria-label="Return to candidate inbox"
        >
          <span className="brand-mark">YT</span>
          <span>
            YardToonz <b>Reactive</b>
          </span>
        </button>
        <div className="header-meta">
          <span className="mode-pill">Demo workspace</span>
          <span className="health">
            <i /> System ready
          </span>
        </div>
      </header>

      <main className="workspace-main">
        {error && (
          <div className="error-banner" role="alert">
            <div>
              <strong>We hit a snag</strong>
              <p>{error}</p>
            </div>
            <button
              type="button"
              onClick={
                screen === "inbox"
                  ? loadCandidates
                  : () => setRequestState("idle")
              }
            >
              Try again
            </button>
          </div>
        )}

        {screen === "inbox" && (
          <section aria-labelledby="inbox-title">
            <div className="page-heading">
              <div>
                <p className="eyebrow">Editorial desk</p>
                <h1 id="inbox-title">Candidate inbox</h1>
                <p>
                  Review promising moments before anything enters production.
                </p>
              </div>
              {candidates.length > 0 && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={loadCandidates}
                  disabled={busy}
                >
                  Refresh candidates
                </button>
              )}
            </div>
            <ProviderDisclosure
              imageProvider={imageProvider}
              animationProvider={animationProvider}
            />

            {busy && candidates.length === 0 ? (
              <div
                className="candidate-list"
                aria-label="Loading candidates"
                aria-busy="true"
              >
                {Array.from({ length: 4 }, (_, index) => (
                  <div className="candidate-card skeleton" key={index}>
                    <span />
                    <span />
                    <span />
                  </div>
                ))}
              </div>
            ) : candidates.length === 0 ? (
              <div className="empty-state">
                <span className="empty-sticker">10</span>
                <h2>Your desk is clear</h2>
                <p>
                  Load the deterministic demo set to review ten ranked moments.
                  Nothing is imported from social platforms.
                </p>
                <button
                  className="primary-button"
                  type="button"
                  onClick={loadCandidates}
                >
                  Load demo candidates
                </button>
              </div>
            ) : (
              <>
                <div className="list-toolbar">
                  <p>
                    <strong>{candidates.length} candidates</strong> · Ranked by
                    overall score
                  </p>
                  <span>Highest opportunity first</span>
                </div>
                <div className="candidate-list">
                  {candidates.map((candidate, index) => (
                    <button
                      className="candidate-card"
                      type="button"
                      key={candidate.id}
                      onClick={() => openCandidate(candidate)}
                    >
                      <span className="rank">#{index + 1}</span>
                      <span className="thumbnail" aria-hidden="true">
                        {platformLabels[candidate.platform].slice(0, 2)}
                      </span>
                      <span className="candidate-copy">
                        <small>
                          {platformLabels[candidate.platform]} ·{" "}
                          {candidate.sourceLabel}
                        </small>
                        <strong>{candidate.caption}</strong>
                        <em>
                          {candidate.metrics.shares === undefined
                            ? "Shares not supplied"
                            : `${formatMetric(candidate.metrics.shares)} shares`}
                        </em>
                      </span>
                      <span className="mini-score">
                        <small>Overall</small>
                        <strong>{candidate.scores.overall}</strong>
                        <em>{scoreLabel(candidate.scores.overall)}</em>
                      </span>
                      <span
                        className={`status status--${candidate.status.toLowerCase()}`}
                      >
                        {candidate.status === "NEW" ? "New" : "Approved"}
                      </span>
                      <span className="arrow" aria-hidden="true">
                        →
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {screen === "review" && selected && (
          <section aria-labelledby="review-title">
            <button
              className="back-button"
              type="button"
              onClick={() => setScreen("inbox")}
            >
              ← Candidate inbox
            </button>
            <div className="review-grid">
              <div>
                <p className="eyebrow">Candidate review</p>
                <h1 id="review-title">{selected.caption}</h1>
                <p className="source-line">
                  {platformLabels[selected.platform]} · {selected.sourceLabel}
                </p>
                <div className="premise-card">
                  <span>Yard Toonz angle</span>
                  <p>
                    {selected.adaptationNote ?? "No adaptation note supplied."}
                  </p>
                </div>
                <div className="metrics">
                  <div>
                    <small>Views</small>
                    <strong>{formatMetric(selected.metrics.views)}</strong>
                  </div>
                  <div>
                    <small>Likes</small>
                    <strong>{formatMetric(selected.metrics.likes)}</strong>
                  </div>
                  <div>
                    <small>Comments</small>
                    <strong>{formatMetric(selected.metrics.comments)}</strong>
                  </div>
                  <div>
                    <small>Shares</small>
                    <strong>{formatMetric(selected.metrics.shares)}</strong>
                  </div>
                </div>
                <div className="comments">
                  <h2>Audience evidence</h2>
                  {selected.commentExcerpts.length > 0 ? (
                    selected.commentExcerpts.map((comment) => (
                      <blockquote key={comment}>“{comment}”</blockquote>
                    ))
                  ) : (
                    <p>No comment evidence was supplied for this candidate.</p>
                  )}
                </div>
              </div>
              <aside className="review-panel">
                <div className="overall-score">
                  <span>Overall opportunity</span>
                  <strong>{selected.scores.overall}</strong>
                  <em>{scoreLabel(selected.scores.overall)}</em>
                </div>
                <ScoreCard
                  label="Viral momentum"
                  evidence={selected.scores.viralMomentum}
                />
                <ScoreCard
                  label="Humor response"
                  evidence={selected.scores.humorResponse}
                />
                <ScoreCard
                  label="Yard Toonz fit"
                  evidence={selected.scores.yardToonzFit}
                />
                <div className="action-stack">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={approveCandidate}
                    disabled={busy}
                  >
                    {busy ? "Approving…" : "Approve for production"}
                  </button>
                  <button className="danger-button" type="button">
                    Reject candidate
                  </button>
                  <p>
                    Approval records an editorial decision. It does not start
                    generation.
                  </p>
                </div>
              </aside>
            </div>
          </section>
        )}

        {screen === "rights" && selected && (
          <section className="gate-layout" aria-labelledby="rights-title">
            <div>
              <button
                className="back-button"
                type="button"
                onClick={() => setScreen("review")}
              >
                ← Candidate review
              </button>
              <p className="eyebrow">Production setup · 1 of 2</p>
              <h1 id="rights-title">Confirm source rights</h1>
              <p className="lede">
                Approval is recorded. Before a source clip can be uploaded,
                confirm that Yard Toonz has permission to use the video and its
                selected audio.
              </p>
              <div className="approved-summary">
                <span>Approved candidate</span>
                <strong>{selected.caption}</strong>
                <small>{selected.sourceLabel}</small>
              </div>
            </div>
            <aside className="rights-card">
              <span className="gate-icon">✓</span>
              <h2>Rights are a hard gate</h2>
              <p>
                A public post or URL is not proof of permission. This
                confirmation applies to the source video and the audio segment
                you will select.
              </p>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={rightsChecked}
                  onChange={(event) => setRightsChecked(event.target.checked)}
                />
                <span>
                  <strong>
                    I confirm Yard Toonz is authorized to use this source video
                    and selected audio.
                  </strong>
                  <small>
                    This decision will be timestamped when production
                    persistence is connected.
                  </small>
                </span>
              </label>
              <button
                className="primary-button"
                type="button"
                onClick={confirmRights}
                disabled={!rightsChecked || busy}
              >
                {busy ? "Confirming…" : "Confirm rights and continue"}
              </button>
              {!rightsChecked && (
                <p className="disabled-reason">
                  Confirm authorization to continue to clip upload.
                </p>
              )}
            </aside>
          </section>
        )}

        {screen === "upload" && selected && (
          <ProductionStudio
            initialRightsConfirmed
            candidateCaption={selected.caption}
          />
        )}
      </main>
    </div>
  );
}
