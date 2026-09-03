"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import { humanizeProvider } from "@/domain/inbox";
import type { SegmentSelection } from "@/domain/production";
import {
  evaluateSegmentDraft,
  evaluateSourceFile,
  rightsConfirmationTextVersion,
  segmentProblemMessages,
  sourceFactsFromMetadata,
  sourceProblemMessages,
  type SourceVideoFacts,
} from "@/domain/production-setup";
import { createApiProductionClient } from "@/lib/production-client";
import type { AnimationProvider, ImageProvider } from "@/lib/providers";
import type { ProductionDetailResponse } from "@/shared/productions";

export interface ProductionSetupProps {
  candidateId: string;
  candidateCaption?: string;
  imageProvider: ImageProvider;
  animationProvider: AnimationProvider;
  maxUploadMb: number;
  onBack: () => void;
}

interface GateState {
  done: boolean;
  label: string;
  reason: string;
}

/** Pre-queue default so the persisted contract has a segment before upload. */
const defaultSegment: SegmentSelection = {
  startSeconds: 0,
  endSeconds: 6,
  durationSeconds: 6,
};

function formatSeconds(value: number): string {
  return `${Number.isFinite(value) ? value.toFixed(1) : "?"}s`;
}

function sourceErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The source could not be uploaded. Try again.";
}

export function ProductionSetup({
  candidateId,
  candidateCaption,
  imageProvider,
  animationProvider,
  maxUploadMb,
  onBack,
}: ProductionSetupProps) {
  const client = useMemo(() => createApiProductionClient(), []);
  const [production, setProduction] = useState<ProductionDetailResponse>();
  const [creationError, setCreationError] = useState<string>();
  const [rightsProblem, setRightsProblem] = useState<string>();
  const [file, setFile] = useState<File>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [sourceError, setSourceError] = useState<string>();
  const [sourceFacts, setSourceFacts] = useState<SourceVideoFacts>();
  const [startInput, setStartInput] = useState("0");
  const [endInput, setEndInput] = useState("6");
  const [creativeDirection, setCreativeDirection] = useState("");
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string>();

  // Single-flight per instance: Strict Mode remounts must not create a
  // second DRAFT production for the candidate.
  const initializeRef = useRef(false);

  async function initialize() {
    if (initializeRef.current) return;
    initializeRef.current = true;
    setCreationError(undefined);
    setRightsProblem(undefined);
    try {
      const created = await client.createProduction({
        candidateId,
        segment: defaultSegment,
        imageProvider,
        animationProvider,
      });
      setProduction(created);
      try {
        setProduction(
          await client.updateSetup(created.production.id, {
            rights: {
              confirmed: true,
              confirmationTextVersion: rightsConfirmationTextVersion,
            },
          }),
        );
      } catch (linkError) {
        setRightsProblem(
          linkError instanceof Error
            ? linkError.message
            : "Rights could not be confirmed for this production.",
        );
      }
    } catch (createError) {
      initializeRef.current = false;
      setCreationError(
        createError instanceof Error
          ? createError.message
          : "The production could not be created. Try again.",
      );
    }
  }

  useEffect(() => {
    void initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected || !production) return;

    setActionError(undefined);
    const problems = evaluateSourceFile(selected, maxUploadMb);
    setFile(selected);
    setSourceFacts(undefined);
    setSourceError(
      problems.length > 0
        ? sourceProblemMessages(problems, maxUploadMb).join(" ")
        : undefined,
    );
    if (problems.length > 0) return;

    const url = URL.createObjectURL(selected);
    setPreviewUrl(url);
    setUploading(true);
    try {
      const detail = await client.uploadSource(
        production.production.id,
        selected,
      );
      setProduction(detail);
      const artifact = detail.artifacts.find(
        ({ kind }) => kind === "SOURCE_VIDEO",
      );
      setSourceFacts(sourceFactsFromMetadata(artifact?.metadata));
      setSourceError(undefined);
    } catch (uploadError) {
      setSourceError(sourceErrorMessage(uploadError));
      setPreviewUrl(undefined);
    } finally {
      setUploading(false);
    }
  }

  const segmentEvaluation = evaluateSegmentDraft({
    startSeconds: Number(startInput),
    endSeconds: Number(endInput),
    sourceDurationSeconds: sourceFacts?.durationSeconds,
  });

  const rightsLinked =
    production?.production.status === "RIGHTS_CONFIRMED" ||
    production?.production.status === "QUEUED";

  const gates: GateState[] = [
    {
      done: Boolean(sourceFacts?.audioPresent),
      label: "Authorized source uploaded",
      reason: !file
        ? "Upload the authorized source MP4 to continue."
        : uploading
          ? "Uploading and probing the source…"
          : sourceError
            ? sourceError
            : sourceFacts?.audioPresent === false
              ? "The probed source has no audio track; production requires audio."
              : "The server probes the stored copy and records it as the source artifact.",
    },
    {
      done: segmentEvaluation.valid,
      label: "Segment runs 5–8 seconds inside the source",
      reason: segmentEvaluation.valid
        ? `Selected ${formatSeconds(
            segmentEvaluation.segment.startSeconds,
          )}–${formatSeconds(segmentEvaluation.segment.endSeconds)}.`
        : segmentEvaluation.problems
            .map((problem) => segmentProblemMessages[problem])
            .join(" "),
    },
    {
      done: rightsLinked,
      label: "Rights confirmed",
      reason: rightsLinked
        ? "Linked to the persisted candidate confirmation."
        : (rightsProblem ??
          "Confirm rights for this candidate before starting."),
    },
  ];

  const unmetGates = gates.filter((gate) => !gate.done);
  const allGatesPassed =
    unmetGates.length === 0 && Boolean(production) && !uploading && !starting;

  async function startProduction() {
    if (!production || !segmentEvaluation.valid || starting) return;
    setStarting(true);
    setActionError(undefined);
    try {
      const direction = creativeDirection.trim();
      await client.updateSetup(production.production.id, {
        segment: segmentEvaluation.segment,
        ...(direction ? { creativeDirection: direction } : {}),
      });
      const started = await client.start(production.production.id);
      setProduction(started);
    } catch (startError) {
      setActionError(
        startError instanceof Error
          ? startError.message
          : "Production could not be started. Try again.",
      );
    } finally {
      setStarting(false);
    }
  }

  const shownImageProvider =
    production?.production.imageProvider ?? imageProvider;
  const shownAnimationProvider =
    production?.production.animationProvider ?? animationProvider;

  if (production?.production.status === "QUEUED") {
    const queuedSegment = production.production.segment;
    return (
      <section className="studio-card" aria-labelledby="queued-title">
        <p className="eyebrow">Production setup</p>
        <h1 id="queued-title">Production queued</h1>
        <div className="success-banner" role="status">
          <span>✓</span>
          <div>
            <strong>All gates passed</strong>
            <p>
              Production {production.production.id} is queued with segment{" "}
              {formatSeconds(queuedSegment.startSeconds)}–
              {formatSeconds(queuedSegment.endSeconds)}. The local worker picks
              it up and runs every stage on this machine.
            </p>
          </div>
        </div>
        <dl className="provider-strip" aria-label="Production providers">
          <div>
            <dt>Image provider</dt>
            <dd>{humanizeProvider(production.production.imageProvider)}</dd>
          </div>
          <div>
            <dt>Animation provider</dt>
            <dd>{humanizeProvider(production.production.animationProvider)}</dd>
          </div>
        </dl>
        <p className="summary">
          Stage-by-stage monitoring opens with the job detail work. Nothing is
          published automatically — the output waits for editorial review.
        </p>
      </section>
    );
  }

  return (
    <section className="gate-layout" aria-labelledby="setup-title">
      <div className="setup-panel">
        <button className="back-button" type="button" onClick={onBack}>
          ← Rights confirmation
        </button>
        <p className="eyebrow">Production setup · 2 of 2</p>
        <h1 id="setup-title">Upload the source clip</h1>
        <p className="lede">
          {candidateCaption
            ? `Authorized production for: ${candidateCaption}`
            : "Upload the authorized clip, choose the animated segment, and start the persisted production."}
        </p>

        {creationError ? (
          <div className="error-banner" role="alert">
            <div>
              <strong>Setup could not start</strong>
              <p>{creationError}</p>
            </div>
            <button type="button" onClick={() => void initialize()}>
              Try again
            </button>
          </div>
        ) : !production ? (
          <p className="processing-message" role="status">
            Preparing the production record…
          </p>
        ) : (
          <>
            <label className="upload-field">
              <span>Authorized source clip (MP4)</span>
              <input
                type="file"
                accept="video/mp4"
                disabled={uploading || starting}
                onChange={(event) => void handleFileChange(event)}
              />
            </label>
            <strong className="upload-file-name">
              {file ? file.name : "Choose an authorized MP4"}
            </strong>

            {previewUrl && (
              <div className="preview-block">
                <video controls playsInline src={previewUrl} />
                <p className="preview-note">
                  Local preview of the selected file. The stored copy is probed
                  server-side after upload.
                </p>
              </div>
            )}

            {sourceFacts && (
              <dl className="setup-facts" aria-label="Probed source facts">
                <div>
                  <dt>Duration</dt>
                  <dd>
                    {sourceFacts.durationSeconds !== undefined
                      ? formatSeconds(sourceFacts.durationSeconds)
                      : "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt>Dimensions</dt>
                  <dd>
                    {sourceFacts.width !== undefined &&
                    sourceFacts.height !== undefined
                      ? `${sourceFacts.width} × ${sourceFacts.height}`
                      : "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt>Audio</dt>
                  <dd>
                    {sourceFacts.audioPresent === undefined
                      ? "Unknown"
                      : sourceFacts.audioPresent
                        ? "Present"
                        : "Missing"}
                  </dd>
                </div>
              </dl>
            )}

            {sourceError && (
              <div className="error-message" role="alert">
                <strong>Source rejected.</strong> {sourceError}
              </div>
            )}

            <fieldset className="segment-fields">
              <legend>Animated segment (5–8 seconds)</legend>
              <label>
                Start (seconds)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={startInput}
                  disabled={uploading || starting}
                  onChange={(event) => setStartInput(event.target.value)}
                />
              </label>
              <label>
                End (seconds)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={endInput}
                  disabled={uploading || starting}
                  onChange={(event) => setEndInput(event.target.value)}
                />
              </label>
            </fieldset>
            <p className="segment-feedback" aria-live="polite">
              {segmentEvaluation.valid
                ? `Segment ${formatSeconds(
                    segmentEvaluation.segment.startSeconds,
                  )}–${formatSeconds(
                    segmentEvaluation.segment.endSeconds,
                  )} (${formatSeconds(
                    segmentEvaluation.segment.endSeconds -
                      segmentEvaluation.segment.startSeconds,
                  )}) selected.`
                : segmentEvaluation.problems
                    .map((problem) => segmentProblemMessages[problem])
                    .join(" ")}
            </p>

            <label className="direction-field">
              <span>Creative direction (optional)</span>
              <textarea
                rows={3}
                value={creativeDirection}
                placeholder="What should the mock emphasize in this segment?"
                disabled={uploading || starting}
                onChange={(event) => setCreativeDirection(event.target.value)}
              />
            </label>
          </>
        )}
      </div>

      <aside className="setup-card">
        <dl
          className="provider-strip"
          aria-label="Configured production providers"
        >
          <div>
            <dt>Image provider</dt>
            <dd>{humanizeProvider(shownImageProvider)}</dd>
          </div>
          <div>
            <dt>Animation provider</dt>
            <dd>{humanizeProvider(shownAnimationProvider)}</dd>
          </div>
        </dl>

        <h2>Before production starts</h2>
        <ul
          className="gate-list"
          aria-label="Required before production starts"
        >
          {gates.map((gate) => (
            <li
              key={gate.label}
              className={`gate-row gate-row--${gate.done ? "done" : "todo"}`}
            >
              <span className="gate-marker" aria-hidden="true">
                {gate.done ? "✓" : "·"}
              </span>
              <div>
                <strong>{gate.label}</strong>
                <p>{gate.reason}</p>
              </div>
            </li>
          ))}
        </ul>

        {!rightsLinked && (
          <button className="secondary-button" type="button" onClick={onBack}>
            Back to rights confirmation
          </button>
        )}

        <button
          className="primary-button"
          type="button"
          onClick={() => void startProduction()}
          disabled={!allGatesPassed}
        >
          {starting ? "Starting…" : "Start production"}
        </button>
        {unmetGates.length > 0 ? (
          <p className="disabled-reason">
            Start is locked until:{" "}
            {unmetGates.map((gate) => gate.label).join("; ")}.
          </p>
        ) : (
          <p className="disabled-reason">
            Starting records the segment and queues the job atomically.
          </p>
        )}

        {actionError && (
          <div className="error-message" role="alert">
            <strong>Production did not start.</strong> {actionError}
          </div>
        )}
      </aside>
    </section>
  );
}
