import { describe, expect, it, vi } from "vitest";

import { directorTreatmentSchema } from "../../src/domain/director";
import {
  OpenAIDirectorAdapterError,
  buildDirectorEvidencePayload,
  computeDirectorTreatmentFingerprint,
  createInMemoryOpenAIDirectorIdempotencyStore,
  createOpenAIDirectorTreatmentProvider,
  resolveOpenAIDirectorAdapterConfig,
  type OpenAIDirectorIdempotencyStore,
} from "../../src/lib/openai-director-adapter";

const adapterConfig = {
  apiKey: "test-key-not-a-secret",
  model: "gpt-4.1-mini-test",
  baseUrl: "https://api.openai.test/v1",
  requestTimeoutMs: 5_000,
};

const candidateId = "cand_rain_laundry_003";

const treatmentInput = {
  candidateId,
  caption: "When the rain catches you at the gate",
  metrics: { views: 120_000, likes: 9_800, comments: 410, shares: 1_500 },
  commentExcerpts: ["lol the dog is dead", "mi cyaan laugh more"],
  creativeDirection: "Lean into the hubcap-bowl punchline.",
} as const;

function validGeneratedTreatment() {
  return directorTreatmentSchema.parse({
    humorMechanism:
      'Expectation subversion: the caption "When the rain catches you at the gate" sets up a routine the audience knows, and the payoff breaks it at the last beat.',
    audienceReactionEvidence: [
      { source: "comment", quote: "lol the dog is dead", weight: 0.9 },
      {
        source: "caption",
        quote: "When the rain catches you at the gate",
        weight: 0.4,
      },
    ],
    recommendedSegment: { startSeconds: 0, endSeconds: 6 },
    setupTimestamp: 1.5,
    payoffTimestamp: 4.2,
    adaptationConcept:
      "Single continuous clay scene in the Yard Toonz style: a rain-soaked gate dash.",
    claymationPrompt:
      "Claymation keyframe, hand-molded plasticine characters, warm Jamaican yard, 9:16.",
    motionPrompt:
      "Slow push-in on the clay scene with subtle stop-motion jitter. No camera cuts.",
    socialCaption: "When the rain catches you at the gate. Rebuilt in clay.",
    confidence: 0.62,
    risks: [],
    evidenceGaps: [
      "No transcript was received, so jokes that play in audio are not represented.",
    ],
  });
}

function completionBody(treatment: unknown, content?: string) {
  return {
    id: "chatcmpl_test",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content ?? JSON.stringify(treatment),
        },
      },
    ],
  };
}

function successFetch(requestId = "req_dir_001") {
  return vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(completionBody(validGeneratedTreatment())), {
        status: 200,
        headers: { "x-request-id": requestId },
      }),
  );
}

function providerWith(
  fetchImpl: ReturnType<typeof vi.fn>,
  overrides?: { store?: OpenAIDirectorIdempotencyStore },
) {
  return createOpenAIDirectorTreatmentProvider(adapterConfig, {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    idempotencyStore:
      overrides?.store ?? createInMemoryOpenAIDirectorIdempotencyStore(),
  });
}

describe("resolveOpenAIDirectorAdapterConfig", () => {
  it("does not select the adapter for the mock default", () => {
    expect(
      resolveOpenAIDirectorAdapterConfig({ DIRECTOR_PROVIDER: "MOCK" }),
    ).toEqual({ selected: false });
  });

  it("selects the adapter with default endpoint and timeout when configured", () => {
    const selection = resolveOpenAIDirectorAdapterConfig({
      DIRECTOR_PROVIDER: "OPENAI",
      OPENAI_API_KEY: " key-in-env ",
      OPENAI_DIRECTOR_MODEL: " gpt-4.1-mini ",
    });
    expect(selection).toEqual({
      selected: true,
      config: {
        apiKey: "key-in-env",
        model: "gpt-4.1-mini",
        baseUrl: "https://api.openai.com/v1",
        requestTimeoutMs: 120_000,
      },
    });
  });

  it("honors an explicit selection so a persisted OPENAI selection resolves live credentials", () => {
    const selection = resolveOpenAIDirectorAdapterConfig(
      {
        DIRECTOR_PROVIDER: "MOCK",
        OPENAI_API_KEY: "k",
        OPENAI_DIRECTOR_MODEL: "m",
      },
      "OPENAI",
    );
    expect(selection).toEqual({
      selected: true,
      config: {
        apiKey: "k",
        model: "m",
        baseUrl: "https://api.openai.com/v1",
        requestTimeoutMs: 120_000,
      },
    });
  });

  it("fails fast when OPENAI is selected without credentials", () => {
    expect(() =>
      resolveOpenAIDirectorAdapterConfig({ DIRECTOR_PROVIDER: "OPENAI" }),
    ).toThrow(OpenAIDirectorAdapterError);
  });

  it("fails fast without echoing the configured secret", () => {
    let message = "";
    try {
      resolveOpenAIDirectorAdapterConfig({
        DIRECTOR_PROVIDER: "OPENAI",
        OPENAI_API_KEY: "super-secret-value",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain("OPENAI_DIRECTOR_MODEL");
    expect(message).not.toContain("super-secret-value");
  });
});

describe("buildDirectorEvidencePayload", () => {
  it("carries only received evidence and omits absent optional fields", () => {
    const payload = JSON.parse(
      buildDirectorEvidencePayload(treatmentInput),
    ) as Record<string, unknown>;
    expect(payload.caption).toBe(treatmentInput.caption);
    expect(payload.creativeDirection).toBe(treatmentInput.creativeDirection);
    expect(payload).not.toHaveProperty("transcript");
    expect(payload).not.toHaveProperty("sourceVideoMetadata");
    expect(JSON.stringify(payload)).not.toContain(adapterConfig.apiKey);
  });
});

describe("computeDirectorTreatmentFingerprint", () => {
  const base = { model: adapterConfig.model, candidateId, treatmentInput };

  it("is stable for identical semantic inputs", () => {
    expect(computeDirectorTreatmentFingerprint(base)).toBe(
      computeDirectorTreatmentFingerprint(base),
    );
  });

  it("changes when the model, candidate, or evidence changes", () => {
    expect(
      computeDirectorTreatmentFingerprint({ ...base, model: "other-model" }),
    ).not.toBe(computeDirectorTreatmentFingerprint(base));
    expect(
      computeDirectorTreatmentFingerprint({
        ...base,
        candidateId: "cand_other",
      }),
    ).not.toBe(computeDirectorTreatmentFingerprint(base));
    expect(
      computeDirectorTreatmentFingerprint({
        ...base,
        treatmentInput: {
          ...treatmentInput,
          creativeDirection: "New direction.",
        },
      }),
    ).not.toBe(computeDirectorTreatmentFingerprint(base));
  });
});

describe("treat request shape", () => {
  it("sends one strict structured-output chat completion to the configured endpoint", async () => {
    const fetchImpl = successFetch();
    const provider = providerWith(fetchImpl);

    await provider.treat({ candidateId, input: treatmentInput });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.test/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${adapterConfig.apiKey}`,
    );

    const body = JSON.parse(init.body as string) as {
      model: string;
      messages: { role: string; content: string }[];
      response_format: {
        type: string;
        json_schema: {
          name: string;
          strict: boolean;
          schema: { required: string[] };
        };
      };
    };
    expect(body.model).toBe(adapterConfig.model);
    expect(body.messages[0]!.role).toBe("system");
    expect(body.messages[1]!.role).toBe("user");

    const evidence = JSON.parse(body.messages[1]!.content) as Record<
      string,
      unknown
    >;
    expect(evidence.caption).toBe(treatmentInput.caption);

    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.name).toBe("director_treatment");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.required).toContain(
      "socialCaption",
    );
  });
});

describe("treat response parsing", () => {
  it("returns the validated treatment with the model and provider request ID", async () => {
    const provider = providerWith(successFetch("req_dir_001"));

    const result = await provider.treat({ candidateId, input: treatmentInput });

    expect(result.model).toBe(adapterConfig.model);
    expect(result.requestId).toBe("req_dir_001");
    expect(result.treatment.socialCaption).toContain("Rebuilt in clay");
  });

  it("rejects a generation that violates the treatment contract and persists no record", async () => {
    const fetchImpl = successFetch();
    // A provider response outside the 0..1 confidence bound must never
    // become a persisted treatment.
    fetchImpl.mockImplementation(
      async () =>
        new Response(
          JSON.stringify(
            completionBody(
              null,
              JSON.stringify({ ...validGeneratedTreatment(), confidence: 5 }),
            ),
          ),
          { status: 200, headers: { "x-request-id": "req_dir_bad" } },
        ),
    );
    const store = createInMemoryOpenAIDirectorIdempotencyStore();
    const provider = providerWith(fetchImpl, { store });

    await expect(
      provider.treat({ candidateId, input: treatmentInput }),
    ).rejects.toThrow(OpenAIDirectorAdapterError);

    const fingerprint = computeDirectorTreatmentFingerprint({
      model: adapterConfig.model,
      candidateId,
      treatmentInput,
    });
    await expect(store.find(fingerprint)).resolves.toBeNull();
  });

  it("rejects non-JSON message content", async () => {
    const fetchImpl = successFetch();
    fetchImpl.mockImplementation(
      async () =>
        new Response(JSON.stringify(completionBody(null, "not json at all")), {
          status: 200,
          headers: { "x-request-id": "req_dir_bad" },
        }),
    );
    const provider = providerWith(fetchImpl);

    await expect(
      provider.treat({ candidateId, input: treatmentInput }),
    ).rejects.toThrow(OpenAIDirectorAdapterError);
  });

  it("rejects a malformed chat completion body", async () => {
    const fetchImpl = successFetch();
    fetchImpl.mockImplementation(
      async () =>
        new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    );
    const provider = providerWith(fetchImpl);

    await expect(
      provider.treat({ candidateId, input: treatmentInput }),
    ).rejects.toThrow(OpenAIDirectorAdapterError);
  });
});

describe("treat error paths", () => {
  const fingerprint = () =>
    computeDirectorTreatmentFingerprint({
      model: adapterConfig.model,
      candidateId,
      treatmentInput,
    });

  it("maps a 4xx rejection to PROVIDER_REQUEST_FAILED with bounded detail and no poison", async () => {
    const fetchImpl = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            error: { type: "invalid_request_error", code: "invalid_api_key" },
          }),
          { status: 400 },
        ),
    );
    const store = createInMemoryOpenAIDirectorIdempotencyStore();
    const provider = providerWith(fetchImpl, { store });

    const error = await provider
      .treat({ candidateId, input: treatmentInput })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OpenAIDirectorAdapterError);
    expect((error as OpenAIDirectorAdapterError).code).toBe(
      "PROVIDER_REQUEST_FAILED",
    );
    expect((error as Error).message).toContain("HTTP 400");
    expect((error as Error).message).toContain("invalid_request_error");
    expect((error as Error).message).not.toContain(adapterConfig.apiKey);
    await expect(store.find(fingerprint())).resolves.toBeNull();
  });

  it("maps a 5xx rejection to PROVIDER_REQUEST_UNRESOLVED and poisons the fingerprint with the request ID", async () => {
    const fetchImpl = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response("upstream exploded", {
          status: 502,
          headers: { "x-request-id": "req_dir_502" },
        }),
    );
    const store = createInMemoryOpenAIDirectorIdempotencyStore();
    const provider = providerWith(fetchImpl, { store });

    const error = await provider
      .treat({ candidateId, input: treatmentInput })
      .catch((caught: unknown) => caught);

    expect((error as OpenAIDirectorAdapterError).code).toBe(
      "PROVIDER_REQUEST_UNRESOLVED",
    );
    expect((error as OpenAIDirectorAdapterError).requestId).toBe("req_dir_502");
    const record = await store.find(fingerprint());
    expect(record?.state).toBe("UNCERTAIN");
    expect(record?.requestId).toBe("req_dir_502");
  });

  it("maps a network failure to PROVIDER_REQUEST_UNRESOLVED and poisons the fingerprint without a request ID", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("connection refused");
    });
    const store = createInMemoryOpenAIDirectorIdempotencyStore();
    const provider = providerWith(fetchImpl, { store });

    const error = await provider
      .treat({ candidateId, input: treatmentInput })
      .catch((caught: unknown) => caught);

    expect((error as OpenAIDirectorAdapterError).code).toBe(
      "PROVIDER_REQUEST_UNRESOLVED",
    );
    expect((error as OpenAIDirectorAdapterError).requestId).toBeUndefined();
    const record = await store.find(fingerprint());
    expect(record?.state).toBe("UNCERTAIN");
    expect(record?.requestId).toBeUndefined();
  });
});

describe("treat idempotency", () => {
  it("completes once per fingerprint and returns the cached treatment afterwards", async () => {
    const fetchImpl = successFetch();
    const provider = providerWith(fetchImpl);

    const first = await provider.treat({ candidateId, input: treatmentInput });
    const second = await provider.treat({ candidateId, input: treatmentInput });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("refuses to re-submit while a fingerprint is UNCERTAIN — retries are a human decision", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("connection refused");
    });
    const provider = providerWith(fetchImpl);

    await expect(
      provider.treat({ candidateId, input: treatmentInput }),
    ).rejects.toThrow(OpenAIDirectorAdapterError);
    await expect(
      provider.treat({ candidateId, input: treatmentInput }),
    ).rejects.toThrow(/reconcile it by request ID/u);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight generation between concurrent callers", async () => {
    const fetchImpl = successFetch();
    const provider = providerWith(fetchImpl);

    const [first, second] = await Promise.all([
      provider.treat({ candidateId, input: treatmentInput }),
      provider.treat({ candidateId, input: treatmentInput }),
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("treats changed evidence as a new fingerprint and makes a new live call", async () => {
    const fetchImpl = successFetch();
    const provider = providerWith(fetchImpl);

    await provider.treat({ candidateId, input: treatmentInput });
    await provider.treat({
      candidateId,
      input: { ...treatmentInput, creativeDirection: "Different direction." },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
