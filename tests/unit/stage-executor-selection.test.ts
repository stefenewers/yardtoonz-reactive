import { describe, expect, it } from "vitest";

import {
  createDefaultStageExecutors,
  WorkerStageError,
} from "../../src/server/productions/pipeline";
import {
  selectDefaultStageExecutor,
  type JobProviderSelection,
} from "../../src/worker/runner";
import type {
  PipelineStageName,
  StageExecutor,
} from "../../src/server/productions/pipeline";

const defaults = createDefaultStageExecutors();

function selection(
  imageProvider: JobProviderSelection["imageProvider"],
  animationProvider: JobProviderSelection["animationProvider"],
): JobProviderSelection {
  return { imageProvider, animationProvider };
}

const liveExecutor: StageExecutor = async () => ({ artifacts: [] });

/** A factory that fails the test if the provider path is taken by mistake. */
function absentFactory(stage: string): () => StageExecutor {
  return () => {
    throw new Error(`${stage} executor factory must not be constructed`);
  };
}

describe("selectDefaultStageExecutor", () => {
  it("runs the OpenAI image executor for a job persisted with imageProvider=OPENAI", () => {
    const picked = selectDefaultStageExecutor(
      "STYLE_IMAGE",
      selection("OPENAI", "MOCK"),
      defaults,
      { createOpenAIImageExecutor: () => liveExecutor },
    );
    expect(picked).toBe(liveExecutor);
  });

  it("runs the mock image executor for a job persisted with imageProvider=MOCK", () => {
    const picked = selectDefaultStageExecutor(
      "STYLE_IMAGE",
      selection("MOCK", "MOCK"),
      defaults,
      { createOpenAIImageExecutor: absentFactory("OpenAI image") },
    );
    expect(picked).toBe(defaults.STYLE_IMAGE);
  });

  it("runs the Runway animation executor for a job persisted with animationProvider=RUNWAY", () => {
    const picked = selectDefaultStageExecutor(
      "ANIMATE_IMAGE",
      selection("MOCK", "RUNWAY"),
      defaults,
      { createRunwayAnimationExecutor: () => liveExecutor },
    );
    expect(picked).toBe(liveExecutor);
  });

  it("runs the mock animation executor for a job persisted with animationProvider=MOCK", () => {
    const picked = selectDefaultStageExecutor(
      "ANIMATE_IMAGE",
      selection("MOCK", "MOCK"),
      defaults,
      { createRunwayAnimationExecutor: absentFactory("Runway animation") },
    );
    expect(picked).toBe(defaults.ANIMATE_IMAGE);
  });

  it("leaves every other stage on the defaults regardless of selections", () => {
    for (const stageName of [
      "EXTRACT_MEDIA",
      "SELECT_KEYFRAME",
      "MUX_AND_NORMALIZE",
      "VALIDATE_OUTPUT",
    ] as const satisfies readonly PipelineStageName[]) {
      expect(
        selectDefaultStageExecutor(
          stageName,
          selection("OPENAI", "RUNWAY"),
          defaults,
          {
            createOpenAIImageExecutor: absentFactory("OpenAI image"),
            createRunwayAnimationExecutor: absentFactory("Runway animation"),
          },
        ),
      ).toBe(defaults[stageName]);
    }
  });

  it("fails fast when a live selection has no executor configured", () => {
    expect(() =>
      selectDefaultStageExecutor(
        "STYLE_IMAGE",
        selection("OPENAI", "MOCK"),
        defaults,
      ),
    ).toThrow(WorkerStageError);
    expect(() =>
      selectDefaultStageExecutor(
        "ANIMATE_IMAGE",
        selection("MOCK", "RUNWAY"),
        defaults,
      ),
    ).toThrow(WorkerStageError);
  });

  it("keeps the default STYLE_IMAGE executor credential-free and env-free", async () => {
    // The old guard read env.IMAGE_PROVIDER and threw for live selections;
    // selection is now job-driven, so the default executor is pure mock FFmpeg.
    await expect(
      defaults.STYLE_IMAGE({
        upstream: [],
        productionId: "prod-guard",
      } as never),
    ).rejects.toMatchObject({ code: "UPSTREAM_ARTIFACT_MISSING" });
  });
});
