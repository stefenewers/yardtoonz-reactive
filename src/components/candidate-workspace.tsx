"use client";

import { useEffect, useMemo, useState } from "react";

import { type Candidate } from "@/domain/candidate";
import {
  defaultInboxSort,
  healthDisplay,
  humanizeProvider,
  providerModeLabel,
  type InboxSortState,
} from "@/domain/inbox";
import { createApiCandidateClient } from "@/lib/candidate-client";
import { fetchHealthReport } from "@/lib/health-client";
import type { PublicHealthReportPayload } from "@/shared/health";
import type { AnimationProvider, ImageProvider } from "@/lib/providers";
import { BrandMark } from "@/components/brand-mark";
import { CandidateDetail } from "@/components/candidate-detail";
import { CandidateInbox } from "@/components/candidate-inbox";
import { ProductionSetup } from "@/components/production-setup";
import { ScoutHeaderAction } from "@/components/scout-header-action";

type Screen = "inbox" | "review" | "rights" | "upload";
type RequestState = "idle" | "loading" | "error";

interface CandidateWorkspaceProps {
  imageProvider: ImageProvider;
  animationProvider: AnimationProvider;
  maxUploadMb: number;
}

interface ProviderDisclosureProps {
  imageProvider: ImageProvider;
  animationProvider: AnimationProvider;
}

function ProviderDisclosure({
  imageProvider,
  animationProvider,
}: ProviderDisclosureProps) {
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
  maxUploadMb,
}: CandidateWorkspaceProps) {
  const client = useMemo(() => createApiCandidateClient(), []);
  const [screen, setScreen] = useState<Screen>("inbox");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate>();
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [error, setError] = useState<string>();
  const [rightsChecked, setRightsChecked] = useState(false);
  const [sort, setSort] = useState<InboxSortState>(defaultInboxSort);
  const [fetchedAt, setFetchedAt] = useState<number>();
  const [health, setHealth] = useState<PublicHealthReportPayload>();
  const [healthFailed, setHealthFailed] = useState(false);

  useEffect(() => {
    let active = true;

    async function refreshHealth() {
      try {
        const report = await fetchHealthReport();
        if (!active) return;
        setHealth(report);
        setHealthFailed(false);
      } catch {
        if (!active) return;
        setHealthFailed(true);
      }
    }

    void refreshHealth();
    const interval = window.setInterval(refreshHealth, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  async function loadCandidates(requestedSort: InboxSortState = sort) {
    setRequestState("loading");
    setError(undefined);
    const observedAt = Date.now();
    try {
      const loaded = await client.listCandidates({
        sort: requestedSort.field,
        order: requestedSort.order,
      });
      setCandidates(loaded);
      setFetchedAt(observedAt);
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

  function changeSort(next: InboxSortState) {
    setSort(next);
    void loadCandidates(next);
  }

  function openCandidate(candidate: Candidate) {
    setSelected(candidate);
    setScreen("review");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** One persisted decision lands in the detail view and the inbox row alike. */
  function applyCandidate(next: Candidate) {
    setSelected(next);
    setCandidates((current) =>
      current.map((candidate) => (candidate.id === next.id ? next : candidate)),
    );
  }

  async function approveCandidate() {
    if (!selected) return;
    setRequestState("loading");
    setError(undefined);
    try {
      const approved = await client.approveCandidate(selected.id);
      applyCandidate(approved);
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

  async function rejectCandidate(reason?: string) {
    if (!selected) return;
    setRequestState("loading");
    setError(undefined);
    try {
      applyCandidate(await client.rejectCandidate(selected.id, reason));
      setRequestState("idle");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Rejection failed. Try again.",
      );
      setRequestState("error");
    }
  }

  async function restoreCandidate() {
    if (!selected) return;
    setRequestState("loading");
    setError(undefined);
    try {
      applyCandidate(await client.restoreCandidate(selected.id));
      setRequestState("idle");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Restore failed. Try again.",
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
  const healthTone = healthDisplay(health, healthFailed);

  return (
    <div className="workspace-shell">
      <header className="app-header">
        <button
          className="brand"
          type="button"
          onClick={() => setScreen("inbox")}
          aria-label="Return to candidate inbox"
        >
          <BrandMark />
          <span>
            YardToonz <b>Reactive</b>
          </span>
        </button>
        <div className="header-meta">
          {health && (
            <>
              <span className="mode-pill">
                {providerModeLabel(
                  health.providers.image,
                  health.providers.animation,
                )}
              </span>
              <span className="provider-pill">
                Image · {humanizeProvider(health.providers.image)}
              </span>
              <span className="provider-pill">
                Animation · {humanizeProvider(health.providers.animation)}
              </span>
            </>
          )}
          <span className={`health health--${healthTone.tone}`} role="status">
            <i aria-hidden="true" />
            {healthTone.label}
          </span>
          <a
            className="mode-pill"
            href="/diagnostics"
            title="Provider diagnostics: credential readiness, attribution audit, request-ID timelines"
          >
            Diagnostics
          </a>
          <ScoutHeaderAction onImported={() => loadCandidates()} />
        </div>
      </header>

      <main className="workspace-main">
        {error && screen !== "inbox" && (
          <div className="error-banner" role="alert">
            <div>
              <strong>We hit a snag</strong>
              <p>{error}</p>
            </div>
            <button type="button" onClick={() => setRequestState("idle")}>
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
                  onClick={() => loadCandidates()}
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

            <CandidateInbox
              candidates={candidates}
              loading={busy}
              error={error}
              sort={sort}
              nowMs={fetchedAt}
              onSortChange={changeSort}
              onRetry={() => loadCandidates()}
              onLoadDemo={() => loadCandidates()}
              onOpenCandidate={openCandidate}
            />
          </section>
        )}

        {screen === "review" && selected && (
          <CandidateDetail
            key={selected.id}
            candidate={selected}
            busy={busy}
            onBack={() => setScreen("inbox")}
            onApprove={approveCandidate}
            onReject={rejectCandidate}
            onRestore={restoreCandidate}
            onContinue={() => setScreen("rights")}
          />
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
                    This decision is timestamped and stored before any upload or
                    processing.
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
          <ProductionSetup
            candidateId={selected.id}
            candidateCaption={selected.caption}
            imageProvider={imageProvider}
            animationProvider={animationProvider}
            maxUploadMb={maxUploadMb}
            onBack={() => setScreen("rights")}
          />
        )}
      </main>
    </div>
  );
}
