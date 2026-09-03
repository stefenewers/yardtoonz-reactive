import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import type { ImageStyleProvider } from "./providers";

/**
 * OpenAI image edit adapter implementing {@link ImageStyleProvider} for the
 * STYLE_IMAGE stage. The adapter is only constructed when
 * `IMAGE_PROVIDER=OPENAI` passes validated configuration; the in-repo mock
 * default never touches this module and stays credential-free.
 *
 * Contract (Technical Specification §8.4):
 * - one live call per input fingerprint, never a blind retry;
 * - the provider request ID is captured and returned for artifact persistence;
 * - a request whose remote outcome is unknown (network failure, timeout, 5xx)
 *   poisons its fingerprint as UNCERTAIN so callers must reconcile by request
 *   ID instead of re-submitting.
 *
 * The HTTP layer is injectable so all contract tests are mocked; no test or
 * build path ever reaches the live API. Credentials are never logged, echoed,
 * or embedded in error messages.
 */

export const openAIImageAdapterErrorCodes = [
  "PROVIDER_CREDENTIALS_REQUIRED",
  "KEYFRAME_UNREADABLE",
  "PROVIDER_REQUEST_FAILED",
  "PROVIDER_REQUEST_UNRESOLVED",
  "PROVIDER_RESPONSE_INVALID",
  "CACHED_OUTPUT_MISSING",
] as const;

export type OpenAIImageAdapterErrorCode =
  (typeof openAIImageAdapterErrorCodes)[number];

export class OpenAIImageAdapterError extends Error {
  constructor(
    public readonly code: OpenAIImageAdapterErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export interface OpenAIImageAdapterConfig {
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

export interface OpenAIImageAdapterEnvironment {
  IMAGE_PROVIDER: string;
  OPENAI_API_KEY?: string;
  OPENAI_IMAGE_MODEL?: string;
}

export type OpenAIImageAdapterSelection =
  | { selected: false }
  | { selected: true; config: OpenAIImageAdapterConfig };

/**
 * Resolves adapter configuration from validated environment values. Returns
 * `{ selected: false }` when OPENAI is not the selection, and fails fast with
 * a typed error when OPENAI is selected without both required settings. This
 * is defense in depth on top of the startup environment schema.
 *
 * `selection` is explicit so callers can validate a production's PERSISTED
 * image provider regardless of the environment default: a job persisted with
 * imageProvider=OPENAI must resolve live credentials even when the worker
 * environment's own IMAGE_PROVIDER is MOCK.
 */
export function resolveOpenAIImageAdapterConfig(
  environment: OpenAIImageAdapterEnvironment,
  selection: string = environment.IMAGE_PROVIDER,
): OpenAIImageAdapterSelection {
  if (selection !== "OPENAI") {
    return { selected: false };
  }

  const parsed = adapterConfigSchema.safeParse({
    apiKey: environment.OPENAI_API_KEY,
    model: environment.OPENAI_IMAGE_MODEL,
  });
  if (!parsed.success) {
    throw new OpenAIImageAdapterError(
      "PROVIDER_CREDENTIALS_REQUIRED",
      "IMAGE_PROVIDER=OPENAI requires non-empty OPENAI_API_KEY and OPENAI_IMAGE_MODEL settings.",
    );
  }
  return { selected: true, config: parsed.data };
}

export type OpenAIImageIdempotencyState = "COMPLETE" | "UNCERTAIN";

export interface OpenAIImageIdempotencyRecord {
  readonly fingerprint: string;
  readonly state: OpenAIImageIdempotencyState;
  readonly requestId?: string;
  readonly outputPath?: string;
  readonly createdAt: string;
}

export interface OpenAIImageIdempotencyStore {
  find(fingerprint: string): Promise<OpenAIImageIdempotencyRecord | null>;
  save(record: OpenAIImageIdempotencyRecord): Promise<void>;
}

/**
 * Per-process idempotency memory. Durable implementations of
 * {@link OpenAIImageIdempotencyStore} own restart survival and explicit
 * reconciliation of UNCERTAIN records by request ID.
 */
export function createInMemoryOpenAIImageIdempotencyStore(): OpenAIImageIdempotencyStore {
  const records = new Map<string, OpenAIImageIdempotencyRecord>();
  return {
    async find(fingerprint) {
      return records.get(fingerprint) ?? null;
    },
    async save(record) {
      records.set(record.fingerprint, record);
    },
  };
}

export interface OpenAIImageStyleProviderOptions {
  /** Defaults to `globalThis.fetch`; tests inject a mock. */
  fetchImpl?: typeof fetch;
  /** Defaults to an in-process store; inject a durable one for restarts. */
  idempotencyStore?: OpenAIImageIdempotencyStore;
  /** Directory that receives one PNG per fingerprint. */
  outputDirectory?: string;
}

const stylePromptSchema = z.string().trim().min(1);

const imageEditResponseSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().min(1) })).min(1),
});

const requestIdHeader = "x-request-id";

function computeInputFingerprint(input: {
  model: string;
  prompt: string;
  productionId: string;
  keyframeSha256: string;
}): string {
  const { model, prompt, productionId, keyframeSha256 } = input;
  return createHash("sha256")
    .update(
      [
        "yardtoonz-openai-image-v1",
        model,
        prompt,
        productionId,
        keyframeSha256,
      ].join("\n"),
    )
    .digest("hex");
}

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

/**
 * Builds the OPENAI image style provider. Selection is explicit: callers
 * construct it only after {@link resolveOpenAIImageAdapterConfig} reports a
 * selected, validated configuration.
 */
export function createOpenAIImageStyleProvider(
  config: OpenAIImageAdapterConfig,
  options: OpenAIImageStyleProviderOptions = {},
): ImageStyleProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const idempotencyStore =
    options.idempotencyStore ?? createInMemoryOpenAIImageIdempotencyStore();
  const outputDirectory =
    options.outputDirectory ?? path.join(os.tmpdir(), "yardtoonz-openai-image");

  // Concurrent callers sharing a fingerprint await one in-flight generation
  // so "once per input fingerprint" holds under parallel retries.
  const inFlight = new Map<
    string,
    Promise<{ outputPath: string; requestId?: string }>
  >();

  async function readCachedOutput(
    record: OpenAIImageIdempotencyRecord,
  ): Promise<{ outputPath: string; requestId?: string }> {
    if (!record.outputPath) {
      throw new OpenAIImageAdapterError(
        "CACHED_OUTPUT_MISSING",
        `Cached OPENAI generation for fingerprint ${record.fingerprint} has no recorded output path.`,
      );
    }
    try {
      await readFile(record.outputPath);
    } catch {
      throw new OpenAIImageAdapterError(
        "CACHED_OUTPUT_MISSING",
        `Cached OPENAI generation ${record.requestId ?? "(no request ID)"} for fingerprint ${record.fingerprint} is missing its output file; inspect the provider account before regenerating.`,
      );
    }
    return { outputPath: record.outputPath, requestId: record.requestId };
  }

  async function submitGeneration(input: {
    fingerprint: string;
    keyframeBytes: Uint8Array<ArrayBuffer>;
    prompt: string;
  }): Promise<{ outputPath: string; requestId?: string }> {
    const { fingerprint, keyframeBytes, prompt } = input;

    // Multipart per the OpenAI images edits API; the keyframe is the edit
    // source image. Only non-secret transformation fields are sent.
    const form = new FormData();
    form.set("model", config.model);
    form.set("prompt", prompt);
    form.set("n", "1");
    form.set(
      "image",
      new Blob([keyframeBytes], { type: "image/png" }),
      "keyframe.png",
    );

    let response: Response;
    try {
      response = await fetchImpl(`${config.baseUrl}/images/edits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body: form,
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
      throw new OpenAIImageAdapterError(
        "PROVIDER_REQUEST_UNRESOLVED",
        `The OPENAI image request for fingerprint ${fingerprint} did not complete and its remote outcome is unknown; reconcile before retrying.`,
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
        throw new OpenAIImageAdapterError(
          "PROVIDER_REQUEST_FAILED",
          `OPENAI rejected the image request with HTTP ${response.status}${detail ? ` (${detail})` : ""}.`,
        );
      }
      await idempotencyStore.save({
        fingerprint,
        state: "UNCERTAIN",
        requestId,
        createdAt: new Date().toISOString(),
      });
      throw new OpenAIImageAdapterError(
        "PROVIDER_REQUEST_UNRESOLVED",
        `OPENAI returned HTTP ${response.status} for fingerprint ${fingerprint} and the remote outcome is unknown (request ID ${requestId ?? "unavailable"}); reconcile before retrying.`,
      );
    }

    let parsedResponse: z.infer<typeof imageEditResponseSchema>;
    try {
      parsedResponse = imageEditResponseSchema.parse(
        (await response.json()) as unknown,
      );
    } catch (cause) {
      throw new OpenAIImageAdapterError(
        "PROVIDER_RESPONSE_INVALID",
        `OPENAI image response did not match the expected image edit shape (request ID ${requestId ?? "unavailable"}).`,
        { cause },
      );
    }

    const styledBytes = Buffer.from(parsedResponse.data[0].b64_json, "base64");
    if (styledBytes.byteLength === 0) {
      throw new OpenAIImageAdapterError(
        "PROVIDER_RESPONSE_INVALID",
        `OPENAI image response carried an empty image payload (request ID ${requestId ?? "unavailable"}).`,
      );
    }

    await mkdir(outputDirectory, { recursive: true });
    const outputPath = path.join(outputDirectory, `${fingerprint}.png`);
    await writeFile(outputPath, styledBytes);

    await idempotencyStore.save({
      fingerprint,
      state: "COMPLETE",
      requestId,
      outputPath,
      createdAt: new Date().toISOString(),
    });

    return { outputPath, requestId };
  }

  async function styleWithFingerprint(input: {
    keyframePath: string;
    prompt: string;
    productionId: string;
  }): Promise<{ outputPath: string; requestId?: string }> {
    // Copy into a plain ArrayBuffer-backed view so the bytes are Blob-safe.
    let keyframeBytes: Uint8Array<ArrayBuffer>;
    try {
      keyframeBytes = new Uint8Array(await readFile(input.keyframePath));
    } catch (cause) {
      throw new OpenAIImageAdapterError(
        "KEYFRAME_UNREADABLE",
        `Keyframe file for production ${input.productionId} could not be read.`,
        { cause },
      );
    }

    const fingerprint = computeInputFingerprint({
      model: config.model,
      prompt: input.prompt,
      productionId: input.productionId,
      keyframeSha256: createHash("sha256").update(keyframeBytes).digest("hex"),
    });

    const cached = await idempotencyStore.find(fingerprint);
    if (cached?.state === "UNCERTAIN") {
      throw new OpenAIImageAdapterError(
        "PROVIDER_REQUEST_UNRESOLVED",
        `A previous OPENAI image request for fingerprint ${fingerprint} has an unresolved outcome (request ID ${cached.requestId ?? "unavailable"}); reconcile it by request ID before retrying.`,
      );
    }
    if (cached?.state === "COMPLETE") {
      return readCachedOutput(cached);
    }

    const pending = inFlight.get(fingerprint);
    if (pending) return pending;

    const generation = submitGeneration({
      fingerprint,
      keyframeBytes,
      prompt: input.prompt,
    }).finally(() => {
      inFlight.delete(fingerprint);
    });
    inFlight.set(fingerprint, generation);
    return generation;
  }

  return {
    name: "OPENAI",
    style(input) {
      const parsedPrompt = stylePromptSchema.safeParse(input.prompt);
      if (!parsedPrompt.success) {
        return Promise.reject(
          new OpenAIImageAdapterError(
            "PROVIDER_REQUEST_FAILED",
            "The image style prompt must be a non-empty string.",
          ),
        );
      }
      return styleWithFingerprint({ ...input, prompt: parsedPrompt.data });
    },
  };
}
