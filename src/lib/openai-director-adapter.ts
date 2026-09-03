import { createHash } from "node:crypto";

import { z } from "zod";

import {
  directorEvidenceSources,
  directorTreatmentInputSchema,
  directorTreatmentSchema,
  type DirectorTreatment,
  type DirectorTreatmentInput,
} from "@/domain/director";

/**
 * OpenAI structured-output adapter implementing the Director LIVE treatment
 * provider. The E6 idiom is shared with the image adapter
 * (`./openai-image-adapter`): the adapter is only constructed when
 * DIRECTOR_PROVIDER=OPENAI passes validated configuration; the in-repo mock
 * default never touches this module and stays credential-free.
 *
 * Contract:
 * - one live call per input fingerprint, never a blind retry;
 * - the provider request ID is captured and returned so the treatment run
 *   persists it for attribution and reconcile-before-retry;
 * - a request whose remote outcome is unknown (network failure, timeout, 5xx)
 *   poisons its fingerprint as UNCERTAIN: the only paths forward are
 *   reconcile-by-request-ID (a human decision on the durable record) or new
 *   evidence (a new fingerprint). There is no retry knob to pass;
 * - a response that violates the treatment contract is a response failure,
 *   never a persisted treatment.
 *
 * The HTTP layer is injectable so all contract tests are mocked; no test or
 * build path ever reaches the live API. Credentials are never logged, echoed,
 * or embedded in error messages.
 */

export const openAIDirectorAdapterErrorCodes = [
  "PROVIDER_CREDENTIALS_REQUIRED",
  "PROVIDER_REQUEST_FAILED",
  "PROVIDER_REQUEST_UNRESOLVED",
  "PROVIDER_RESPONSE_INVALID",
] as const;

export type OpenAIDirectorAdapterErrorCode =
  (typeof openAIDirectorAdapterErrorCodes)[number];

export class OpenAIDirectorAdapterError extends Error {
  readonly requestId?: string;

  constructor(
    public readonly code: OpenAIDirectorAdapterErrorCode,
    message: string,
    options: { cause?: unknown; requestId?: string } = {},
  ) {
    super(
      message,
      options.cause !== undefined ? { cause: options.cause } : undefined,
    );
    if (options.requestId !== undefined) {
      this.requestId = options.requestId;
    }
  }
}

export interface OpenAIDirectorAdapterConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly requestTimeoutMs: number;
}

const defaultBaseUrl = "https://api.openai.com/v1";
const defaultRequestTimeoutMs = 120_000;

const adapterConfigSchema = z.object({
  apiKey: z.string().trim().min(1),
  model: z.string().trim().min(1),
  baseUrl: z.string().trim().url().default(defaultBaseUrl),
  requestTimeoutMs: z.coerce
    .number()
    .int()
    .positive()
    .default(defaultRequestTimeoutMs),
});

export interface OpenAIDirectorAdapterEnvironment {
  DIRECTOR_PROVIDER: string;
  OPENAI_API_KEY?: string;
  OPENAI_DIRECTOR_MODEL?: string;
}

export type OpenAIDirectorAdapterSelection =
  | { selected: false }
  | { selected: true; config: OpenAIDirectorAdapterConfig };

/**
 * Resolves adapter configuration from validated environment values. Returns
 * `{ selected: false }` when OPENAI is not the selection, and fails fast with
 * a typed error when OPENAI is selected without both required settings. This
 * is defense in depth on top of the startup environment schema.
 *
 * `selection` is explicit so callers can validate the PERSISTED director
 * selection regardless of the environment default.
 */
export function resolveOpenAIDirectorAdapterConfig(
  environment: OpenAIDirectorAdapterEnvironment,
  selection: string = environment.DIRECTOR_PROVIDER,
): OpenAIDirectorAdapterSelection {
  if (selection !== "OPENAI") {
    return { selected: false };
  }

  const parsed = adapterConfigSchema.safeParse({
    apiKey: environment.OPENAI_API_KEY,
    model: environment.OPENAI_DIRECTOR_MODEL,
  });
  if (!parsed.success) {
    throw new OpenAIDirectorAdapterError(
      "PROVIDER_CREDENTIALS_REQUIRED",
      "DIRECTOR_PROVIDER=OPENAI requires non-empty OPENAI_API_KEY and OPENAI_DIRECTOR_MODEL settings.",
    );
  }
  return { selected: true, config: parsed.data };
}

export type OpenAIDirectorIdempotencyState = "COMPLETE" | "UNCERTAIN";

export interface OpenAIDirectorIdempotencyRecord {
  readonly fingerprint: string;
  readonly state: OpenAIDirectorIdempotencyState;
  readonly requestId?: string;
  readonly treatment?: DirectorTreatment;
  readonly createdAt: string;
}

export interface OpenAIDirectorIdempotencyStore {
  find(fingerprint: string): Promise<OpenAIDirectorIdempotencyRecord | null>;
  save(record: OpenAIDirectorIdempotencyRecord): Promise<void>;
}

/**
 * Per-process idempotency memory. Durable implementations of
 * {@link OpenAIDirectorIdempotencyStore} own restart survival and the
 * human-approved reconciliation of UNCERTAIN records by request ID.
 */
export function createInMemoryOpenAIDirectorIdempotencyStore(): OpenAIDirectorIdempotencyStore {
  const records = new Map<string, OpenAIDirectorIdempotencyRecord>();
  return {
    async find(fingerprint) {
      return records.get(fingerprint) ?? null;
    },
    async save(record) {
      records.set(record.fingerprint, record);
    },
  };
}

/**
 * Strict structured-output schema sent as generation guidance. The Zod
 * treatment contract stays the authoritative gate after the response lands.
 */
const directorTreatmentJsonSchema = {
  type: "object",
  properties: {
    humorMechanism: { type: "string" },
    audienceReactionEvidence: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source: { type: "string", enum: directorEvidenceSources },
          quote: { type: "string" },
          weight: { type: "number" },
        },
        required: ["source", "quote", "weight"],
        additionalProperties: false,
      },
    },
    recommendedSegment: {
      type: "object",
      properties: {
        startSeconds: { type: "number" },
        endSeconds: { type: "number" },
      },
      required: ["startSeconds", "endSeconds"],
      additionalProperties: false,
    },
    setupTimestamp: { type: "number" },
    payoffTimestamp: { type: "number" },
    adaptationConcept: { type: "string" },
    claymationPrompt: { type: "string" },
    motionPrompt: { type: "string" },
    socialCaption: { type: "string" },
    confidence: { type: "number" },
    risks: { type: "array", items: { type: "string" } },
    evidenceGaps: { type: "array", items: { type: "string" } },
  },
  required: [
    "humorMechanism",
    "audienceReactionEvidence",
    "recommendedSegment",
    "setupTimestamp",
    "payoffTimestamp",
    "adaptationConcept",
    "claymationPrompt",
    "motionPrompt",
    "socialCaption",
    "confidence",
    "risks",
    "evidenceGaps",
  ],
  additionalProperties: false,
} as const;

const directorSystemPrompt = [
  "You are the Yard Toonz Director Agent. Turn the supplied trend evidence into one creative treatment for a 9:16 claymation cartoon.",
  "Rules you must never break:",
  "- Quote audience reactions only from the comment excerpts, the caption, or the engagement metrics in the user payload. Never invent quotes, comment text, or engagement numbers.",
  "- Report missing evidence in evidenceGaps as plain sentences; missing evidence lowers confidence instead of being fabricated.",
  "- Every evidence weight is a number between 0 and 1, and confidence is a number between 0 and 1.",
  "- setupTimestamp and payoffTimestamp are seconds inside the recommended segment, and the payoff never comes before the setup.",
  "- claymationPrompt feeds an OpenAI image call, motionPrompt feeds a Runway motion call, and socialCaption is the post caption for the finished video.",
].join("\n");

/**
 * The only evidence the model may read or quote — everything the candidate
 * actually carried, nothing synthesized. Optional fields are omitted entirely
 * so "absent" is never confused with "empty".
 */
export function buildDirectorEvidencePayload(
  input: DirectorTreatmentInput,
): string {
  return JSON.stringify({
    caption: input.caption,
    metrics: input.metrics,
    commentExcerpts: input.commentExcerpts,
    ...(input.adaptationNote !== undefined && {
      adaptationNote: input.adaptationNote,
    }),
    ...(input.transcript !== undefined && { transcript: input.transcript }),
    ...(input.sourceVideoMetadata !== undefined && {
      sourceVideoMetadata: input.sourceVideoMetadata,
    }),
    ...(input.keyframes !== undefined && { keyframes: input.keyframes }),
    ...(input.creativeDirection !== undefined && {
      creativeDirection: input.creativeDirection,
    }),
  });
}

/**
 * One live call per semantic input: model, candidate, and the full evidence
 * bundle. Any change — new creative direction, another transcript — is a new
 * fingerprint and a new human decision to spend.
 */
export function computeDirectorTreatmentFingerprint(input: {
  model: string;
  candidateId: string;
  treatmentInput: DirectorTreatmentInput;
}): string {
  return createHash("sha256")
    .update(
      [
        "yardtoonz-director-treatment-v1",
        input.model,
        input.candidateId,
        JSON.stringify(input.treatmentInput),
      ].join("\n"),
    )
    .digest("hex");
}

const chatCompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable(),
        }),
      }),
    )
    .min(1),
});

const requestIdHeader = "x-request-id";

function describeProviderRejection(status: number, body: string): string {
  // Bounded, best-effort extraction of the provider's error type/code for
  // internal diagnostics; response bodies never carry credentials.
  try {
    const parsed = JSON.parse(body) as {
      error?: { type?: unknown; code?: unknown };
    };
    const type =
      typeof parsed.error?.type === "string" ? parsed.error.type : "";
    const code =
      typeof parsed.error?.code === "string" ? parsed.error.code : "";
    return [type, code].filter(Boolean).join("/");
  } catch {
    return "";
  }
}

export interface OpenAIDirectorTreatmentRequest {
  readonly candidateId: string;
  readonly input: DirectorTreatmentInput;
}

export interface OpenAIDirectorTreatmentResult {
  readonly treatment: DirectorTreatment;
  readonly model: string;
  readonly requestId?: string;
}

export interface OpenAIDirectorTreatmentProvider {
  readonly name: "OPENAI";
  treat(
    request: OpenAIDirectorTreatmentRequest,
  ): Promise<OpenAIDirectorTreatmentResult>;
}

export interface OpenAIDirectorTreatmentOptions {
  /** Defaults to `globalThis.fetch`; tests inject a mock. */
  fetchImpl?: typeof fetch;
  /** Defaults to an in-process store; inject a durable one for restarts. */
  idempotencyStore?: OpenAIDirectorIdempotencyStore;
}

/**
 * Builds the OPENAI Director treatment provider. Selection is explicit:
 * callers construct it only after {@link resolveOpenAIDirectorAdapterConfig}
 * reports a selected, validated configuration.
 */
export function createOpenAIDirectorTreatmentProvider(
  config: OpenAIDirectorAdapterConfig,
  options: OpenAIDirectorTreatmentOptions = {},
): OpenAIDirectorTreatmentProvider {
  // Resolve the global at call time so singleton-constructed providers
  // (and test doubles that stub globalThis.fetch) always observe the
  // current transport instead of one captured at construction.
  const fetchImpl =
    options.fetchImpl ??
    ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      globalThis.fetch(input, init));
  const idempotencyStore =
    options.idempotencyStore ?? createInMemoryOpenAIDirectorIdempotencyStore();

  // Concurrent callers sharing a fingerprint await one in-flight generation
  // so "once per input fingerprint" holds under parallel requests.
  const inFlight = new Map<string, Promise<OpenAIDirectorTreatmentResult>>();

  async function submitGeneration(
    fingerprint: string,
    treatmentInput: DirectorTreatmentInput,
  ): Promise<OpenAIDirectorTreatmentResult> {
    let response: Response;
    try {
      response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: directorSystemPrompt },
            {
              role: "user",
              content: buildDirectorEvidencePayload(treatmentInput),
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "director_treatment",
              strict: true,
              schema: directorTreatmentJsonSchema,
            },
          },
        }),
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
    } catch (cause) {
      // The request may or may not have reached the provider: record the
      // fingerprint as UNCERTAIN so retries reconcile instead of re-billing.
      await idempotencyStore.save({
        fingerprint,
        state: "UNCERTAIN",
        createdAt: new Date().toISOString(),
      });
      throw new OpenAIDirectorAdapterError(
        "PROVIDER_REQUEST_UNRESOLVED",
        `The OPENAI Director request for fingerprint ${fingerprint} did not complete and its remote outcome is unknown; reconcile before retrying.`,
        { cause },
      );
    }

    const requestId = response.headers.get(requestIdHeader) ?? undefined;

    if (!response.ok) {
      const rejectionBody = await response.text();
      if (response.status < 500) {
        // 4xx: the provider received and rejected the request without
        // creating a generation, so a corrected retry may proceed.
        const detail = describeProviderRejection(
          response.status,
          rejectionBody,
        );
        throw new OpenAIDirectorAdapterError(
          "PROVIDER_REQUEST_FAILED",
          `OPENAI rejected the Director request with HTTP ${response.status}${detail ? ` (${detail})` : ""}.`,
        );
      }
      await idempotencyStore.save({
        fingerprint,
        state: "UNCERTAIN",
        requestId,
        createdAt: new Date().toISOString(),
      });
      throw new OpenAIDirectorAdapterError(
        "PROVIDER_REQUEST_UNRESOLVED",
        `OPENAI returned HTTP ${response.status} for fingerprint ${fingerprint} and the remote outcome is unknown (request ID ${requestId ?? "unavailable"}); reconcile before retrying.`,
        { requestId },
      );
    }

    let content: string | null;
    try {
      const parsedResponse = chatCompletionResponseSchema.parse(
        (await response.json()) as unknown,
      );
      content = parsedResponse.choices[0]!.message.content;
    } catch (cause) {
      throw new OpenAIDirectorAdapterError(
        "PROVIDER_RESPONSE_INVALID",
        `OPENAI Director response did not match the chat completion shape (request ID ${requestId ?? "unavailable"}).`,
        { cause, requestId },
      );
    }

    if (content === null || content.trim().length === 0) {
      throw new OpenAIDirectorAdapterError(
        "PROVIDER_RESPONSE_INVALID",
        `OPENAI Director response carried no message content (request ID ${requestId ?? "unavailable"}).`,
        { requestId },
      );
    }

    let generated: unknown;
    try {
      generated = JSON.parse(content) as unknown;
    } catch (cause) {
      throw new OpenAIDirectorAdapterError(
        "PROVIDER_RESPONSE_INVALID",
        `OPENAI Director response content is not JSON (request ID ${requestId ?? "unavailable"}).`,
        { cause, requestId },
      );
    }

    let treatment: DirectorTreatment;
    try {
      treatment = directorTreatmentSchema.parse(generated);
    } catch (cause) {
      throw new OpenAIDirectorAdapterError(
        "PROVIDER_RESPONSE_INVALID",
        `OPENAI Director response violated the treatment contract (request ID ${requestId ?? "unavailable"}).`,
        { cause, requestId },
      );
    }

    await idempotencyStore.save({
      fingerprint,
      state: "COMPLETE",
      requestId,
      treatment,
      createdAt: new Date().toISOString(),
    });

    return { treatment, model: config.model, requestId };
  }

  return {
    name: "OPENAI",
    async treat(request) {
      const treatmentInput = directorTreatmentInputSchema.parse(request.input);

      const fingerprint = computeDirectorTreatmentFingerprint({
        model: config.model,
        candidateId: request.candidateId,
        treatmentInput,
      });

      const cached = await idempotencyStore.find(fingerprint);
      if (cached?.state === "UNCERTAIN") {
        throw new OpenAIDirectorAdapterError(
          "PROVIDER_REQUEST_UNRESOLVED",
          `A previous OPENAI Director request for fingerprint ${fingerprint} has an unresolved outcome (request ID ${cached.requestId ?? "unavailable"}); reconcile it by request ID before retrying.`,
          { requestId: cached.requestId },
        );
      }
      if (cached?.state === "COMPLETE" && cached.treatment) {
        return {
          treatment: cached.treatment,
          model: config.model,
          requestId: cached.requestId,
        };
      }

      const pending = inFlight.get(fingerprint);
      if (pending) return pending;

      const generation = submitGeneration(fingerprint, treatmentInput).finally(
        () => {
          inFlight.delete(fingerprint);
        },
      );
      inFlight.set(fingerprint, generation);
      return generation;
    },
  };
}
