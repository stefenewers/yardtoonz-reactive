import { NextResponse } from "next/server";

import { apiError, invalidRequest } from "@/server/api-response";
import { getCandidateRepository } from "@/server/candidates/service";
import {
  approveCandidateRequestSchema,
  approveCandidateResponseSchema,
} from "@/shared/candidates";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    approveCandidateRequestSchema.parse(await request.json());
    const { id } = await context.params;
    const candidate = getCandidateRepository().approve(
      id,
      new Date().toISOString(),
    );
    if (!candidate) {
      return apiError("CANDIDATE_NOT_FOUND", "Candidate not found.", 404);
    }

    return NextResponse.json(
      approveCandidateResponseSchema.parse({ candidate }),
    );
  } catch (error) {
    return invalidRequest(error);
  }
}
