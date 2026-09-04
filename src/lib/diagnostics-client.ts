import type { DiagnosticsResponse } from "../shared/diagnostics";
import { diagnosticsResponseSchema } from "../shared/diagnostics";
import type { ZodType } from "zod";

/**
 * Browser client for the read-only provider diagnostics API. Failures surface
 * as DiagnosticsApiError with a stable, human-explainable code.
 */

export class DiagnosticsApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

type DiagnosticsFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const unavailableError = (cause: unknown) =>
  new DiagnosticsApiError(
    "DIAGNOSTICS_UNAVAILABLE",
    "The diagnostics service could not be reached. Try again.",
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
    throw new DiagnosticsApiError(
      "DIAGNOSTICS_REQUEST_FAILED",
      "The diagnostics service rejected the request.",
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new DiagnosticsApiError(
      "INVALID_DIAGNOSTICS_RESPONSE",
      "The diagnostics service returned an invalid response.",
    );
  }
  return parsed.data;
}

export interface DiagnosticsApiClient {
  /** Full read-only snapshot: environment credential state plus every job. */
  getSnapshot(): Promise<DiagnosticsResponse>;
}

export function createApiDiagnosticsClient(
  diagnosticsFetch: DiagnosticsFetch = fetch,
): DiagnosticsApiClient {
  return {
    async getSnapshot() {
      let response: Response;
      try {
        response = await diagnosticsFetch("/api/diagnostics", {
          method: "GET",
        });
      } catch (cause) {
        throw unavailableError(cause);
      }
      return parsePayload(response, diagnosticsResponseSchema);
    },
  };
}
