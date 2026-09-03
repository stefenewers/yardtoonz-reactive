import { z } from "zod";

/**
 * Runway animation provider contract (Technical Specification §5; amendment
 * art_2yKin00n). This module is the only place that knows the remote
 * animation API's wire shape; the worker pipeline depends on the normalized
 * outcome types below, never on raw responses.
 *
 * Remote outcomes are classified into three honest buckets:
 * - terminal success/failure (proven by the provider),
 * - still in progress,
 * - UNKNOWN — transport errors, malformed responses, or unrecognized task
 *   states. Unknown outcomes are never retried blindly; they fail the stage
 *   deterministically so a later attempt reconciles by request ID first.
 */

export type RunwayAnimationErrorCode =
  | "PROVIDER_REQUEST_FAILED"
  | "PROVIDER_UNKNOWN_OUTCOME";

/** Typed provider failure. `requestId` enables reconcile-before-retry. */
export class RunwayAnimationError extends Error {
  constructor(
    public readonly code: RunwayAnimationErrorCode,
    message: string,
    public readonly requestId: string | null = null,
    options?: { cause?: unknown },
  ) {
    super(
      requestId ? `${message} (provider request ${requestId})` : message,
      options,
    );
    this.name = "RunwayAnimationError";
  }
}

/** Normalized remote task state the pipeline can act on. */
export type RunwayTaskOutcome =
  | {
      readonly kind: "SUCCEEDED";
      readonly requestId: string;
      readonly outputUrl: string;
    }
  | {
      readonly kind: "FAILED";
      readonly requestId: string;
      readonly reason: string | null;
    }
  | { readonly kind: "CANCELLED"; readonly requestId: string }
  | { readonly kind: "IN_PROGRESS"; readonly requestId: string }
  | {
      readonly kind: "UNKNOWN";
      readonly requestId: string | null;
      readonly detail: string;
    };

const nonEmptyString = z.string().trim().min(1);

/**
 * External input boundary: every remote response is validated before use.
 * `status` is deliberately a plain string so unrecognized provider states
 * surface as UNKNOWN outcomes instead of crashing the stage.
 */
const taskSnapshotSchema = z.object({
  id: nonEmptyString,
  status: nonEmptyString,
  output: z.array(nonEmptyString).optional(),
  failure: z.string().optional(),
});

export type RunwayTaskSnapshot = z.infer<typeof taskSnapshotSchema>;

/** Non-terminal provider states; anything else is terminal or unknown. */
const inProgressStatuses = new Set(["PENDING", "THROTTLED", "RUNNING"]);

/**
 * Pure outcome classification (unit-tested). A SUCCEEDED task without an
 * output URL is not usable media — it is an UNKNOWN outcome, not a success.
 */
export function classifyRunwayTask(
  snapshot: RunwayTaskSnapshot,
): RunwayTaskOutcome {
  const { id, status } = snapshot;
  if (status === "SUCCEEDED") {
    const outputUrl = snapshot.output?.find((url) => url.length > 0);
    return outputUrl
      ? { kind: "SUCCEEDED", requestId: id, outputUrl }
      : {
          kind: "UNKNOWN",
          requestId: id,
          detail: "succeeded task returned no output URL",
        };
  }
  if (status === "FAILED") {
    return { kind: "FAILED", requestId: id, reason: snapshot.failure ?? null };
  }
  if (status === "CANCELLED") {
    return { kind: "CANCELLED", requestId: id };
  }
  if (inProgressStatuses.has(status)) {
    return { kind: "IN_PROGRESS", requestId: id };
  }
  return {
    kind: "UNKNOWN",
    requestId: id,
    detail: `unrecognized task status ${status}`,
  };
}

export interface RunwayGenerateInput {
  readonly imageBytes: Uint8Array;
  readonly imageMimeType: string;
  readonly model: string;
  readonly durationSeconds: number;
}

export interface RunwayTransport {
  /** Submits one image-to-video generation and returns its request ID. */
  createAnimationTask(input: RunwayGenerateInput): Promise<string>;
  /** Reconciles or polls one request by its provider request ID. */
  getTask(requestId: string): Promise<RunwayTaskSnapshot>;
  /** Downloads the finished video bytes from the provider output URL. */
  downloadOutput(outputUrl: string): Promise<Uint8Array>;
}

const acceptedTaskSchema = taskSnapshotSchema;

/**
 * Live-verified create response: the API answers 200 with the task `id` and
 * cost metadata — no `status` field at creation time — so creation parses a
 * dedicated shape instead of the full task snapshot.
 */
const acceptedCreateSchema = z.object({
  id: nonEmptyString,
  estimatedCost: z.unknown().optional(),
});

/**
 * Error text reports the HTTP status only. Provider response bodies are
 * untrusted input and are never echoed into messages, logs, or persisted
 * stage errors — they can carry anything, including reflected credentials.
 */
function describeApiError(status: number): string {
  return `Runway API returned ${status}`;
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

export interface HttpRunwayTransportOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly apiVersion?: string;
  readonly fetchImpl?: typeof fetch;
  readonly requestTimeoutMs?: number;
}

const defaultBaseUrl = "https://api.dev.runwayml.com";
const defaultApiVersion = "2024-11-06";

function toDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

/**
 * Default HTTP transport for the Runway task-based image-to-video API.
 * Wire details (endpoint paths, body fields, version header) are encoded
 * here from the documented task API and are corrected in place by the
 * bounded live smoke test — contract tests never touch this transport.
 */
export function createHttpRunwayTransport(
  options: HttpRunwayTransportOptions,
): RunwayTransport {
  const {
    apiKey,
    baseUrl = defaultBaseUrl,
    apiVersion = defaultApiVersion,
    fetchImpl = fetch,
    requestTimeoutMs = 30_000,
  } = options;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-Runway-Version": apiVersion,
  };

  async function request(
    url: string,
    init: RequestInit,
  ): Promise<{ status: number; body: string }> {
    const response = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    return { status: response.status, body: await response.text() };
  }

  return {
    async createAnimationTask(input: RunwayGenerateInput): Promise<string> {
      const { status, body } = await request(`${baseUrl}/v1/image_to_video`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: input.model,
          promptImage: toDataUrl(input.imageBytes, input.imageMimeType),
          ratio: "720:1280",
          duration: Math.round(input.durationSeconds),
        }),
      });
      if (status !== 201 && status !== 200) {
        throw new RunwayAnimationError(
          "PROVIDER_UNKNOWN_OUTCOME",
          describeApiError(status),
        );
      }
      const parsed = acceptedCreateSchema.safeParse(safeJson(body));
      if (!parsed.success) {
        throw new RunwayAnimationError(
          "PROVIDER_UNKNOWN_OUTCOME",
          "Runway task creation returned an unparseable response",
        );
      }
      return parsed.data.id;
    },

    async getTask(requestId: string): Promise<RunwayTaskSnapshot> {
      const { status, body } = await request(
        `${baseUrl}/v1/tasks/${encodeURIComponent(requestId)}`,
        { method: "GET", headers },
      );
      if (status === 404) {
        // A missing task is a proven fact (never created or purged), not an
        // unknown outcome; the caller may safely generate a new request.
        throw new RunwayAnimationError(
          "PROVIDER_REQUEST_FAILED",
          "Runway task not found for request ID",
          requestId,
        );
      }
      if (status !== 200) {
        throw new RunwayAnimationError(
          "PROVIDER_UNKNOWN_OUTCOME",
          describeApiError(status),
          requestId,
        );
      }
      const parsed = taskSnapshotSchema.safeParse(safeJson(body));
      if (!parsed.success) {
        throw new RunwayAnimationError(
          "PROVIDER_UNKNOWN_OUTCOME",
          "Runway task status returned an unparseable response",
          requestId,
        );
      }
      return parsed.data;
    },

    async downloadOutput(outputUrl: string): Promise<Uint8Array> {
      const response = await fetchImpl(outputUrl, {
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (!response.ok) {
        throw new RunwayAnimationError(
          "PROVIDER_UNKNOWN_OUTCOME",
          `Runway output download returned ${response.status}`,
        );
      }
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
