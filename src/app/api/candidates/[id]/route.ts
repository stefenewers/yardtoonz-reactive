import { NextResponse } from "next/server";

import { apiError, invalidRequest } from "@/server/api-response";
import { getCandidateRepository } from "@/server/candidates/service";
import {
  approveCandidateResponseSchema,
  updateCandidateRequestSchema,
} from "@/shared/candidates";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const input = updateCandidateRequestSchema.parse(await request.json());
    const { id } = await context.params;
    const repository = getCandidateRepository();
    const decidedAt = new Date().toISOString();

    const outcome =
      input.status === "APPROVED"
        ? repository.approve(id, decidedAt)
        : input.status === "REJECTED"
          ? repository.reject(id, decidedAt, input.reason)
          : repository.restore(id, decidedAt);

    if (outcome === undefined || outcome === "NOT_FOUND") {
      return apiError("CANDIDATE_NOT_FOUND", "Candidate not found.", 404);
    }
    if (outcome === "INVALID_TRANSITION") {
      return apiError(
        "CANDIDATE_DECISION_CONFLICT",
        "This editorial decision is not allowed for the candidate's current status.",
        409,
      );
    }

    return NextResponse.json(
      approveCandidateResponseSchema.parse({ candidate: outcome }),
    );
  } catch (error) {
    return invalidRequest(error);
  }
}
