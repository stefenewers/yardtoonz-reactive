import type { ZodType } from "zod";

import { apiErrorResponseSchema } from "../shared/candidates";
import {
  importCandidatesResponseSchema,
  type ManualCandidateIntake,
} from "../shared/candidate-intake";

/**
 * Typed client for manual candidate intake. A pasted social URL is stored
 * verbatim as a source reference — the service never fetches platform
 * content — and the validated import result drives the inbox refresh.
 */
export interface ManualIntakeApiClient {
  /**
   * Import one operator-supplied candidate from a pasted social post URL.
   */
  importManualCandidate(candidate: ManualCandidateIntake): Promise<{
    providerKind: string;
    imported: number;
    candidateIds: string[];
  }>;
}

type ManualIntakeFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

async function parseIntakeResponse<T>(
  response: Response,
  schema: ZodType<T>,
): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new Error("Candidate intake returned an invalid response.", {
      cause,
    });
  }

  if (!response.ok) {
    const apiError = apiErrorResponseSchema.safeParse(payload);
    throw new Error(
      apiError.success
        ? apiError.data.error.message
        : "Candidate intake request failed.",
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Candidate intake returned an invalid response.", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export function createApiManualIntakeClient(
  intakeFetch: ManualIntakeFetch = fetch,
): ManualIntakeApiClient {
  return {
    async importManualCandidate(candidate) {
      const response = await intakeFetch("/api/candidates/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "MANUAL", candidate }),
      });
      const { import: result } = await parseIntakeResponse(
        response,
        importCandidatesResponseSchema,
      );
      return result;
    },
  };
}
