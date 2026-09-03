import type { HumorAnalysisResource } from "@/domain/humor-analysis";
import { humorAnalysisResponseSchema } from "@/domain/humor-analysis";
import type { ZodType } from "zod";

/**
 * Browser client for the persisted humor-analysis APIs. Failures surface
 * as HumorAnalysisApiError carrying the stable API error code so the
 * analyst panel can explain exactly why evidence is missing (mirrors the
 * storyboard client contract).
 */

export class HumorAnalysisApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

type HumorAnalysisFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const unavailableError = (cause: unknown) =>
  new HumorAnalysisApiError(
    "HUMOR_ANALYSIS_UNAVAILABLE",
    "The humor analysis service could not be reached. Try again.",
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
    throw new HumorAnalysisApiError(
      apiError?.code ?? "HUMOR_ANALYSIS_REQUEST_FAILED",
      apiError?.message ?? "The humor analysis service rejected the request.",
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new HumorAnalysisApiError(
      "INVALID_HUMOR_ANALYSIS_RESPONSE",
      "The humor analysis service returned an invalid response.",
    );
  }
  return parsed.data;
}

export interface HumorAnalysisApiClient {
  getForCandidate(candidateId: string): Promise<HumorAnalysisResource>;
  /** Analyze-and-refresh; the response is the persisted analysis resource. */
  createForCandidate(candidateId: string): Promise<HumorAnalysisResource>;
}

export function createApiHumorAnalysisClient(
  fetchImpl: HumorAnalysisFetch = fetch,
): HumorAnalysisApiClient {
  return {
    async getForCandidate(candidateId: string) {
      const response = await fetchImpl(
        `/api/candidates/${encodeURIComponent(candidateId)}/analysis`,
      ).catch((cause: unknown) => {
        throw unavailableError(cause);
      });
      const payload = await parsePayload(response, humorAnalysisResponseSchema);
      return payload.analysis;
    },

    async createForCandidate(candidateId: string) {
      const response = await fetchImpl(
        `/api/candidates/${encodeURIComponent(candidateId)}/analysis`,
        { method: "POST" },
      ).catch((cause: unknown) => {
        throw unavailableError(cause);
      });
      const payload = await parsePayload(response, humorAnalysisResponseSchema);
      return payload.analysis;
    },
  };
}
