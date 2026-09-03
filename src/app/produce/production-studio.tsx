"use client";

import { useState, type FormEvent } from "react";
import { z } from "zod";

const productionResultSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("COMPLETE"),
  imageProvider: z.literal("MOCK"),
  animationProvider: z.literal("MOCK"),
  segmentDuration: z.number(),
  width: z.number(),
  height: z.number(),
  videoCodec: z.string(),
  audioPresent: z.literal(true),
  artifacts: z.object({
    source: z.string(),
    clip: z.string(),
    audio: z.string(),
    keyframe: z.string(),
    "styled-frame": z.string(),
    animation: z.string(),
    final: z.string(),
  }),
});

const apiErrorSchema = z.object({
  error: z.object({ message: z.string() }),
});

const completedStages = [
  "Source ingested",
  "Clip and audio extracted",
  "Keyframe selected",
  "Mock clay-style frame created",
  "Frame animated",
  "Audio restored and output normalized",
  "Final validation complete",
];

type ProductionResult = z.infer<typeof productionResultSchema>;

async function submitProduction(
  form: HTMLFormElement,
): Promise<ProductionResult> {
  const response = await fetch("/api/productions", {
    method: "POST",
    body: new FormData(form),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const apiError = apiErrorSchema.safeParse(payload);
    throw new Error(
      apiError.success
        ? apiError.data.error.message
        : "Could not create the cartoon.",
    );
  }
  return productionResultSchema.parse(payload);
}

export function ProductionStudio() {
  const [fileName, setFileName] = useState<string>();
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "processing" | "complete" | "error"
  >("idle");
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<ProductionResult>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("processing");
    setError(undefined);
    try {
      const production = await submitProduction(event.currentTarget);
      setResult(production);
      setStatus("complete");
    } catch (submissionError: unknown) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Could not create the cartoon.",
      );
      setStatus("error");
    }
  }

  if (result && status === "complete") {
    return (
      <section className="studio-card" aria-labelledby="output-title">
        <p className="eyebrow">Cartoon ready</p>
        <h1 id="output-title">Preview your mock</h1>
        <div className="output-grid">
          <video controls playsInline src={result.artifacts.final} />
          <div>
            <p className="mock-label">Deterministic local clay-style mock</p>
            <dl className="facts-grid">
              <div>
                <dt>Duration</dt>
                <dd>{result.segmentDuration}s</dd>
              </div>
              <div>
                <dt>Frame</dt>
                <dd>
                  {result.width} × {result.height}
                </dd>
              </div>
              <div>
                <dt>Video</dt>
                <dd>{result.videoCodec.toUpperCase()}</dd>
              </div>
              <div>
                <dt>Audio</dt>
                <dd>{result.audioPresent ? "Restored" : "Missing"}</dd>
              </div>
              <div>
                <dt>Image provider</dt>
                <dd>{result.imageProvider}</dd>
              </div>
              <div>
                <dt>Animation provider</dt>
                <dd>{result.animationProvider}</dd>
              </div>
            </dl>
            <ol className="stage-list">
              {completedStages.map((stage) => (
                <li key={stage}>
                  <span>Complete</span>
                  {stage}
                </li>
              ))}
            </ol>
            <div className="action-row">
              <a
                className="primary-action"
                href={`${result.artifacts.final}?download=1`}
              >
                Download MP4
              </a>
              <button
                type="button"
                className="secondary-action"
                onClick={() => {
                  setResult(undefined);
                  setStatus("idle");
                }}
              >
                Create another
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="studio-card" aria-labelledby="studio-title">
      <p className="eyebrow">Production studio</p>
      <h1 id="studio-title">Turn one clip into a cartoon</h1>
      <p className="summary">
        Upload an authorized MP4 with audio. The local mock pipeline extracts
        six seconds, creates a clay-inspired frame, animates it, and restores
        the original audio.
      </p>
      <form className="production-form" onSubmit={handleSubmit}>
        <label className="upload-field">
          <span>Source MP4</span>
          <input
            name="source"
            type="file"
            accept="video/mp4"
            required
            onChange={(event) => setFileName(event.target.files?.[0]?.name)}
          />
          <strong>{fileName ?? "Choose a video"}</strong>
        </label>
        <input type="hidden" name="segmentStart" value="0" />
        <input type="hidden" name="segmentDuration" value="6" />
        <label className="rights-field">
          <input
            name="rightsConfirmed"
            type="checkbox"
            value="true"
            checked={rightsConfirmed}
            onChange={(event) => setRightsConfirmed(event.target.checked)}
          />
          <span>
            I confirm Yard Toonz is authorized to use this source video and
            selected audio.
          </span>
        </label>
        <div className="provider-note">
          <span>Image provider: MOCK</span>
          <span>Animation provider: MOCK</span>
        </div>
        {status === "error" && (
          <div className="error-message" role="alert">
            <strong>Production failed.</strong> {error} Choose another MP4 and
            try again.
          </div>
        )}
        {status === "processing" && (
          <div className="processing-message" role="status">
            Creating the mock cartoon with local FFmpeg. This can take a moment.
          </div>
        )}
        <button
          className="primary-action"
          type="submit"
          disabled={!fileName || !rightsConfirmed || status === "processing"}
        >
          {status === "processing" ? "Creating cartoon…" : "Create cartoon"}
        </button>
        {!rightsConfirmed && (
          <p className="form-hint">
            Confirm source rights to enable production.
          </p>
        )}
      </form>
    </section>
  );
}
