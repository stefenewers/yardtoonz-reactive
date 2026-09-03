import { readFile } from "node:fs/promises";

import type { ArtifactStore } from "@/lib/artifact-store";
import {
  classifyRunwayTask,
  RunwayAnimationError,
  type RunwayTaskOutcome,
  type RunwayTransport,
} from "@/lib/runway";
import {
  getArtifactStorageKey,
  probeMediaFile,
  requireUpstream,
  type StageExecutionResult,
  type StageExecutor,
  type StageExecutorContext,
  type StageOutputArtifact,
} from "./pipeline";

/**
 * Runway-backed ANIMATE_IMAGE stage (amendment art_2yKin00n): the styled
 * frame is submitted as one image-to-video generation whose outcome is
 * tracked by provider request ID. Retry safety rules baked into this
 * executor:
 * - Reconcile by request ID before any retry: while a prior request could
 *   exist, its remote state is queried before anything new is created.
 * - Unknown outcomes (transport errors, unparseable or unrecognized
 *   responses, exhausted poll budget) never retry blindly — the stage fails
 *   deterministically with the request ID persisted for the next attempt.
 * - Polling is bounded; a task that never reaches a terminal state within
 *   the budget is an unknown outcome, not a loop.
 */

export interface RunwayStageConfig {
  readonly apiKey: string;
  readonly model: string;
}

/**
 * Fails fast when RUNWAY is selected without valid credentials. The parsed
 * environment already enforces this at job creation; this guards workers
 * whose environment changed after a production was queued.
 */
export function resolveRunwayStageConfig(environment: {
  RUNWAY_API_KEY?: string;
  RUNWAY_MODEL?: string;
}): RunwayStageConfig {
  if (!environment.RUNWAY_API_KEY || !environment.RUNWAY_MODEL) {
    throw new RunwayAnimationError(
      "PROVIDER_REQUEST_FAILED",
      "RUNWAY_API_KEY and RUNWAY_MODEL are required for ANIMATION_PROVIDER=RUNWAY",
    );
  }
  return {
    apiKey: environment.RUNWAY_API_KEY,
    model: environment.RUNWAY_MODEL,
  };
}

export interface RunwayStageOptions {
  readonly transport: RunwayTransport;
  readonly config: RunwayStageConfig;
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
}

const defaultPollIntervalMs = 5_000;
const defaultMaxPolls = 60;

/** Stable, honest disclosure metadata for a provider-produced animation. */
const runwayMotionLabel = "provider-image-to-video";

type ReconciledPriorRequest =
  | { readonly type: "PROVEN_TERMINAL" }
  | { readonly type: "STILL_RUNNING"; readonly requestId: string }
  | { readonly type: "SUCCEEDED"; readonly outputUrl: string };

class PriorRequestMissingError extends Error {}

async function reconcilePriorRequest(
  transport: RunwayTransport,
  requestId: string,
): Promise<ReconciledPriorRequest> {
  try {
    const snapshot = await transport.getTask(requestId);
    return toReconciled(classifyRunwayTask(snapshot));
  } catch (error) {
    if (
      error instanceof RunwayAnimationError &&
      error.code === "PROVIDER_REQUEST_FAILED"
    ) {
      // 404: the provider proves no such task exists, so generating a new
      // request cannot duplicate work.
      throw new PriorRequestMissingError();
    }
    if (error instanceof RunwayAnimationError) {
      throw error;
    }
    // An inconclusive probe is not proof of anything: surface an unknown
    // outcome anchored to the same request ID so the next attempt reconciles
    // it again instead of regenerating.
    throw new RunwayAnimationError(
      "PROVIDER_UNKNOWN_OUTCOME",
      "Reconciling the prior provider request failed; refusing to regenerate without a proven outcome.",
      requestId,
    );
  }
}

function toReconciled(outcome: RunwayTaskOutcome): ReconciledPriorRequest {
  switch (outcome.kind) {
    case "SUCCEEDED":
      return { type: "SUCCEEDED", outputUrl: outcome.outputUrl };
    case "IN_PROGRESS":
      return { type: "STILL_RUNNING", requestId: outcome.requestId };
    case "FAILED":
    case "CANCELLED":
      return { type: "PROVEN_TERMINAL" };
    case "UNKNOWN":
      throw new RunwayAnimationError(
        "PROVIDER_UNKNOWN_OUTCOME",
        `Prior provider request could not be reconciled: ${outcome.detail}`,
        outcome.requestId,
      );
  }
}

async function readStyledFrame(
  store: ArtifactStore,
  storageKey: string,
): Promise<Uint8Array> {
  return new Uint8Array(await readFile(await store.resolve(storageKey)));
}

export function createRunwayAnimationStageExecutor(
  options: RunwayStageOptions,
): StageExecutor {
  const {
    transport,
    config,
    pollIntervalMs = defaultPollIntervalMs,
    maxPolls = defaultMaxPolls,
  } = options;

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  async function fetchOutputArtifact(
    context: StageExecutorContext,
    requestId: string,
    outputUrl: string,
  ): Promise<StageOutputArtifact> {
    let bytes: Uint8Array;
    try {
      bytes = await transport.downloadOutput(outputUrl);
    } catch (error) {
      if (error instanceof RunwayAnimationError) throw error;
      throw new RunwayAnimationError(
        "PROVIDER_UNKNOWN_OUTCOME",
        "Runway output download failed",
        requestId,
      );
    }

    const storageKey = getArtifactStorageKey(
      context.productionId,
      "SILENT_ANIMATION",
    );
    const stored = await context.store.save({
      bytes,
      storageKey,
      mimeType: "video/mp4",
    });
    const probe = await probeMediaFile(await context.store.resolve(storageKey));
    const video = probe.streams.find((stream) => stream.codec_type === "video");

    return {
      kind: "SILENT_ANIMATION",
      storageKey,
      mimeType: "video/mp4",
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      providerRequestId: requestId,
      metadata: {
        animatedBy: "RUNWAY",
        model: config.model,
        providerRequestId: requestId,
        motion: runwayMotionLabel,
        durationSeconds: probe.format.duration,
        width: video?.width ?? null,
        height: video?.height ?? null,
        videoCodec: video?.codec_name ?? null,
        audioPresent: false,
      },
    };
  }

  async function pollUntilTerminal(
    context: StageExecutorContext,
    requestId: string,
  ): Promise<StageExecutionResult> {
    for (let poll = 1; poll <= maxPolls; poll += 1) {
      let outcome: RunwayTaskOutcome;
      try {
        outcome = classifyRunwayTask(await transport.getTask(requestId));
      } catch (error) {
        if (error instanceof RunwayAnimationError) throw error;
        // Transport-level failure mid-poll: the task's real state is
        // unknown, so retrying blind is forbidden. Fail and reconcile later.
        throw new RunwayAnimationError(
          "PROVIDER_UNKNOWN_OUTCOME",
          "Runway task polling failed",
          requestId,
          { cause: error },
        );
      }

      switch (outcome.kind) {
        case "SUCCEEDED":
          return {
            artifacts: [
              await fetchOutputArtifact(context, requestId, outcome.outputUrl),
            ],
          };
        case "FAILED":
          throw new RunwayAnimationError(
            "PROVIDER_REQUEST_FAILED",
            `Runway generation failed${outcome.reason ? `: ${outcome.reason}` : ""}`,
            requestId,
          );
        case "CANCELLED":
          throw new RunwayAnimationError(
            "PROVIDER_REQUEST_FAILED",
            "Runway generation was cancelled",
            requestId,
          );
        case "UNKNOWN":
          throw new RunwayAnimationError(
            "PROVIDER_UNKNOWN_OUTCOME",
            `Runway task state is unrecognizable: ${outcome.detail}`,
            requestId,
          );
        case "IN_PROGRESS":
          if (poll < maxPolls) await sleep(pollIntervalMs);
          break;
      }
    }
    // Bounded poll budget exhausted while the task stays non-terminal.
    throw new RunwayAnimationError(
      "PROVIDER_UNKNOWN_OUTCOME",
      `Runway task did not finish within ${maxPolls} polls`,
      requestId,
    );
  }

  return async (context: StageExecutorContext) => {
    const styledFrame = requireUpstream(context, "STYLED_FRAME");
    const imageBytes = await readStyledFrame(
      context.store,
      styledFrame.storageKey,
    );

    const priorRequestId = context.priorProviderRequestId;
    if (priorRequestId) {
      try {
        const reconciled = await reconcilePriorRequest(
          transport,
          priorRequestId,
        );
        if (reconciled.type === "SUCCEEDED") {
          // The prior attempt already produced usable media: finish it
          // instead of generating again.
          return {
            artifacts: [
              await fetchOutputArtifact(
                context,
                priorRequestId,
                reconciled.outputUrl,
              ),
            ],
          };
        }
        if (reconciled.type === "STILL_RUNNING") {
          return await pollUntilTerminal(context, reconciled.requestId);
        }
        // PROVEN_TERMINAL: fall through to one fresh generation.
      } catch (error) {
        if (error instanceof PriorRequestMissingError) {
          // Fall through to one fresh generation.
        } else {
          throw error;
        }
      }
    }

    let requestId: string;
    try {
      requestId = await transport.createAnimationTask({
        imageBytes,
        imageMimeType: "image/png",
        model: config.model,
        durationSeconds: context.segment.durationMs / 1000,
        // The persisted treatment's motion prompt is the actual motion
        // instruction for this generation; the operator's creative
        // direction and omission are the fallbacks when there is none.
        promptText:
          context.motionPrompt?.trim() ||
          context.creativeDirection?.trim() ||
          undefined,
      });
    } catch (error) {
      if (error instanceof RunwayAnimationError) throw error;
      // Creation may or may not have reached the provider: the outcome is
      // unknown, so a blind re-submission is forbidden.
      throw new RunwayAnimationError(
        "PROVIDER_UNKNOWN_OUTCOME",
        "Runway task creation failed with an unknown outcome",
        null,
        { cause: error },
      );
    }

    // Persist the request ID immediately so even a worker crash mid-poll
    // leaves a durable anchor for reconcile-before-retry.
    await context.recordProviderRequestId?.(requestId);
    return pollUntilTerminal(context, requestId);
  };
}
