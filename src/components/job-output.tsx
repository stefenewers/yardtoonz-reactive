"use client";
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { humanizeProvider } from "@/domain/inbox";
import {
  buildArtifactLineage,
  buildStageTimeline,
  formatClockTime,
  formatSeconds,
  isJobActive,
  outputFactsFromMetadata,
  slowStageSeconds,
  type LineageRow,
  type StageTimelineRow,
} from "@/domain/job-output";
import { createApiProductionClient } from "@/lib/production-client";
import type { ProductionDetailResponse } from "@/shared/productions";

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
  const [decisionBusy, setDecisionBusy] = useState<"APPROVED" | "REJECTED">();
  const [actionError, setActionError] = useState<string>();
  const [rejectNoteOpen, setRejectNoteOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());

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

  const production = detail?.production;
  const timeline: StageTimelineRow[] = useMemo(
    () => buildStageTimeline(detail?.stages ?? [], production?.activeStage),
    [detail?.stages, production?.activeStage],
  );
  const lineage: LineageRow[] = useMemo(
    () => buildArtifactLineage(detail?.artifacts ?? []),
    [detail?.artifacts],
  );

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
      setDetail(await client.retry(production.id));
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
      {onBack && (
        <button className="back-button" type="button" onClick={onBack}>
          {backLabel}
        </button>
      )}
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
            onClick={() => void handleRetry()}
            disabled={retrying}
          >
            {retrying ? "Retrying…" : "Retry failed stage"}
          </button>
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

      <h2>Artifact lineage</h2>
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
                {artifact.sha256Prefix}…
              </small>
            </li>
          ))}
        </ol>
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
