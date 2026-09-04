import {
  agentErrorResponseSchema,
  agentTraceResponseSchema,
  type AgentTraceQuery,
  type AgentTraceResponse,
} from "../shared/agents";
import type { ZodType } from "zod";

/**
 * Browser client for the persisted agent-trace API. Mirrors the production
 * client idiom: failures surface as AgentTraceApiError carrying the stable
 * API error code, and every payload is Zod-validated before it renders.
 */

export class AgentTraceApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

type AgentTraceFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const unavailableError = (cause: unknown) =>
  new AgentTraceApiError(
    "TRACE_UNAVAILABLE",
    "The agent trace could not be reached. Try again.",
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
    const apiError = agentErrorResponseSchema.safeParse(payload);
    throw new AgentTraceApiError(
      apiError.success ? apiError.data.error.code : "TRACE_REQUEST_FAILED",
      apiError.success
        ? apiError.data.error.message
        : "The agent trace service rejected the request.",
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AgentTraceApiError(
      "INVALID_TRACE_RESPONSE",
      "The agent trace service returned an invalid response.",
    );
  }
  return parsed.data;
}

export interface AgentTraceApiClient {
  /** Ordered persisted runs for exactly one subject. */
  getTrace(query: AgentTraceQuery): Promise<AgentTraceResponse>;
}

export function createAgentTraceClient(
  traceFetch: AgentTraceFetch = fetch,
): AgentTraceApiClient {
  async function requestTrace(query: AgentTraceQuery): Promise<Response> {
    const params = new URLSearchParams();
    if (query.candidateId !== undefined) {
      params.set("candidateId", query.candidateId);
    }
    if (query.productionId !== undefined) {
      params.set("productionId", query.productionId);
    }
    let response: Response;
    try {
      response = await traceFetch(`/api/agent-trace?${params.toString()}`, {
        headers: { accept: "application/json" },
      });
    } catch (cause) {
      throw unavailableError(cause);
    }
    return response;
  }

  return {
    async getTrace(query) {
      return parsePayload(await requestTrace(query), agentTraceResponseSchema);
    },
  };
}
