import { NextResponse } from "next/server";

import { apiError, invalidRequest } from "@/server/api-response";
import { getCandidateRepository } from "@/server/candidates/service";
import {
  confirmRightsResponseSchema,
  rightsConfirmationRequestSchema,
} from "@/shared/candidates";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const input = rightsConfirmationRequestSchema.parse(await request.json());
    const { id } = await context.params;
    const result = getCandidateRepository().confirmRights({
      candidateId: id,
      confirmedAt: new Date().toISOString(),
      confirmationTextVersion: input.confirmationTextVersion,
    });
    if (result === "NOT_FOUND") {
      return apiError("CANDIDATE_NOT_FOUND", "Candidate not found.", 404);
    }
    if (result === "NOT_APPROVED") {
      return apiError(
        "CANDIDATE_NOT_APPROVED",
        "Approve the candidate before confirming rights.",
        409,
      );
    }

    return NextResponse.json(
      confirmRightsResponseSchema.parse({ rightsConfirmation: result }),
    );
  } catch (error) {
    return invalidRequest(error);
  }
}
