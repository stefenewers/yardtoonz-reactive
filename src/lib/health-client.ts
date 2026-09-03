import { publicHealthReportSchema } from "../shared/health";
import type { PublicHealthReportPayload } from "../shared/health";

export type HealthFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const UNAVAILABLE_MESSAGE = "Health status is unavailable.";

/**
 * Reads the public health report. The endpoint returns 503 for degraded
 * systems with a still-valid body, so HTTP status alone never decides the
 * outcome — the validated payload does.
 */
export async function fetchHealthReport(
  healthFetch: HealthFetch = fetch,
): Promise<PublicHealthReportPayload> {
  let response: Response;
  try {
    response = await healthFetch("/api/health");
  } catch (cause) {
    throw new Error(UNAVAILABLE_MESSAGE, { cause });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new Error(UNAVAILABLE_MESSAGE, { cause });
  }

  const parsed = publicHealthReportSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(UNAVAILABLE_MESSAGE, { cause: parsed.error });
  }
  return parsed.data;
}
