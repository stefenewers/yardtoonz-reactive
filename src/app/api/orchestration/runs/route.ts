import { NextResponse } from "next/server";

import { apiError, invalidRequest } from "@/server/api-response";
import { getOrchestrationService } from "@/server/orchestration/service";
import {
  listRunsResponseSchema,
  orchestrationRunsQuerySchema,
  runDetailResponseSchema,
  startRunRequestSchema,
} from "@/shared/orchestration";

export const dynamic = "force-dynamic";

/** Start (or idempotently return) the six-agent run for one candidate. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const input = startRunRequestSchema.parse(await request.json());
    const outcome = getOrchestrationService().start(input.candidateId);

    if (outcome === "CANDIDATE_NOT_FOUND") {
      return apiError("CANDIDATE_NOT_FOUND", "Candidate not found.", 404);
    }

    return NextResponse.json(
      runDetailResponseSchema.parse({
        run: outcome.run,
        timeline: outcome.timeline,
      }),
      { status: outcome.created ? 201 : 200 },
    );
  } catch (error) {
    return invalidRequest(error, "Orchestration");
  }
}

/** Run history for one candidate, newest first. */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const query = orchestrationRunsQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const runs = getOrchestrationService().listForCandidate(query.candidateId);
    return NextResponse.json(listRunsResponseSchema.parse({ runs }));
  } catch (error) {
    return invalidRequest(error, "Orchestration");
  }
}
