import type { StoryboardResource } from "@/domain/storyboard";
import { storyboardResponseSchema } from "@/domain/storyboard";
import type { ZodType } from "zod";

/**
 * Browser client for the persisted storyboard APIs. Failures surface as
 * StoryboardApiError carrying the stable API error code so the strip UI
 * can explain exactly why a storyboard is missing (mirrors the
 * production client contract).
 */

export class StoryboardApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

type StoryboardFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const unavailableError = (cause: unknown) =>
  new StoryboardApiError(
    "STORYBOARD_UNAVAILABLE",
    "The storyboard service could not be reached. Try again.",
    { cause },
  );

async function parsePayload<T>(
  response: Response,
  schema: ZodType<T>,
): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw unavailableError(cause);
  }

  if (!response.ok) {
    const apiError = (
      payload as { error?: { code?: string; message?: string } }
    ).error;
    throw new StoryboardApiError(
      apiError?.code ?? "STORYBOARD_REQUEST_FAILED",
      apiError?.message ?? "The storyboard service rejected the request.",
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new StoryboardApiError(
      "INVALID_STORYBOARD_RESPONSE",
      "The storyboard service returned an invalid response.",
    );
  }
  return parsed.data;
}

export interface StoryboardApiClient {
  getForCandidate(candidateId: string): Promise<StoryboardResource>;
  /** Create-or-get; the response is the persisted storyboard resource. */
  createForCandidate(candidateId: string): Promise<StoryboardResource>;
}

export function createApiStoryboardClient(
  fetchImpl: StoryboardFetch = fetch,
): StoryboardApiClient {
  return {
    async getForCandidate(candidateId: string) {
      const response = await fetchImpl(
        `/api/candidates/${encodeURIComponent(candidateId)}/storyboard`,
      ).catch((cause: unknown) => {
        throw unavailableError(cause);
      });
      const payload = await parsePayload(response, storyboardResponseSchema);
      return payload.storyboard;
    },

    async createForCandidate(candidateId: string) {
      const response = await fetchImpl(
        `/api/candidates/${encodeURIComponent(candidateId)}/storyboard`,
        { method: "POST" },
      ).catch((cause: unknown) => {
        throw unavailableError(cause);
      });
      const payload = await parsePayload(response, storyboardResponseSchema);
      return payload.storyboard;
    },
  };
}
