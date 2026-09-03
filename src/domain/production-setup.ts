import { segmentSelectionSchema, type SegmentSelection } from "./production";

/**
 * Pure setup-screen rules mirrored from the production API so the UI can
 * explain every unmet condition before a request is sent. The server remains
 * authoritative; these validators only decide what the user sees.
 */

export const minSegmentSeconds = 5;
export const maxSegmentSeconds = 8;

/**
 * The persisted rights-confirmation text version recorded by the candidate
 * rights screen; production rights link to the same confirmation text.
 */
export const rightsConfirmationTextVersion = "2026-09-03";

export type SegmentDraftProblem =
  | "END_NOT_AFTER_START"
  | "SEGMENT_TOO_SHORT"
  | "SEGMENT_TOO_LONG"
  | "EXCEEDS_SOURCE";

export type SegmentDraftEvaluation =
  | { valid: true; segment: SegmentSelection }
  | { valid: false; problems: SegmentDraftProblem[] };

export const segmentProblemMessages: Record<SegmentDraftProblem, string> = {
  END_NOT_AFTER_START: "The segment end must come after its start.",
  SEGMENT_TOO_SHORT: `The segment must be at least ${minSegmentSeconds} seconds long.`,
  SEGMENT_TOO_LONG: `The segment can be at most ${maxSegmentSeconds} seconds long.`,
  EXCEEDS_SOURCE: "The segment must end inside the uploaded source video.",
};

/**
 * Validates start/end inputs against the 5–8 second rule and, once the
 * source is probed, against the source duration. Inputs may be NaN when a
 * field is blank; every failure mode is reported so nothing is hidden.
 */
export function evaluateSegmentDraft(input: {
  startSeconds: number;
  endSeconds: number;
  sourceDurationSeconds?: number;
}): SegmentDraftEvaluation {
  const { startSeconds, endSeconds, sourceDurationSeconds } = input;
  const inputsAreNumbers =
    Number.isFinite(startSeconds) && Number.isFinite(endSeconds);

  if (!inputsAreNumbers || startSeconds < 0 || endSeconds <= startSeconds) {
    return { valid: false, problems: ["END_NOT_AFTER_START"] };
  }

  const problems: SegmentDraftProblem[] = [];
  const duration = endSeconds - startSeconds;
  if (duration < minSegmentSeconds - 0.001) problems.push("SEGMENT_TOO_SHORT");
  if (duration > maxSegmentSeconds + 0.001) problems.push("SEGMENT_TOO_LONG");
  if (
    sourceDurationSeconds !== undefined &&
    Number.isFinite(sourceDurationSeconds) &&
    endSeconds > sourceDurationSeconds + 0.001
  ) {
    problems.push("EXCEEDS_SOURCE");
  }

  if (problems.length > 0) return { valid: false, problems };

  const parsed = segmentSelectionSchema.safeParse({
    startSeconds,
    endSeconds,
    durationSeconds: duration,
  });
  return parsed.success
    ? { valid: true, segment: parsed.data }
    : { valid: false, problems: ["END_NOT_AFTER_START"] };
}

export type SourceFileProblem = "NOT_MP4" | "EMPTY_FILE" | "TOO_LARGE";

/** Mirrors the server's MP4 content-type and size checks before uploading. */
export function evaluateSourceFile(
  file: Pick<File, "type" | "size">,
  maxUploadMb: number,
): SourceFileProblem[] {
  const problems: SourceFileProblem[] = [];
  if (file.size <= 0) problems.push("EMPTY_FILE");
  const contentType = file.type.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "video/mp4") problems.push("NOT_MP4");
  if (file.size > maxUploadMb * 1024 * 1024) problems.push("TOO_LARGE");
  return problems;
}

export function sourceProblemMessages(
  problems: readonly SourceFileProblem[],
  maxUploadMb: number,
): string[] {
  return problems.map((problem) => {
    switch (problem) {
      case "NOT_MP4":
        return "The source must be an MP4 video file.";
      case "EMPTY_FILE":
        return "The selected file is empty.";
      case "TOO_LARGE":
        return `The source must be smaller than ${maxUploadMb} MB.`;
    }
  });
}

export interface SourceVideoFacts {
  durationSeconds?: number;
  audioPresent?: boolean;
  width?: number;
  height?: number;
}

/**
 * Reads the probed source facts out of the uploaded artifact's metadata.
 * Unknown or mistyped entries stay undefined instead of guessing.
 */
export function sourceFactsFromMetadata(
  metadata: Record<string, string | number | boolean | null> | undefined,
): SourceVideoFacts {
  if (!metadata) return {};
  const duration = metadata.durationSeconds;
  const width = metadata.width;
  const height = metadata.height;
  const audio = metadata.audioPresent;
  return {
    durationSeconds: typeof duration === "number" ? duration : undefined,
    audioPresent: typeof audio === "boolean" ? audio : undefined,
    width: typeof width === "number" ? width : undefined,
    height: typeof height === "number" ? height : undefined,
  };
}
