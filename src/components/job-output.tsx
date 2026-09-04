"use client";
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { humanizeProvider } from "@/domain/inbox";
import {
  buildArtifactLineage,
  buildStageTimeline,
  buildVisualChain,
  formatClockTime,
  formatSeconds,
  isJobActive,
  outputFactsFromMetadata,
  slowStageSeconds,
  type LineageRow,
  type StageTimelineRow,
} from "@/domain/job-output";
import { lineageExplorerUrl } from "@/domain/lineage-explorer";
import { createApiProductionClient } from "@/lib/production-client";
import type { SourceAttribution } from "@/shared/attribution";
import type { ProductionDetailResponse } from "@/shared/productions";
import { AgentTraceMonitor } from "@/components/agent-trace-monitor";

const pollIntervalMs = 3000;

export interface JobOutputProps {
  productionId: string;
  onBack?: () => void;
  backLabel?: string;
}

interface OutputReview {
  finalArtifactId: string;
  previewUrl: string;
  downloadUrl: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioPresent?: boolean;
}

function elapsedSeconds(startedAt: string | undefined, nowMs: number): number {
  if (!startedAt) return 0;
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.round((nowMs - started) / 1000));
}

/**
 * Caption package shipped alongside the video download: the generated
 * social caption when the Director recorded one, otherwise the editorial
 * source caption. A data URI keeps the download a pure computation.
 */
function captionDownloadPackage(
  attribution: SourceAttribution | undefined,
  productionId: string,
): { fileName: string; href: string } | null {
  const text = attribution?.socialCaption ?? attribution?.caption ?? "";
  if (!text) return null;
  return {
    fileName: `yardtoonz-caption-${productionId}.txt`,
    href: `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`,
  };
}

/**
 * Authoritative monitor for a persisted production job: stage timeline,
 * safe failure display with retry, artifact lineage, output preview with
 * probed facts, and the approve/reject/download decision (UX specification
 * §3 step 5 and §4 job states). Everything renders from the polled API
 * snapshot, so a refresh restores the authoritative state.
 */
export function JobOutput({
  productionId,
  onBack,
  backLabel = "← Production setup",
}: JobOutputProps) {
  const client = useMemo(() => createApiProductionClient(), []);
  const [detail, setDetail] = useState<ProductionDetailResponse>();
  const [loadState, setLoadState] = useState<"loading" | "idle" | "error">(
    "loading",
  );
  const [loadError, setLoadError] = useState<string>();
  const [refreshToken, setRefreshToken] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [confirmingRetry, setConfirmingRetry] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState<"APPROVED" | "REJECTED">();
  const [actionError, setActionError] = useState<string>();
  const [rejectNoteOpen, setRejectNoteOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [attribution, setAttribution] = useState<SourceAttribution>();
  const [attributionState, setAttributionState] = useState<
    "loading" | "loaded" | "error"
  >("loading");
  const [attributionError, setAttributionError] = useState<string>();

  const captionDownload = captionDownloadPackage(attribution, productionId);
  const productionStatus = detail?.production.status;
  const statusRef = useRef(productionStatus);
  useEffect(() => {
    statusRef.current = productionStatus;
  }, [productionStatus]);

  // Poll while the job can still change; terminal statuses make the
  // interval a no-op until a retry re-arms the production.
  useEffect(() => {
    let active = true;

    async function refresh() {
      try {
        const fetched = await client.getDetail(productionId);
        if (!active) return;
        setDetail(fetched);
        setLoadState("idle");
        setLoadError(undefined);
      } catch (error) {
        if (!active) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "The production could not be loaded. Try again.",
        );
        setLoadState("error");
      }
    }

    void refresh();
    const interval = window.setInterval(() => {
      if (statusRef.current && !isJobActive(statusRef.current)) return;
      void refresh();
    }, pollIntervalMs);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [client, productionId, refreshToken]);

  // Clock for the running stage's elapsed time and "Still working" state.
  useEffect(() => {
    const clock = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(clock);
  }, []);

  // Attribution is read-only persisted context: fetched once per production
  // (and again on manual refresh), independent of the job-status polling.
  // State changes happen only in the async continuations so a refresh never
  // synchronously cascades a render from inside the effect.
  useEffect(() => {
    let active = true;
    client
      .fetchAttribution(productionId)
      .then((result) => {
        if (!active) return;
        setAttribution(result);
        setAttributionError(undefined);
        setAttributionState("loaded");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setAttributionError(
          error instanceof Error
            ? error.message
            : "The attribution could not be loaded.",
        );
        setAttributionState("error");
      });
    return () => {
      active = false;
    };
  }, [client, productionId, refreshToken]);

  const production = detail?.production;
  const timeline: StageTimelineRow[] = useMemo(
    () => buildStageTimeline(detail?.stages ?? [], production?.activeStage),
    [detail?.stages, production?.activeStage],
  );
  const lineage: LineageRow[] = useMemo(
    () => buildArtifactLineage(detail?.artifacts ?? []),
    [detail?.artifacts],
  );
  const visualChain = useMemo(
    () => buildVisualChain(detail?.artifacts ?? []),
    [detail?.artifacts],
  );
  // Before/after pairs the raw source keyframe with its clay frame when
  // both exist; either half missing means no comparison yet.
  const beforeAfter = useMemo(() => {
    const before = visualChain.find((step) => step.kind === "KEYFRAME");
    const after = visualChain.find((step) => step.kind === "STYLED_FRAME");
    return before && after ? { before, after } : undefined;
  }, [visualChain]);

  const finalArtifact = detail?.artifacts.find(
    (artifact) => artifact.kind === "FINAL_VIDEO",
  );
  const output: OutputReview | undefined =
    production && finalArtifact
      ? (() => {
          const facts = outputFactsFromMetadata(finalArtifact.metadata);
          return {
            finalArtifactId: finalArtifact.id,
            previewUrl: client.artifactUrl(production.id, finalArtifact.id),
            downloadUrl: client.artifactUrl(
              production.id,
              finalArtifact.id,
              true,
            ),
            ...facts,
          };
        })()
      : undefined;

  async function handleRetry() {
    if (!production || retrying) return;
    setRetrying(true);
    setActionError(undefined);
    try {
      setDetail(await client.retry(production.id, { confirmed: true }));
    } catch (retryError) {
      setActionError(
        retryError instanceof Error
          ? retryError.message
          : "The stage could not be retried. Try again.",
      );
    } finally {
      setRetrying(false);
    }
  }

  async function handleDecision(decision: "APPROVED" | "REJECTED") {
    if (!production || decisionBusy) return;
    const reason =
      decision === "REJECTED" && rejectNote.trim()
        ? rejectNote.trim()
        : undefined;
    setDecisionBusy(decision);
    setActionError(undefined);
    try {
      setDetail(
        await client.recordDecision(production.id, {
          decision,
          ...(reason ? { reason } : {}),
        }),
      );
      setRejectNoteOpen(false);
      setRejectNote("");
    } catch (decisionError) {
      setActionError(
        decisionError instanceof Error
          ? decisionError.message
          : "The decision could not be recorded. Try again.",
      );
    } finally {
      setDecisionBusy(undefined);
    }
  }

  if (loadState === "loading") {
    return (
      <section className="job-panel" aria-labelledby="job-title">
        <p className="processing-message" role="status">
          Loading the production job…
        </p>
      </section>
    );
  }

  if (loadState === "error" || !production) {
    return (
      <section className="job-panel" aria-labelledby="job-title">
        <p className="eyebrow">Production job</p>
        <h1 id="job-title">Job monitor</h1>
        <div className="error-banner" role="alert">
          <div>
            <strong>The job could not be loaded</strong>
            <p>{loadError ?? "The production could not be loaded."}</p>
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
        {onBack && (
          <button className="back-button" type="button" onClick={onBack}>
            {backLabel}
          </button>
        )}
      </section>
    );
  }

  const decision = detail?.outputDecision;
  const busy = retrying || decisionBusy !== undefined;

  return (
    <section className="job-panel" aria-labelledby="job-title">
      <p className="eyebrow">Production job</p>
      <div className="job-heading">
        <h1 id="job-title">Job monitor</h1>
        <span
          className="rights-chip"
          role="status"
          title="A production cannot queue without the persisted rights confirmation."
        >
          <i aria-hidden="true" /> Rights confirmed
        </span>
      </div>
      <p className="lede">
        Production <code>{production.id}</code> runs every stage on this
        machine. Completed stages keep their artifacts, and nothing is published
        automatically.
      </p>

      <dl className="provider-strip" aria-label="Production providers">
        <div>
          <dt>Image provider</dt>
          <dd>{humanizeProvider(production.imageProvider)}</dd>
        </div>
        <div>
          <dt>Animation provider</dt>
          <dd>{humanizeProvider(production.animationProvider)}</dd>
        </div>
        <div>
          <dt>Segment</dt>
          <dd>
            {formatSeconds(production.segment.startSeconds)}–
            {formatSeconds(production.segment.endSeconds)}
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            {production.status}
            {production.attempt > 1 ? ` · attempt ${production.attempt}` : ""}
          </dd>
        </div>
      </dl>

      {production.status === "FAILED" && (
        <div className="error-banner" role="alert">
          <div>
            <strong>Production failed</strong>
            <p>
              {production.safeErrorMessage ?? "A stage failed."}{" "}
              <code>{production.errorCode}</code>
            </p>
            <p>
              Retrying reuses every completed upstream artifact, so finished
              work is never duplicated.
            </p>
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={() => setConfirmingRetry(true)}
            disabled={retrying}
          >
            {retrying ? "Retrying…" : "Retry failed stage"}
          </button>
          {confirmingRetry && (
            <div
              className="retry-approval"
              role="group"
              aria-label="Confirm retry of paid provider output"
            >
              <p>
                Retrying re-runs the failed stage on its provider and may
                regenerate paid output. Confirm to proceed.
              </p>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  setConfirmingRetry(false);
                  void handleRetry();
                }}
                disabled={retrying}
              >
                {retrying ? "Retrying…" : "Confirm paid retry"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setConfirmingRetry(false)}
                disabled={retrying}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {actionError && (
        <div className="error-message" role="alert">
          <strong>Action failed.</strong> {actionError}
        </div>
      )}

      <h2>Stage timeline</h2>
      <ol className="job-timeline" aria-label="Production stage timeline">
        {timeline.map((row) => (
          <li
            key={row.name}
            className={`timeline-row timeline-row--${row.status.toLowerCase()}`}
            aria-current={row.isCurrent ? "step" : undefined}
          >
            <span className="timeline-marker" aria-hidden="true">
              {row.status === "COMPLETE"
                ? "✓"
                : row.status === "RUNNING"
                  ? "●"
                  : row.status === "FAILED"
                    ? "✕"
                    : "·"}
            </span>
            <div className="timeline-copy">
              <strong>
                {row.label}
                {row.attempt > 1 ? (
                  <small> · attempt {row.attempt}</small>
                ) : null}
              </strong>
              <span className="timeline-meta">
                {row.status === "COMPLETE" &&
                  `Complete${row.completedAt ? ` at ${formatClockTime(row.completedAt)}` : ""}`}
                {row.status === "RUNNING" &&
                  `Running · ${formatSeconds(elapsedSeconds(row.startedAt, nowMs))} elapsed`}
                {row.status === "WAITING" && "Waiting"}
                {row.status === "FAILED" &&
                  `Failed at ${formatClockTime(row.completedAt) || "unknown time"}`}
              </span>
              {row.status === "FAILED" && row.safeErrorMessage && (
                <p className="timeline-error">{row.safeErrorMessage}</p>
              )}
              {row.status === "RUNNING" &&
                elapsedSeconds(row.startedAt, nowMs) > slowStageSeconds && (
                  <p className="still-working" role="status">
                    Still working — this stage is taking longer than usual, but
                    the job has not failed.
                  </p>
                )}
            </div>
          </li>
        ))}
      </ol>

      <AgentTraceMonitor
        productionId={production.id}
        productionStatus={production.status}
        activeStage={production.activeStage}
        artifactHref={(artifactId) =>
          client.artifactUrl(production.id, artifactId)
        }
        headingId="job-agent-center-title"
      />

      <div className="lineage-heading">
        <h2>Artifact lineage</h2>
        <a
          className="secondary-button"
          href={lineageExplorerUrl(production.id)}
          data-testid="lineage-explorer-link"
        >
          Open lineage explorer
        </a>
      </div>
      {lineage.length === 0 ? (
        <p className="empty-state" role="status">
          Artifacts appear here as stages complete, from the source clip to the
          final video.
        </p>
      ) : (
        <ol
          className="lineage-strip"
          aria-label="Artifact lineage from source to final video"
        >
          {lineage.map((artifact) => (
            <li key={artifact.id} className="lineage-item">
              <a
                href={client.artifactUrl(production.id, artifact.id)}
                target="_blank"
                rel="noreferrer"
              >
                {artifact.label}
              </a>
              <small>
                {artifact.providerLabel} · {artifact.sizeLabel} ·{" "}
                {formatClockTime(artifact.createdAt)} · sha256{" "}
                {artifact.sha256Prefix}… ·{" "}
                <a href={lineageExplorerUrl(production.id, artifact.id)}>
                  Details
                </a>
              </small>
            </li>
          ))}
        </ol>
      )}

      <h2>Visual chain</h2>
      {visualChain.length === 0 ? (
        <p className="empty-state" role="status">
          Keyframe, clay frame, and animation previews appear here as stages
          complete.
        </p>
      ) : (
        <ol
          className="visual-chain"
          aria-label="Keyframe, clay frame, animation, and final video"
        >
          {visualChain.map((step) => (
            <li key={step.kind} className="visual-chain-step">
              {step.isVideo ? (
                <video
                  src={client.artifactUrl(production.id, step.artifactId)}
                  preload="metadata"
                  muted
                  playsInline
                  aria-label={step.label}
                />
              ) : (
                <img
                  src={client.artifactUrl(production.id, step.artifactId)}
                  alt={step.label}
                />
              )}
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
      )}

      {beforeAfter && (
        <div className="before-after" data-testid="before-after">
          <figure>
            <img
              src={client.artifactUrl(
                production.id,
                beforeAfter.before.artifactId,
              )}
              alt="Source keyframe from the original clip (before)"
            />
            <figcaption>Before · source keyframe</figcaption>
          </figure>
          <figure>
            <img
              src={client.artifactUrl(
                production.id,
                beforeAfter.after.artifactId,
              )}
              alt="Clay frame after the Yard Toonz style pass (after)"
            />
            <figcaption>After · clay frame</figcaption>
          </figure>
        </div>
      )}

      {output && (
        <>
          <h2>Output review</h2>
          <div className="output-grid">
            <video
              key={output.finalArtifactId}
              controls
              playsInline
              src={output.previewUrl}
              data-testid="output-preview"
            />
            <div>
              <dl className="facts-grid" aria-label="Output facts">
                <div>
                  <dt>Duration</dt>
                  <dd>{formatSeconds(output.durationSeconds)}</dd>
                </div>
                <div>
                  <dt>Dimensions</dt>
                  <dd>
                    {output.width !== undefined && output.height !== undefined
                      ? `${output.width} × ${output.height}`
                      : "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt>Video</dt>
                  <dd>{output.videoCodec?.toUpperCase() ?? "Unknown"}</dd>
                </div>
                <div>
                  <dt>Audio</dt>
                  <dd>
                    {output.audioPresent === undefined
                      ? "Unknown"
                      : output.audioPresent
                        ? "Present"
                        : "Missing"}
                  </dd>
                </div>
                <div>
                  <dt>Image provider</dt>
                  <dd>{humanizeProvider(production.imageProvider)}</dd>
                </div>
                <div>
                  <dt>Animation provider</dt>
                  <dd>{humanizeProvider(production.animationProvider)}</dd>
                </div>
              </dl>

              {decision?.decision === "APPROVED" && (
                <div className="success-banner" role="status">
                  <span>✓</span>
                  <div>
                    <strong>Output approved</strong>
                    <p>
                      Recorded {formatClockTime(decision.decidedAt)}. Download
                      stays available; nothing is published.
                    </p>
                  </div>
                </div>
              )}
              {decision?.decision === "REJECTED" && (
                <div
                  className="decision-banner decision-banner--rejected"
                  role="status"
                >
                  <strong>Output rejected</strong>
                  <p>
                    {decision.reason
                      ? `Note: ${decision.reason}`
                      : "No note recorded."}{" "}
                    Return to setup to adjust the production.
                  </p>
                </div>
              )}

              <div className="action-row">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void handleDecision("APPROVED")}
                  disabled={busy}
                >
                  {decisionBusy === "APPROVED"
                    ? "Recording approval…"
                    : "Approve output"}
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => setRejectNoteOpen((open) => !open)}
                  disabled={busy}
                  aria-expanded={rejectNoteOpen}
                >
                  {decisionBusy === "REJECTED"
                    ? "Recording rejection…"
                    : "Reject output"}
                </button>
                <a
                  className="secondary-button"
                  href={output.downloadUrl}
                  data-testid="download-final"
                >
                  Download MP4
                </a>
                {captionDownload && (
                  <a
                    className="secondary-button"
                    href={captionDownload.href}
                    download={captionDownload.fileName}
                    data-testid="download-caption"
                  >
                    Download caption (.txt)
                  </a>
                )}
              </div>
              {busy && (
                <p className="disabled-reason">
                  Decision buttons lock while a decision is being recorded.
                </p>
              )}

              {rejectNoteOpen && (
                <div className="reject-area">
                  <label>
                    <span>Rejection note (optional)</span>
                    <textarea
                      rows={3}
                      value={rejectNote}
                      onChange={(event) => setRejectNote(event.target.value)}
                      placeholder="What should the next attempt do differently?"
                    />
                  </label>
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => void handleDecision("REJECTED")}
                    disabled={busy}
                  >
                    Confirm rejection
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <h2>Source attribution &amp; caption package</h2>
      {attributionState === "loading" && (
        <p className="empty-state" role="status">
          Loading the source attribution…
        </p>
      )}
      {attributionState === "error" && (
        <div className="error-banner" role="alert">
          <div>
            <strong>The attribution could not be loaded</strong>
            <p>{attributionError ?? "The attribution could not be loaded."}</p>
          </div>
        </div>
      )}
      {attributionState === "loaded" && attribution && (
        <div className="attribution-panel" data-testid="attribution-panel">
          <div className="attribution-grid">
            <section aria-label="Source reference">
              <h3>Source reference</h3>
              <dl className="facts-grid">
                <div>
                  <dt>Platform</dt>
                  <dd>{attribution.platform}</dd>
                </div>
                <div>
                  <dt>Observed</dt>
                  <dd>
                    {formatClockTime(attribution.observedAt) ||
                      attribution.observedAt}
                  </dd>
                </div>
              </dl>
              <p className="attribution-label">{attribution.sourceLabel}</p>
              {attribution.sourceUrl ? (
                <a
                  href={attribution.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="attribution-source-link"
                >
                  Open the original post (stored reference only)
                </a>
              ) : (
                <p className="field-hint">No source URL was recorded.</p>
              )}
            </section>
            <section aria-label="Caption package">
              <h3>Caption package</h3>
              <p
                className="attribution-caption"
                data-testid="caption-candidate"
              >
                {attribution.caption}
              </p>
              {attribution.socialCaption ? (
                <p className="attribution-social" data-testid="caption-social">
                  {attribution.socialCaption}
                </p>
              ) : (
                <p className="field-hint" data-testid="caption-social-empty">
                  No generated social caption yet — the Director treatment has
                  not produced one.
                </p>
              )}
            </section>
            <section aria-label="Rights record">
              <h3>Rights record</h3>
              {attribution.rightsConfirmation ? (
                <p className="rights-record" data-testid="rights-record">
                  Confirmed{" "}
                  {formatClockTime(
                    attribution.rightsConfirmation.confirmedAt,
                  ) || attribution.rightsConfirmation.confirmedAt}{" "}
                  · text version{" "}
                  {attribution.rightsConfirmation.confirmationTextVersion}
                </p>
              ) : (
                <p className="field-hint" data-testid="rights-record-empty">
                  No rights confirmation is recorded for this source.
                </p>
              )}
            </section>
          </div>
        </div>
      )}

      <div className="action-row">
        <button
          type="button"
          className="secondary-button"
          onClick={() => setRefreshToken((token) => token + 1)}
        >
          Refresh job
        </button>
        {onBack && (
          <button type="button" className="back-button" onClick={onBack}>
            {backLabel}
          </button>
        )}
      </div>
    </section>
  );
}
