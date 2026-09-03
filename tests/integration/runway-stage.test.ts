import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createLocalArtifactStore,
  generateArtifactStorageKey,
  type ArtifactStore,
} from "../../src/lib/artifact-store";
import {
  RunwayAnimationError,
  type RunwayGenerateInput,
  type RunwayTaskSnapshot,
  type RunwayTransport,
} from "../../src/lib/runway";
import { expectedArtifactProvider } from "../../src/domain/production";
import { mediaToolPaths } from "../../src/lib/media-tools";
import {
  createRunwayAnimationStageExecutor,
  resolveRunwayStageConfig,
} from "../../src/server/productions/runway-stage";
import type {
  StageExecutorContext,
  StageUpstreamArtifact,
} from "../../src/server/productions/pipeline";

const execFileAsync = promisify(execFile);

const PRODUCTION_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "runway-request-1";

let fixtureDirectory: string;
let styledFramePath: string;
let outputMp4Bytes: Uint8Array;
let artifactRoot: string;
let store: ArtifactStore;

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(path.join(tmpdir(), "yardtoonz-runway-fx-"));
  styledFramePath = path.join(fixtureDirectory, "styled-frame.png");
  const outputVideoPath = path.join(fixtureDirectory, "output.mp4");
  // A real 360x640 PNG (styled-frame stand-in) and a real video/mp4 so the
  // executor's probe of the downloaded output behaves like production.
  await execFileAsync(mediaToolPaths.ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=360x640:d=1",
    "-frames:v",
    "1",
    styledFramePath,
  ]);
  await execFileAsync(mediaToolPaths.ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=360x640:rate=24",
    "-t",
    "0.5",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    outputVideoPath,
  ]);
  outputMp4Bytes = new Uint8Array(await readFile(outputVideoPath));
});

afterEach(async () => {
  if (artifactRoot) {
    await rm(artifactRoot, { recursive: true, force: true });
    artifactRoot = undefined as unknown as string;
  }
});

afterAll(async () => {
  if (fixtureDirectory) {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

function createStore(): ArtifactStore {
  artifactRoot = path.join(
    tmpdir(),
    `yardtoonz-runway-art-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  store = createLocalArtifactStore({ rootDirectory: artifactRoot });
  return store;
}

interface TransportScript {
  createResponses: (() => string | Promise<string> | Error)[];
  taskResponses: (RunwayTaskSnapshot | Error)[];
  outputBytes?: Uint8Array;
}

function scriptedTransport(script: TransportScript): RunwayTransport & {
  calls: {
    create: number;
    get: string[];
    createdInputs: RunwayGenerateInput[];
  };
} {
  let createCall = 0;
  let getCall = 0;
  return {
    calls: {
      create: 0,
      get: [] as string[],
      createdInputs: [] as RunwayGenerateInput[],
    },
    async createAnimationTask(input) {
      this.calls.create += 1;
      this.calls.createdInputs.push(input);
      const next = script.createResponses[createCall];
      createCall += 1;
      if (!next) throw new Error("unexpected createAnimationTask call");
      const result = next();
      if (result instanceof Error) throw result;
      return result;
    },
    async getTask(requestId) {
      this.calls.get.push(requestId);
      const next = script.taskResponses[getCall];
      getCall += 1;
      if (!next) throw new Error("unexpected getTask call");
      if (next instanceof Error) throw next;
      return next;
    },
    async downloadOutput() {
      if (!script.outputBytes) {
        throw new Error("unexpected downloadOutput call");
      }
      return script.outputBytes;
    },
  };
}

async function buildContext(
  overrides: Partial<StageExecutorContext> = {},
): Promise<StageExecutorContext> {
  const activeStore = overrides.store ?? createStore();
  const styledKey = generateArtifactStorageKey(
    PRODUCTION_ID,
    "styled-frame.png",
  );
  await activeStore.save({
    bytes: new Uint8Array(await readFile(styledFramePath)),
    storageKey: styledKey,
    mimeType: "image/png",
  });
  const upstream: StageUpstreamArtifact[] = [
    {
      kind: "STYLED_FRAME",
      id: `${PRODUCTION_ID}-STYLED_FRAME`,
      storageKey: styledKey,
      sha256: "a".repeat(64),
    },
  ];
  return {
    productionId: PRODUCTION_ID,
    segment: { startMs: 0, endMs: 6000, durationMs: 6000 },
    upstream,
    store: activeStore,
    ...overrides,
  };
}

function createExecutor(transport: RunwayTransport) {
  return createRunwayAnimationStageExecutor({
    transport,
    config: { apiKey: "test-key", model: "test-model" },
    pollIntervalMs: 1,
    maxPolls: 3,
  });
}

describe("Runway animation stage executor", () => {
  it("generates, polls to success, stores the animation, and records the request ID", async () => {
    const transport = scriptedTransport({
      createResponses: [() => REQUEST_ID],
      taskResponses: [
        { id: REQUEST_ID, status: "PENDING" },
        { id: REQUEST_ID, status: "RUNNING" },
        {
          id: REQUEST_ID,
          status: "SUCCEEDED",
          output: ["https://cdn.example.com/out.mp4"],
        },
      ],
      outputBytes: outputMp4Bytes,
    });
    const executor = createExecutor(transport);
    const recorded: string[] = [];
    const context = await buildContext({
      recordProviderRequestId: async (id) => {
        recorded.push(id);
      },
    });

    const result = await executor(context);

    expect(transport.calls.create).toBe(1);
    expect(transport.calls.createdInputs[0]).toMatchObject({
      model: "test-model",
      durationSeconds: 6,
    });
    expect(recorded).toEqual([REQUEST_ID]);
    const animation = result.artifacts[0];
    expect(animation.kind).toBe("SILENT_ANIMATION");
    expect(animation.mimeType).toBe("video/mp4");
    expect(animation.providerRequestId).toBe(REQUEST_ID);
    expect(animation.metadata).toMatchObject({
      animatedBy: "RUNWAY",
      model: "test-model",
      providerRequestId: REQUEST_ID,
      audioPresent: false,
    });
    // Honest attribution: the production's animation selection maps the
    // artifact to the RUNWAY provider, never MOCK.
    expect(
      expectedArtifactProvider(animation.kind, {
        imageProvider: "MOCK",
        animationProvider: "RUNWAY",
      }),
    ).toBe("RUNWAY");
  });

  it("fails deterministically when the poll budget is exhausted, without retrying", async () => {
    const transport = scriptedTransport({
      createResponses: [() => REQUEST_ID],
      taskResponses: Array.from({ length: 12 }, () => ({
        id: REQUEST_ID,
        status: "PENDING",
      })),
    });
    const executor = createExecutor(transport);

    const error = await executor(await buildContext()).catch((e) => e);
    expect(error).toBeInstanceOf(RunwayAnimationError);
    expect(error.code).toBe("PROVIDER_UNKNOWN_OUTCOME");
    expect(error.requestId).toBe(REQUEST_ID);
    expect(transport.calls.create).toBe(1);
    expect(transport.calls.get).toHaveLength(3);
  });

  it("never retries blindly after a transport error mid-poll", async () => {
    const transport = scriptedTransport({
      createResponses: [() => REQUEST_ID],
      taskResponses: [new Error("network down")],
    });
    const executor = createExecutor(transport);

    const error = await executor(await buildContext()).catch((e) => e);
    expect(error.code).toBe("PROVIDER_UNKNOWN_OUTCOME");
    expect(error.requestId).toBe(REQUEST_ID);
    // No second poll, no new generation.
    expect(transport.calls.create).toBe(1);
    expect(transport.calls.get).toHaveLength(1);
  });

  it("never retries blindly when task creation ends in an unknown state", async () => {
    const transport = scriptedTransport({
      createResponses: [() => new Error("connection reset")],
      taskResponses: [],
    });
    const executor = createExecutor(transport);

    const error = await executor(await buildContext()).catch((e) => e);
    expect(error.code).toBe("PROVIDER_UNKNOWN_OUTCOME");
    expect(error.requestId).toBeNull();
    expect(transport.calls.create).toBe(1);
    expect(transport.calls.get).toHaveLength(0);
  });

  it("reports a proven provider failure with its request ID", async () => {
    const transport = scriptedTransport({
      createResponses: [() => REQUEST_ID],
      taskResponses: [{ id: REQUEST_ID, status: "FAILED", failure: "blocked" }],
    });
    const executor = createExecutor(transport);

    const error = await executor(await buildContext()).catch((e) => e);
    expect(error.code).toBe("PROVIDER_REQUEST_FAILED");
    expect(error.requestId).toBe(REQUEST_ID);
    expect(error.message).toContain(REQUEST_ID);
    expect(transport.calls.create).toBe(1);
  });

  describe("reconcile-by-request-ID before any retry", () => {
    it("downloads the finished output of a prior request instead of generating again", async () => {
      const transport = scriptedTransport({
        createResponses: [() => new Error("must not create")],
        taskResponses: [
          {
            id: REQUEST_ID,
            status: "SUCCEEDED",
            output: ["https://cdn.example.com/prior.mp4"],
          },
        ],
        outputBytes: outputMp4Bytes,
      });
      const executor = createExecutor(transport);
      const context = await buildContext({
        priorProviderRequestId: REQUEST_ID,
      });

      const result = await executor(context);

      expect(transport.calls.create).toBe(0);
      expect(transport.calls.get).toEqual([REQUEST_ID]);
      expect(result.artifacts[0].providerRequestId).toBe(REQUEST_ID);
    });

    it("resumes polling an in-progress prior request without creating a new one", async () => {
      const transport = scriptedTransport({
        createResponses: [() => new Error("must not create")],
        taskResponses: [
          { id: REQUEST_ID, status: "RUNNING" },
          {
            id: REQUEST_ID,
            status: "SUCCEEDED",
            output: ["https://cdn.example.com/prior.mp4"],
          },
        ],
        outputBytes: outputMp4Bytes,
      });
      const executor = createExecutor(transport);
      const context = await buildContext({
        priorProviderRequestId: REQUEST_ID,
      });

      const result = await executor(context);

      expect(transport.calls.create).toBe(0);
      expect(result.artifacts[0].providerRequestId).toBe(REQUEST_ID);
    });

    it("fails with an unknown outcome when reconciliation itself is inconclusive", async () => {
      const transport = scriptedTransport({
        createResponses: [() => new Error("must not create")],
        taskResponses: [new Error("reconcile network failure")],
      });
      const executor = createExecutor(transport);
      const context = await buildContext({
        priorProviderRequestId: REQUEST_ID,
      });

      const error = await executor(context).catch((e) => e);
      expect(error.code).toBe("PROVIDER_UNKNOWN_OUTCOME");
      expect(error.requestId).toBe(REQUEST_ID);
      expect(transport.calls.create).toBe(0);
    });

    it("generates once after reconciliation proves the prior request is gone", async () => {
      const transport = scriptedTransport({
        createResponses: [() => "runway-request-2"],
        taskResponses: [
          new RunwayAnimationError(
            "PROVIDER_REQUEST_FAILED",
            "Runway task not found for request ID",
            REQUEST_ID,
          ),
          { id: "runway-request-2", status: "SUCCEEDED", output: ["u"] },
        ],
        outputBytes: outputMp4Bytes,
      });
      const executor = createExecutor(transport);
      const context = await buildContext({
        priorProviderRequestId: REQUEST_ID,
      });

      const result = await executor(context);

      expect(transport.calls.create).toBe(1);
      expect(result.artifacts[0].providerRequestId).toBe("runway-request-2");
    });

    it("generates once after reconciliation proves the prior request failed", async () => {
      const transport = scriptedTransport({
        createResponses: [() => "runway-request-2"],
        taskResponses: [
          { id: REQUEST_ID, status: "CANCELLED" },
          { id: "runway-request-2", status: "SUCCEEDED", output: ["u"] },
        ],
        outputBytes: outputMp4Bytes,
      });
      const executor = createExecutor(transport);
      const context = await buildContext({
        priorProviderRequestId: REQUEST_ID,
      });

      const result = await executor(context);

      expect(transport.calls.create).toBe(1);
      expect(transport.calls.get).toEqual([REQUEST_ID, "runway-request-2"]);
      expect(result.artifacts[0].providerRequestId).toBe("runway-request-2");
    });
  });
});

describe("Runway stage configuration", () => {
  it("fails fast when RUNWAY is selected without credentials", () => {
    expect(() => resolveRunwayStageConfig({})).toThrow(RunwayAnimationError);
    expect(() => resolveRunwayStageConfig({ RUNWAY_API_KEY: "k" })).toThrow(
      RunwayAnimationError,
    );
  });

  it("resolves validated credentials into the stage config", () => {
    expect(
      resolveRunwayStageConfig({ RUNWAY_API_KEY: "k", RUNWAY_MODEL: "m" }),
    ).toEqual({ apiKey: "k", model: "m" });
  });
});
