import { readFile } from "node:fs/promises";

import type { OpenAIImageAdapterConfig } from "@/lib/openai-image-adapter";
import type { ImageStyleProvider } from "@/lib/providers";
import {
  getArtifactStorageKey,
  requireUpstream,
  type StageExecutionResult,
  type StageExecutor,
  type StageExecutorContext,
  type StageOutputArtifact,
} from "./pipeline";

/**
 * OpenAI-backed STYLE_IMAGE stage: the persisted keyframe is submitted as one
 * image edit whose prompt is the persisted treatment's claymation prompt,
 * else the production's persisted creative direction, else the documented
 * deterministic default. The adapter owns retry safety —
 * one live call per input fingerprint, UNCERTAIN poisoning when a request's
 * remote outcome is unknown — so this executor only translates the adapter
 * outcome into the stage artifact contract:
 * - the styled frame is stored with honest OPENAI attribution metadata;
 * - the provider request ID rides both the artifact row and the stage row
 *   (recorded as soon as the provider reports it);
 * - adapter failures bubble as typed errors the worker classifies into
 *   stable stage error codes (PROVIDER_REQUEST_FAILED /
 *   PROVIDER_UNKNOWN_OUTCOME) without echoing credentials.
 */

/** Deterministic prompt used when a production carries no creative direction. */
export const defaultImageStylePrompt =
  "Restyle this frame in the Yard Toonz claymation cartoon style while keeping its composition and subject.";

export interface OpenAIImageStageOptions {
  readonly provider: ImageStyleProvider;
  /** Validated adapter configuration; supplies model metadata for disclosure. */
  readonly config: OpenAIImageAdapterConfig;
}

const openAIStyleLabel =
  "OPENAI image edit; the styled frame was produced by the OPENAI image provider.";

export function createOpenAIImageStyleStageExecutor(
  options: OpenAIImageStageOptions,
): StageExecutor {
  return async (
    context: StageExecutorContext,
  ): Promise<StageExecutionResult> => {
    const keyframe = requireUpstream(context, "KEYFRAME");
    const keyframePath = await context.store.resolve(keyframe.storageKey);
    // The treatment's claymation prompt is the actual clay instruction;
    // the operator's creative direction and the documented default are the
    // fallbacks when the job carries no treatment.
    const prompt =
      context.claymationPrompt?.trim() ||
      context.creativeDirection?.trim() ||
      defaultImageStylePrompt;

    const styled = await options.provider.style({
      keyframePath,
      prompt,
      productionId: context.productionId,
    });

    if (styled.requestId) {
      // Persist the request ID while the lease is held so attribution and
      // reconcile-before-retry survive a crash between here and completion.
      await context.recordProviderRequestId?.(styled.requestId);
    }

    const styledBytes = new Uint8Array(await readFile(styled.outputPath));
    const storageKey = getArtifactStorageKey(
      context.productionId,
      "STYLED_FRAME",
    );
    const stored = await context.store.save({
      bytes: styledBytes,
      storageKey,
      mimeType: "image/png",
    });

    const artifact: StageOutputArtifact = {
      kind: "STYLED_FRAME",
      storageKey,
      mimeType: "image/png",
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      providerRequestId: styled.requestId,
      metadata: {
        styledBy: "OPENAI",
        styleVersion: "openai-image-edit-v1",
        model: options.config.model,
        label: openAIStyleLabel,
        providerRequestId: styled.requestId ?? null,
        stylePromptChars: prompt.length,
      },
    };
    return { artifacts: [artifact] };
  };
}
