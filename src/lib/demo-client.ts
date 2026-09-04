import type { ZodType } from "zod";

import { apiErrorResponseSchema } from "../shared/candidates";
import { demoResetResponseSchema } from "../shared/demo";

/**
 * Typed client for the guarded demo controls. Responses are validated
 * against the shared demo contract before they reach the UI, so the
 * rehearsal panel never renders an untrusted payload.
 */
export interface DemoApiClient {
  /**
   * Reset the demo database and artifact root to the seeded fixtures.
   * The server refuses the request without explicit confirmation and
   * outside guarded demo mode.
   */
  resetDemo(): Promise<{ seededCandidates: number }>;
}

type DemoFetch = (input: string, init?: RequestInit) => Promise<Response>;

async function parseDemoResponse<T>(
  response: Response,
  schema: ZodType<T>,
): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new Error("Demo service returned an invalid response.", { cause });
  }

  if (!response.ok) {
    const apiError = apiErrorResponseSchema.safeParse(payload);
    throw new Error(
      apiError.success
        ? apiError.data.error.message
        : "Demo service request failed.",
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Demo service returned an invalid response.", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export function createApiDemoClient(
  demoFetch: DemoFetch = fetch,
): DemoApiClient {
  return {
    async resetDemo() {
      const response = await demoFetch("/api/demo/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: true }),
      });
      const { reset } = await parseDemoResponse(
        response,
        demoResetResponseSchema,
      );
      return reset;
    },
  };
}
