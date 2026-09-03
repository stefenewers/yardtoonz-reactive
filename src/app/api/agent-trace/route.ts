import { NextResponse } from "next/server";

import { apiError, invalidRequest } from "@/server/api-response";
import {
  getAgentTraceService,
  type AgentTraceOutcome,
} from "@/server/agents/service";
import type { AgentTraceQuery } from "@/shared/agents";
import {
  agentTraceQuerySchema,
  agentTraceResponseSchema,
} from "@/shared/agents";

export const dynamic = "force-dynamic";

function resolveOutcome(query: AgentTraceQuery): AgentTraceOutcome {
  if (query.candidateId !== undefined) {
    return getAgentTraceService().listForCandidate(query.candidateId);
  }
  if (query.productionId !== undefined) {
    return getAgentTraceService().listForProduction(query.productionId);
  }
  // Unreachable: the query schema requires exactly one subject.
  throw new Error("Agent trace query resolved to no subject");
}

/** Ordered agent-run trace for exactly one subject: candidate or production. */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const query = agentTraceQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const outcome = resolveOutcome(query);

    if (outcome === "CANDIDATE_NOT_FOUND") {
      return apiError("CANDIDATE_NOT_FOUND", "Candidate not found.", 404);
    }
    if (outcome === "PRODUCTION_NOT_FOUND") {
      return apiError("PRODUCTION_NOT_FOUND", "Production not found.", 404);
    }

    return NextResponse.json(agentTraceResponseSchema.parse(outcome));
  } catch (error) {
    return invalidRequest(error, "Agent trace");
  }
}
