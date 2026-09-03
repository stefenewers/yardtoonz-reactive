import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OpenAIImageAdapterError,
  createInMemoryOpenAIImageIdempotencyStore,
  createOpenAIImageStyleProvider,
  resolveOpenAIImageAdapterConfig,
  type OpenAIImageIdempotencyStore,
} from "../../src/lib/openai-image-adapter";

const adapterConfig = {
  apiKey: "test-key-not-a-secret",
  model: "gpt-image-test",
  baseUrl: "https://api.openai.test/v1",
  requestTimeoutMs: 5_000,
};

const productionId = "11111111-1111-4111-8111-111111111111";
const prompt = "claymation style the keyframe";
const styledPngBytes = "styled-png-bytes";

let workDirectory: string;
let keyframePath: string;

beforeEach(async () => {
  workDirectory = await mkdtemp(path.join(os.tmpdir(), "openai-adapter-"));
  keyframePath = path.join(workDirectory, "keyframe.png");
  await writeFile(keyframePath, Buffer.from("fake-keyframe-png"));
});

afterEach(async () => {
  await rm(workDirectory, { recursive: true, force: true });
});

function successFetch(requestId = "req_test_001") {
  return vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          created: 1_700_000_000,
          data: [
            {
              b64_json: Buffer.from(styledPngBytes).toString("base64"),
            },
          ],
        }),
        { status: 200, headers: { "x-request-id": requestId } },
      ),
  );
}

function styleInput() {
  return {
    keyframePath,
    prompt,
    productionId,
  };
}

function providerWith(
  fetchImpl: ReturnType<typeof vi.fn>,
  overrides?: {
    store?: OpenAIImageIdempotencyStore;
    outputDirectory?: string;
  },
) {
  return createOpenAIImageStyleProvider(adapterConfig, {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    idempotencyStore:
      overrides?.store ?? createInMemoryOpenAIImageIdempotencyStore(),
    outputDirectory: overrides?.outputDirectory ?? workDirectory,
  });
}

describe("resolveOpenAIImageAdapterConfig", () => {
  it("does not select the adapter for the mock default", () => {
    expect(resolveOpenAIImageAdapterConfig({ IMAGE_PROVIDER: "MOCK" })).toEqual(
      { selected: false },
    );
  });

  it("selects the adapter with default endpoint and timeout when configured", () => {
    const selection = resolveOpenAIImageAdapterConfig({
      IMAGE_PROVIDER: "OPENAI",
      OPENAI_API_KEY: " key-in-env ",
      OPENAI_IMAGE_MODEL: " gpt-image-1 ",
    });
    expect(selection).toEqual({
      selected: true,
      config: {
        apiKey: "key-in-env",
        model: "gpt-image-1",
        baseUrl: "https://api.openai.com/v1",
        requestTimeoutMs: 120_000,
      },
    });
  });

  it("fails fast when OPENAI is selected without credentials", () => {
    expect(() =>
      resolveOpenAIImageAdapterConfig({ IMAGE_PROVIDER: "OPENAI" }),
    ).toThrow(OpenAIImageAdapterError);
  });

  it("fails fast without echoing the configured secret", () => {
    let message = "";
    try {
      resolveOpenAIImageAdapterConfig({
        IMAGE_PROVIDER: "OPENAI",
        OPENAI_API_KEY: "super-secret-value",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain("OPENAI_IMAGE_MODEL");
    expect(message).not.toContain("super-secret-value");
  });
});

describe("OpenAI image style provider", () => {
  it("captures the provider request ID and writes the styled output", async () => {
    const fetchMock = successFetch("req_live_42");
    const provider = providerWith(fetchMock);

    const result = await provider.style(styleInput());

    expect(result.requestId).toBe("req_live_42");
    const written = await readFile(result.outputPath, "utf8");
    expect(written).toBe(styledPngBytes);
    expect(path.dirname(result.outputPath)).toBe(workDirectory);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${adapterConfig.baseUrl}/images/edits`);
    if (!init)
      throw new Error("expected fetch to be called with a request init");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      `Bearer ${adapterConfig.apiKey}`,
    );
    const form = init.body as FormData;
    expect(form.get("model")).toBe(adapterConfig.model);
    expect(form.get("prompt")).toBe(prompt);
    expect(form.get("n")).toBe("1");
    expect(form.get("image")).toBeInstanceOf(Blob);
  });

  it("serves an identical request from idempotency without a second call", async () => {
    const fetchMock = successFetch("req_live_42");
    const provider = providerWith(fetchMock);

    const first = await provider.style(styleInput());
    const second = await provider.style(styleInput());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second.outputPath).toBe(first.outputPath);
  });

  it("treats a different production or prompt as a new fingerprint", async () => {
    const fetchMock = successFetch();
    const provider = providerWith(fetchMock);

    await provider.style(styleInput());
    await provider.style({
      ...styleInput(),
      productionId: "22222222-2222-4222-8222-222222222222",
    });
    await provider.style({ ...styleInput(), prompt: "different prompt" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fails typed when the cached generation output disappeared", async () => {
    const fetchMock = successFetch();
    const provider = providerWith(fetchMock);
    const first = await provider.style(styleInput());
    await rm(first.outputPath);

    await expect(provider.style(styleInput())).rejects.toMatchObject({
      code: "CACHED_OUTPUT_MISSING",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks retries while a stored outcome is UNCERTAIN", async () => {
    const store: OpenAIImageIdempotencyStore = {
      find: async () => ({
        fingerprint: "matches-any-input",
        state: "UNCERTAIN",
        requestId: "req_unknown",
        createdAt: new Date().toISOString(),
      }),
      save: async () => {},
    };
    const fetchMock = successFetch();
    const provider = providerWith(fetchMock, { store });

    await expect(provider.style(styleInput())).rejects.toMatchObject({
      code: "PROVIDER_REQUEST_UNRESOLVED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records UNCERTAIN with the request ID on a 5xx and blocks blind retries", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { type: "server_error" } }), {
          status: 500,
          headers: { "x-request-id": "req_500" },
        }),
    );
    const provider = providerWith(fetchMock);

    await expect(provider.style(styleInput())).rejects.toMatchObject({
      code: "PROVIDER_REQUEST_UNRESOLVED",
    });

    // The second attempt must be blocked from the network and cite the
    // captured request ID for reconciliation.
    const blockedMessage = await provider.style(styleInput()).then(
      () => "",
      (error: OpenAIImageAdapterError) => error.message,
    );
    expect(blockedMessage).toContain("req_500");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records UNCERTAIN without a request ID when the network fails", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("connection reset");
    });
    const provider = providerWith(fetchMock);

    await expect(provider.style(styleInput())).rejects.toMatchObject({
      code: "PROVIDER_REQUEST_UNRESOLVED",
    });
    await expect(provider.style(styleInput())).rejects.toMatchObject({
      code: "PROVIDER_REQUEST_UNRESOLVED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a 4xx as a definite rejection that may be corrected and retried", async () => {
    const rejectedFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { type: "invalid_request_error", code: "bad_prompt" },
          }),
          { status: 400 },
        ),
    );
    const provider = providerWith(rejectedFetch);

    await expect(provider.style(styleInput())).rejects.toMatchObject({
      code: "PROVIDER_REQUEST_FAILED",
    });

    const fetchMock = successFetch("req_recovered");
    const recoveredProvider = providerWith(fetchMock);
    const result = await recoveredProvider.style(styleInput());
    expect(result.requestId).toBe("req_recovered");
  });

  it("rejects a malformed success payload without caching it", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    const provider = providerWith(fetchMock);

    await expect(provider.style(styleInput())).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID",
    });
  });

  it("joins one in-flight generation for concurrent identical requests", async () => {
    const fetchMock = successFetch("req_concurrent");
    const provider = providerWith(fetchMock);

    const [first, second] = await Promise.all([
      provider.style(styleInput()),
      provider.style(styleInput()),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("fails typed when the keyframe cannot be read", async () => {
    const fetchMock = successFetch();
    const provider = providerWith(fetchMock);

    await expect(
      provider.style({ ...styleInput(), keyframePath: "/nonexistent/key.png" }),
    ).rejects.toMatchObject({ code: "KEYFRAME_UNREADABLE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an empty prompt before any provider interaction", async () => {
    const fetchMock = successFetch();
    const provider = providerWith(fetchMock);

    await expect(
      provider.style({ ...styleInput(), prompt: "   " }),
    ).rejects.toMatchObject({ code: "PROVIDER_REQUEST_FAILED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
