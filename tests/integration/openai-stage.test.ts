import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLocalArtifactStore,
  type ArtifactStore,
} from "../../src/lib/artifact-store";
import type { ImageStyleProvider } from "../../src/lib/providers";
import {
  createOpenAIImageStyleStageExecutor,
  defaultImageStylePrompt,
} from "../../src/server/productions/openai-stage";
import type {
  StageExecutorContext,
  StageUpstreamArtifact,
} from "../../src/server/productions/pipeline";

const adapterConfig = {
  apiKey: "test-key-not-a-secret",
  model: "gpt-image-test",
  baseUrl: "https://api.openai.test/v1",
  requestTimeoutMs: 5_000,
};

const styledPngBytes = Buffer.from("styled-frame-png-bytes");
const productionId = "prod_openai_stage_test";

let workDirectory: string;
let store: ArtifactStore;
let keyframe: StageUpstreamArtifact;
let recordedRequestIds: string[];

beforeEach(async () => {
  workDirectory = await mkdtemp(path.join(tmpdir(), "openai-stage-"));
  store = createLocalArtifactStore({ rootDirectory: workDirectory });
  const stored = await store.save({
    bytes: new Uint8Array(Buffer.from("fake-keyframe")),
    storageKey: "test/keyframe.png",
    mimeType: "image/png",
  });
  keyframe = {
    kind: "KEYFRAME",
    id: `${productionId}-KEYFRAME`,
    storageKey: stored.storageKey,
    sha256: stored.sha256,
  };
  recordedRequestIds = [];
});

afterEach(async () => {
  await rm(workDirectory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function fakeProvider(
  requestId: string | undefined,
  outputPath = path.join(workDirectory, "styled.png"),
): { provider: ImageStyleProvider; prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    provider: {
      name: "OPENAI",
      async style(input) {
        prompts.push(input.prompt);
        await writeFile(outputPath, styledPngBytes);
        return { outputPath, requestId };
      },
    },
  };
}

function context(
  overrides: Partial<StageExecutorContext> = {},
): StageExecutorContext {
  return {
    productionId,
    segment: {
      startMs: 0,
      endMs: 6_000,
      durationMs: 6_000,
    },
    upstream: [keyframe],
    store,
    recordProviderRequestId: async (requestId) => {
      recordedRequestIds.push(requestId);
    },
    ...overrides,
  };
}

describe("createOpenAIImageStyleStageExecutor", () => {
  it("stores the styled frame with honest OPENAI attribution and request lineage", async () => {
    const { provider } = fakeProvider("req_stage_001");
    const executor = createOpenAIImageStyleStageExecutor({
      provider,
      config: adapterConfig,
    });

    const result = await executor(context());

    expect(result.artifacts).toHaveLength(1);
    const artifact = result.artifacts[0]!;
    expect(artifact.kind).toBe("STYLED_FRAME");
    expect(artifact.providerRequestId).toBe("req_stage_001");
    expect(artifact.metadata).toMatchObject({
      styledBy: "OPENAI",
      model: "gpt-image-test",
      providerRequestId: "req_stage_001",
    });

    // The stored bytes are the provider output, digest-verified.
    const integrity = await store.inspect(artifact.storageKey);
    expect(integrity.sha256).toBe(artifact.sha256);
    const storedBytes = await readFile(
      await store.resolve(artifact.storageKey),
    );
    expect(Buffer.from(storedBytes).equals(styledPngBytes)).toBe(true);

    // Request lineage is anchored on the stage row while the lease is held.
    expect(recordedRequestIds).toEqual(["req_stage_001"]);
  });

  it("prompts with the production's persisted creative direction when present", async () => {
    const { provider, prompts } = fakeProvider("req_stage_002");
    const executor = createOpenAIImageStyleStageExecutor({
      provider,
      config: adapterConfig,
    });

    await executor(
      context({ creativeDirection: "Lean into the market-stall chaos." }),
    );

    expect(prompts).toEqual(["Lean into the market-stall chaos."]);
  });

  it("falls back to the documented default prompt without creative direction", async () => {
    const { provider, prompts } = fakeProvider(undefined);
    const executor = createOpenAIImageStyleStageExecutor({
      provider,
      config: adapterConfig,
    });

    await executor(context({ creativeDirection: null }));

    expect(prompts).toEqual([defaultImageStylePrompt]);
    expect(recordedRequestIds).toEqual([]);
  });

  it("surfaces adapter failures as rejected stages with typed errors", async () => {
    const failingProvider: ImageStyleProvider = {
      name: "OPENAI",
      style: () =>
        Promise.reject(
          new Error("PROVIDER_REQUEST_UNRESOLVED sentinel from adapter"),
        ),
    };
    const executor = createOpenAIImageStyleStageExecutor({
      provider: failingProvider,
      config: adapterConfig,
    });

    await expect(executor(context())).rejects.toThrow(
      "PROVIDER_REQUEST_UNRESOLVED sentinel from adapter",
    );
    // Nothing is recorded before the provider accepts a request.
    expect(recordedRequestIds).toEqual([]);
  });
});
