import { z } from "zod";

import {
  artifactKinds,
  expectedArtifactProvider,
  outputDurationToleranceSeconds,
  productionStatuses,
  type ArtifactKind,
} from "./production";
import {
  animationProviders,
  artifactProviders,
  imageProviders,
} from "../lib/providers";

/**
 * QA Inspector report domain: a deterministic checks registry judged over
 * persisted artifact facts. The runner never probes files, calls providers,
 * or reads the clock — the server layer loads persisted rows, reduces them
 * to plain facts, and the runner returns the same report for the same facts
 * every time. It is a separate, richer subsystem from the pipeline's
 * `buildValidationReport` output gate (Smart Production owns that one);
 * nothing here feeds the worker state machine.
 */

export const qaCheckKeys = [
  "aspect-ratio",
  "audio-presence",
  "duration-window",
  "frame-preservation",
  "provider-attribution",
  "lineage-completeness",
  "download-readiness",
  "style-conformance",
  "caption-presence",
  "segment-match",
] as const;
export type QaCheckKey = (typeof qaCheckKeys)[number];

export const qaCheckStatuses = ["PASS", "WARN", "FAIL"] as const;
export type QaCheckStatus = (typeof qaCheckStatuses)[number];

/** Non-passing results declare how much the defect matters. */
export const qaSeverities = ["INFO", "WARNING", "CRITICAL"] as const;
export type QaSeverity = (typeof qaSeverities)[number];

export const qaOverallStatuses = ["PASS", "WARN", "FAIL"] as const;
export type QaOverallStatus = (typeof qaOverallStatuses)[number];

export const qaCheckLabels: Record<QaCheckKey, string> = {
  "aspect-ratio": "9:16 aspect ratio",
  "audio-presence": "Audio presence",
  "duration-window": "5–8 second duration window",
  "frame-preservation": "Frame preservation",
  "provider-attribution": "Provider attribution",
  "lineage-completeness": "Artifact lineage completeness",
  "download-readiness": "Download readiness",
  "style-conformance": "Style conformance",
  "caption-presence": "Caption presence",
  "segment-match": "Segment match",
};

/**
 * Bumped when check semantics change, so a persisted report always names
 * the runner semantics that produced it.
 */
export const qaRunnerVersion = "qa-runner-v1";

/** The demo's locked output window; productions constrain segments to it. */
export const qaDurationWindowSeconds = { min: 5, max: 8 } as const;

/** How far animation-frame duration may drift in the final mux. */
export const qaFrameDriftToleranceSeconds = outputDurationToleranceSeconds;

const scalarFactSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const qaArtifactFactSchema = z
  .object({
    id: z.string().trim().min(1),
    kind: z.enum(artifactKinds),
    provider: z.enum(artifactProviders),
    /** Live-provider request lineage; null for local artifacts. */
    providerRequestId: z.string().trim().min(1).nullable(),
    mimeType: z.string().trim().min(1),
    byteSize: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/, "SHA-256 digests are 64 hex"),
    parentArtifactIds: z.array(z.string().trim().min(1)),
    /** Whether the artifact's bytes are present in storage right now. */
    storagePresent: z.boolean(),
    /** Bounded scalar metadata persisted with the artifact row. */
    metadata: z.record(z.string(), scalarFactSchema),
  })
  .strict()
  .readonly();
export type QaArtifactFact = z.infer<typeof qaArtifactFactSchema>;

export const qaProductionFactsSchema = z
  .object({
    id: z.string().trim().min(1),
    candidateId: z.string().trim().min(1),
    status: z.enum(productionStatuses),
    imageProvider: z.enum(imageProviders),
    animationProvider: z.enum(animationProviders),
    segmentDurationMs: z.number().int().positive(),
  })
  .strict()
  .readonly();
export type QaProductionFacts = z.infer<typeof qaProductionFactsSchema>;

export const qaCaptionFactsSchema = z
  .object({
    /** The candidate's trend caption; ships with the download package. */
    caption: z.string(),
    /** Director-generated social caption; null when no treatment exists. */
    socialCaption: z.string().nullable(),
  })
  .strict()
  .readonly();
export type QaCaptionFacts = z.infer<typeof qaCaptionFactsSchema>;

export const qaReportInputSchema = z
  .object({
    production: qaProductionFactsSchema,
    artifacts: z.array(qaArtifactFactSchema),
    captions: qaCaptionFactsSchema,
  })
  .strict()
  .readonly();
export type QaReportInput = z.infer<typeof qaReportInputSchema>;

export interface QaCheckResult {
  readonly key: QaCheckKey;
  readonly label: string;
  readonly status: QaCheckStatus;
  /** Absent on PASS; declared importance of a WARN or FAIL. */
  readonly severity?: QaSeverity;
  /** Absent on PASS; the concrete next step that clears the finding. */
  readonly remediation?: string;
  /** Observed-fact summary; never empty. */
  readonly detail: string;
}

export interface QaReportDraft {
  readonly runnerVersion: string;
  readonly overallStatus: QaOverallStatus;
  /** 0–100: passes count fully, warnings count half, failures count zero. */
  readonly score: number;
  readonly checks: readonly QaCheckResult[];
}

function metadataNumber(
  metadata: QaArtifactFact["metadata"],
  key: string,
): number | null {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metadataBoolean(
  metadata: QaArtifactFact["metadata"],
  key: string,
): boolean | null {
  const value = metadata[key];
  return typeof value === "boolean" ? value : null;
}

function metadataString(
  metadata: QaArtifactFact["metadata"],
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function findArtifact(
  facts: QaReportInput,
  kind: ArtifactKind,
): QaArtifactFact | undefined {
  return facts.artifacts.find((artifact) => artifact.kind === kind);
}

/**
 * The in-flight guard: before the pipeline produces the final video, output
 * checks cannot judge quality, so they defer with an INFO warning instead of
 * failing a production that has not finished yet.
 */
function deferredFinding(key: QaCheckKey, message: string): QaCheckResult {
  return finding(
    key,
    "WARN",
    "INFO",
    "Run the pipeline to produce the final video, then inspect again.",
    message,
  );
}

function pass(key: QaCheckKey, detail: string): QaCheckResult {
  return { key, label: qaCheckLabels[key], status: "PASS", detail };
}

function finding(
  key: QaCheckKey,
  status: Extract<QaCheckStatus, "WARN" | "FAIL">,
  severity: QaSeverity,
  remediation: string,
  detail: string,
): QaCheckResult {
  return {
    key,
    label: qaCheckLabels[key],
    status,
    severity,
    remediation,
    detail,
  };
}

/** 1. The final output is 9:16 vertical — the demo's hard format floor. */
function checkAspectRatio(facts: QaReportInput): QaCheckResult {
  const final = findArtifact(facts, "FINAL_VIDEO");
  if (!final) {
    return deferredFinding(
      "aspect-ratio",
      "No FINAL_VIDEO artifact exists to measure yet.",
    );
  }
  const width = metadataNumber(final.metadata, "width");
  const height = metadataNumber(final.metadata, "height");
  if (width === null || height === null || width <= 0 || height <= 0) {
    return finding(
      "aspect-ratio",
      "FAIL",
      "CRITICAL",
      "Re-run MUX_AND_NORMALIZE so FFprobe records the output dimensions.",
      "The final video does not report usable pixel dimensions.",
    );
  }
  if (width * 16 !== height * 9) {
    return finding(
      "aspect-ratio",
      "FAIL",
      "CRITICAL",
      "Re-run MUX_AND_NORMALIZE to render 9:16 vertical output without stretching.",
      `Final output is ${width}x${height}, which is not 9:16 vertical.`,
    );
  }
  return pass(
    "aspect-ratio",
    `Final output is ${width}x${height} (9:16 vertical).`,
  );
}

/** 2. The final output preserves an audio stream (original authorized audio). */
function checkAudioPresence(facts: QaReportInput): QaCheckResult {
  const final = findArtifact(facts, "FINAL_VIDEO");
  if (!final) {
    return deferredFinding(
      "audio-presence",
      "No FINAL_VIDEO artifact exists to inspect for audio.",
    );
  }
  const audioPresent = metadataBoolean(final.metadata, "audioPresent");
  if (audioPresent !== true) {
    return finding(
      "audio-presence",
      "FAIL",
      "CRITICAL",
      "Re-run MUX_AND_NORMALIZE with the extracted authorized audio track.",
      "The final output has no audio stream; original authorized audio must be preserved.",
    );
  }
  return pass("audio-presence", "Final output carries an audio stream.");
}

/** 3. The final output duration sits inside the demo's 5–8 second window. */
function checkDurationWindow(facts: QaReportInput): QaCheckResult {
  const final = findArtifact(facts, "FINAL_VIDEO");
  if (!final) {
    return deferredFinding(
      "duration-window",
      "No FINAL_VIDEO artifact exists to time yet.",
    );
  }
  const duration = metadataNumber(final.metadata, "durationSeconds");
  if (duration === null || duration <= 0) {
    return finding(
      "duration-window",
      "FAIL",
      "CRITICAL",
      "Re-run MUX_AND_NORMALIZE so FFprobe records the output duration.",
      "The final video does not report a usable duration.",
    );
  }
  const { min, max } = qaDurationWindowSeconds;
  if (duration < min || duration > max) {
    return finding(
      "duration-window",
      "FAIL",
      "CRITICAL",
      "Re-cut the segment so the finished output stays inside the 5–8 second demo window.",
      `Final output runs ${duration.toFixed(3)}s, outside the ${min}–${max}s demo window.`,
    );
  }
  return pass(
    "duration-window",
    `Final output runs ${duration.toFixed(3)}s, inside the ${min}–${max}s demo window.`,
  );
}

/**
 * 4. Animation frames survive the mux: the final video keeps a video stream
 * and runs the same duration as the silent animation it was muxed from.
 */
function checkFramePreservation(facts: QaReportInput): QaCheckResult {
  const final = findArtifact(facts, "FINAL_VIDEO");
  const animation = findArtifact(facts, "SILENT_ANIMATION");
  if (!final || !animation) {
    return deferredFinding(
      "frame-preservation",
      "Frame preservation is judged once the silent animation and final video exist.",
    );
  }
  const videoCodec = metadataString(final.metadata, "videoCodec");
  if (videoCodec === null) {
    return finding(
      "frame-preservation",
      "FAIL",
      "CRITICAL",
      "Re-run MUX_AND_NORMALIZE so the final output carries a playable video stream.",
      "The final output does not report a video stream; animation frames were lost.",
    );
  }
  const finalDuration = metadataNumber(final.metadata, "durationSeconds");
  const animationDuration = metadataNumber(
    animation.metadata,
    "durationSeconds",
  );
  if (finalDuration === null || animationDuration === null) {
    return finding(
      "frame-preservation",
      "FAIL",
      "WARNING",
      "Re-run MUX_AND_NORMALIZE so both videos report probe durations.",
      "Frame preservation cannot be compared: the final video or silent animation lacks a probe duration.",
    );
  }
  const drift = Math.abs(finalDuration - animationDuration);
  if (drift > qaFrameDriftToleranceSeconds) {
    return finding(
      "frame-preservation",
      "FAIL",
      "WARNING",
      "Re-run MUX_AND_NORMALIZE so the animation frames survive the mux unchanged.",
      `Final video runs ${finalDuration.toFixed(3)}s against ${animationDuration.toFixed(3)}s of animation frames (${drift.toFixed(3)}s drift).`,
    );
  }
  return pass(
    "frame-preservation",
    `Animation frames carried into the final video within ${qaFrameDriftToleranceSeconds}s (${drift.toFixed(3)}s drift).`,
  );
}

/**
 * 5. Every artifact names the provider that actually produced it, and
 * live-generated artifacts carry their provider request id.
 */
function checkProviderAttribution(facts: QaReportInput): QaCheckResult {
  const mismatches: string[] = [];
  const missingRequestIds: string[] = [];
  for (const artifact of facts.artifacts) {
    const expected = expectedArtifactProvider(artifact.kind, {
      imageProvider: facts.production.imageProvider,
      animationProvider: facts.production.animationProvider,
    });
    if (artifact.provider !== expected) {
      mismatches.push(
        `${artifact.kind} recorded ${artifact.provider}, expected ${expected}`,
      );
      continue;
    }
    const liveProduced =
      artifact.provider === "OPENAI" || artifact.provider === "RUNWAY";
    if (liveProduced && artifact.providerRequestId === null) {
      missingRequestIds.push(artifact.kind);
    }
  }
  if (mismatches.length > 0) {
    return finding(
      "provider-attribution",
      "FAIL",
      "CRITICAL",
      "Re-run the producing stage with the production's selected providers so attribution stays honest.",
      `Provider attribution is dishonest: ${mismatches.join("; ")}.`,
    );
  }
  if (missingRequestIds.length > 0) {
    return finding(
      "provider-attribution",
      "FAIL",
      "WARNING",
      "Persist the provider request id on live-generated artifacts so retries reconcile instead of regenerating.",
      `Live-generated artifacts are missing provider request ids: ${missingRequestIds.join(", ")}.`,
    );
  }
  return pass(
    "provider-attribution",
    `All ${facts.artifacts.length} artifacts carry their expected providers.`,
  );
}

/**
 * 6. A complete production persists every artifact kind, and every parent
 * reference resolves to a persisted artifact.
 */
function checkLineageCompleteness(facts: QaReportInput): QaCheckResult {
  const presentKinds = new Set(
    facts.artifacts.map((artifact) => artifact.kind),
  );
  const artifactIds = new Set(facts.artifacts.map((artifact) => artifact.id));
  const danglingParents = facts.artifacts.flatMap((artifact) =>
    artifact.parentArtifactIds
      .filter((parentId) => !artifactIds.has(parentId))
      .map((parentId) => `${artifact.kind} → ${parentId}`),
  );
  if (danglingParents.length > 0) {
    return finding(
      "lineage-completeness",
      "FAIL",
      "CRITICAL",
      "Persist the full parent chain for every artifact so lineage stays resolvable.",
      `Artifact lineage references missing parents: ${danglingParents.join(", ")}.`,
    );
  }

  const missingKinds = artifactKinds.filter((kind) => !presentKinds.has(kind));
  if (missingKinds.length === 0) {
    return pass(
      "lineage-completeness",
      `All ${artifactKinds.length} lineage stages are persisted with resolvable parents.`,
    );
  }
  if (facts.production.status === "COMPLETE") {
    return finding(
      "lineage-completeness",
      "FAIL",
      "CRITICAL",
      "Re-run the pipeline; a complete production must persist every artifact kind.",
      `Production is COMPLETE but lineage is missing: ${missingKinds.join(", ")}.`,
    );
  }
  return finding(
    "lineage-completeness",
    "WARN",
    "INFO",
    "Run the pipeline to completion so the full artifact lineage persists.",
    `Production is ${facts.production.status}; lineage is missing ${missingKinds.join(", ")}.`,
  );
}

/** 7. The final video's bytes exist, are non-empty, and are downloadable. */
function checkDownloadReadiness(facts: QaReportInput): QaCheckResult {
  const final = findArtifact(facts, "FINAL_VIDEO");
  if (!final) {
    return deferredFinding(
      "download-readiness",
      "No FINAL_VIDEO artifact exists to download yet.",
    );
  }
  if (!final.storagePresent) {
    return finding(
      "download-readiness",
      "FAIL",
      "CRITICAL",
      "Restore the final video's bytes in artifact storage (or re-run the pipeline) before offering the download.",
      "The final video's bytes are missing from artifact storage.",
    );
  }
  if (final.byteSize <= 0) {
    return finding(
      "download-readiness",
      "FAIL",
      "CRITICAL",
      "Re-run the pipeline; a zero-byte final video cannot be downloaded.",
      "The final video is empty (0 bytes).",
    );
  }
  if (final.mimeType !== "video/mp4") {
    return finding(
      "download-readiness",
      "FAIL",
      "CRITICAL",
      "Re-run MUX_AND_NORMALIZE to produce a downloadable MP4 final video.",
      `Final video is ${final.mimeType}, not the downloadable video/mp4 package.`,
    );
  }
  return pass(
    "download-readiness",
    `Final video (${final.byteSize} bytes, ${final.mimeType}) is stored and downloadable.`,
  );
}

/** 8. The styled frame's recorded conformance facts match the production. */
function checkStyleConformance(facts: QaReportInput): QaCheckResult {
  const styled = findArtifact(facts, "STYLED_FRAME");
  if (!styled) {
    if (facts.production.status === "COMPLETE") {
      return finding(
        "style-conformance",
        "FAIL",
        "CRITICAL",
        "Re-run the pipeline; a complete production must contain a styled frame.",
        "Production is COMPLETE but no STYLED_FRAME artifact exists.",
      );
    }
    return finding(
      "style-conformance",
      "WARN",
      "INFO",
      "Run the pipeline to produce the styled frame, then inspect again.",
      "No STYLED_FRAME artifact exists to judge style conformance yet.",
    );
  }
  const styledBy = metadataString(styled.metadata, "styledBy");
  if (styledBy === null) {
    return finding(
      "style-conformance",
      "FAIL",
      "CRITICAL",
      "Re-run the style stage so the styled frame records who styled it.",
      "The styled frame does not record its styling provider.",
    );
  }
  if (styledBy !== facts.production.imageProvider) {
    return finding(
      "style-conformance",
      "FAIL",
      "CRITICAL",
      "Re-run the style stage with the production's selected image provider so the disclosure stays honest.",
      `Styled frame records styledBy "${styledBy}" but the production selected image provider ${facts.production.imageProvider}.`,
    );
  }
  const styleVersion = metadataString(styled.metadata, "styleVersion");
  if (styleVersion === null) {
    return finding(
      "style-conformance",
      "WARN",
      "WARNING",
      "Record a styleVersion on the styled frame so conformance is auditable.",
      `The styled frame does not declare a style version (styled by ${styledBy}).`,
    );
  }
  return pass(
    "style-conformance",
    `Styled frame declares ${styleVersion}, consistent with image provider ${styledBy}.`,
  );
}

/** 9. The download package has captions: candidate caption + social caption. */
function checkCaptionPresence(facts: QaReportInput): QaCheckResult {
  if (facts.captions.caption.trim().length === 0) {
    return finding(
      "caption-presence",
      "FAIL",
      "WARNING",
      "Add the trend caption to the candidate record so the download package ships with one.",
      "The candidate has no caption; the download package would ship without one.",
    );
  }
  if (facts.captions.socialCaption === null) {
    return finding(
      "caption-presence",
      "WARN",
      "WARNING",
      "Ask the YardToonz Director for a treatment so the package gets a generated social caption.",
      "No Director treatment exists; the download package falls back to the candidate caption alone.",
    );
  }
  return pass(
    "caption-presence",
    "Caption package ready: candidate caption plus Director social caption.",
  );
}

/** 10. The final output duration matches the selected segment within tolerance. */
function checkSegmentMatch(facts: QaReportInput): QaCheckResult {
  const final = findArtifact(facts, "FINAL_VIDEO");
  if (!final) {
    return deferredFinding(
      "segment-match",
      "No FINAL_VIDEO artifact exists to compare against the segment.",
    );
  }
  const duration = metadataNumber(final.metadata, "durationSeconds");
  const segmentSeconds = facts.production.segmentDurationMs / 1000;
  if (duration === null) {
    return finding(
      "segment-match",
      "FAIL",
      "CRITICAL",
      "Re-run MUX_AND_NORMALIZE so FFprobe records the output duration.",
      "The final video does not report a duration to compare with the selected segment.",
    );
  }
  const drift = Math.abs(duration - segmentSeconds);
  if (drift > outputDurationToleranceSeconds) {
    return finding(
      "segment-match",
      "FAIL",
      "CRITICAL",
      "Re-run MUX_AND_NORMALIZE so the output duration matches the selected segment.",
      `Final output runs ${duration.toFixed(3)}s against the selected ${segmentSeconds.toFixed(3)}s segment (tolerance ${outputDurationToleranceSeconds}s).`,
    );
  }
  return pass(
    "segment-match",
    `Final output matches the selected ${segmentSeconds.toFixed(3)}s segment within ${outputDurationToleranceSeconds}s.`,
  );
}

/**
 * The checks registry: stable key order, one pure function per key. The
 * runner maps the registry so a report always lists checks in this order.
 */
const qaChecksRegistry: Record<
  QaCheckKey,
  (facts: QaReportInput) => QaCheckResult
> = {
  "aspect-ratio": checkAspectRatio,
  "audio-presence": checkAudioPresence,
  "duration-window": checkDurationWindow,
  "frame-preservation": checkFramePreservation,
  "provider-attribution": checkProviderAttribution,
  "lineage-completeness": checkLineageCompleteness,
  "download-readiness": checkDownloadReadiness,
  "style-conformance": checkStyleConformance,
  "caption-presence": checkCaptionPresence,
  "segment-match": checkSegmentMatch,
};

/** Deterministic aggregate: FAIL dominates WARN dominates PASS. */
function overallStatus(checks: readonly QaCheckResult[]): QaOverallStatus {
  if (checks.some((check) => check.status === "FAIL")) return "FAIL";
  if (checks.some((check) => check.status === "WARN")) return "WARN";
  return "PASS";
}

function reportScore(checks: readonly QaCheckResult[]): number {
  const total = checks.length;
  const earned = checks.reduce(
    (sum, check) =>
      sum + (check.status === "PASS" ? 1 : check.status === "WARN" ? 0.5 : 0),
    0,
  );
  return Math.round((earned / total) * 100);
}

/**
 * Run the registry over persisted facts. Pure and deterministic: the same
 * input yields the same draft every time — no clock, no randomness, no I/O.
 */
export function runQaReport(input: QaReportInput): QaReportDraft {
  const facts = qaReportInputSchema.parse(input);
  const checks = qaCheckKeys.map((key) => qaChecksRegistry[key](facts));
  return Object.freeze({
    runnerVersion: qaRunnerVersion,
    overallStatus: overallStatus(checks),
    score: reportScore(checks),
    checks: Object.freeze(checks),
  });
}
