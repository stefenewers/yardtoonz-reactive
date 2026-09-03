import { NextResponse } from "next/server";

import { apiError, invalidRequest } from "@/server/api-response";
import { createHumorAnalysisRequestSchema } from "@/domain/humor-analysis";
import { getHumorAnalysisService } from "@/server/humor-analysis/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    // The candidate id is validated through the shared create contract;
    // the request body is intentionally empty — analysis reads the
    // candidate's persisted corpus, never client-supplied comments.
    const { candidateId } = createHumorAnalysisRequestSchema.parse({
      candidateId: (await context.params).id,
    });

    const result = getHumorAnalysisService().analyze(candidateId);
    switch (result.outcome) {
      case "CANDIDATE_NOT_FOUND":
        return apiError("CANDIDATE_NOT_FOUND", "Candidate not found.", 404);
      case "CREATED":
        return NextResponse.json({ analysis: result.analysis });
    }
  } catch (error) {
    return invalidRequest(error, "Humor analysis");
  }
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { candidateId } = createHumorAnalysisRequestSchema.parse({
      candidateId: (await context.params).id,
    });
    const analysis = getHumorAnalysisService().getForCandidate(candidateId);
    if (!analysis) {
      return apiError(
        "HUMOR_ANALYSIS_NOT_FOUND",
        "No humor analysis exists for this candidate yet.",
        404,
      );
    }

    return NextResponse.json({ analysis });
  } catch (error) {
    return invalidRequest(error, "Humor analysis");
  }
}
