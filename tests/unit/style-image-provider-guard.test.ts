import { describe, expect, it } from "vitest";

import {
  createDefaultStageExecutors,
  type StageExecutorContext,
} from "../../src/server/productions/pipeline";

/**
 * The guard throws before touching the executor context, so the context is
 * never exercised in this suite.
 */
const unusedContext = {} as unknown as StageExecutorContext;

describe("STYLE_IMAGE default executor provider guard", () => {
  it("rejects a live image provider selection without a wired executor", async () => {
    const executors = createDefaultStageExecutors({ imageProvider: "OPENAI" });

    await expect(executors.STYLE_IMAGE(unusedContext)).rejects.toMatchObject({
      code: "IMAGE_PROVIDER_NOT_AVAILABLE",
    });
  });

  it("names the selected provider in the failure message", async () => {
    const executors = createDefaultStageExecutors({ imageProvider: "OPENAI" });

    const message = await executors.STYLE_IMAGE(unusedContext).then(
      () => "",
      (error: Error) => error.message,
    );

    expect(message).toContain("IMAGE_PROVIDER=OPENAI");
  });
});
