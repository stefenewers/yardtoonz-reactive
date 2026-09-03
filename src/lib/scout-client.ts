import type { ZodType } from "zod";

import { apiErrorResponseSchema } from "../shared/candidates";
import {
  latestScoutRunResponseSchema,
  listScoutRunsResponseSchema,
  runScoutResponseSchema,
  type FeedRunResource,
  type RunScoutRequest,
} from "../shared/trend-scout";

/**
 * Typed client for the Run-Scout API. Responses are validated against the
 * shared scout contracts before they reach the UI, so the header never
 * renders an untrusted payload.
 */
export interface ScoutApiClient {
  /** Run the scout across all themed feeds (or the requested ones). */
  runScout(request?: RunScoutRequest): Promise<FeedRunResource>;
  /** Full run history, newest first. */
  listRuns(): Promise<FeedRunResource[]>;
  /** The most recent run, or undefined before the first scout run. */
  fetchLatestRun(): Promise<FeedRunResource | undefined>;
}

type ScoutFetch = (input: string, init?: RequestInit) => Promise<Response>;

async function parseScoutResponse<T>(
  response: Response,
  schema: ZodType<T>,
): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new Error("Scout service returned an invalid response.", { cause });
  }

  if (!response.ok) {
    const apiError = apiErrorResponseSchema.safeParse(payload);
    throw new Error(
      apiError.success
        ? apiError.data.error.message
        : "Scout service request failed.",
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Scout service returned an invalid response.", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export function createApiScoutClient(
  scoutFetch: ScoutFetch = fetch,
): ScoutApiClient {
  return {
    async runScout(request) {
      const response = await scoutFetch("/api/scout/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request ?? {}),
      });
      const { run } = await parseScoutResponse(
        response,
        runScoutResponseSchema,
      );
      return run;
    },

    async listRuns() {
      const response = await scoutFetch("/api/scout/runs");
      const { runs } = await parseScoutResponse(
        response,
        listScoutRunsResponseSchema,
      );
      return runs;
    },

    async fetchLatestRun() {
      const response = await scoutFetch("/api/scout/runs/latest");
      if (response.status === 404) return undefined;
      const { run } = await parseScoutResponse(
        response,
        latestScoutRunResponseSchema,
      );
      return run ?? undefined;
    },
  };
}
