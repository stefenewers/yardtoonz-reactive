import { NextResponse } from "next/server";

import { apiError } from "@/server/api-response";
import { directorErrorResponse } from "@/server/director/http";
import { getDirectorTreatmentService } from "@/server/director/service";
import {
  createDirectorTreatmentRequestSchema,
  directorTreatmentQuerySchema,
  directorTreatmentResponseSchema,
} from "@/domain/director";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const input = createDirectorTreatmentRequestSchema.parse(
      await request.json(),
    );
    const outcome = await getDirectorTreatmentService().create(input);
    if (outcome === "CANDIDATE_NOT_FOUND") {
      return apiError("CANDIDATE_NOT_FOUND", "Candidate not found.", 404);
    }

    return NextResponse.json(
      directorTreatmentResponseSchema.parse({ treatment: outcome }),
    );
  } catch (error) {
    return directorErrorResponse(error);
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const query = directorTreatmentQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const outcome = getDirectorTreatmentService().getForCandidate(
      query.candidateId,
    );
    if (!outcome) {
      return apiError(
        "TREATMENT_NOT_FOUND",
        "No director treatment exists for this candidate.",
        404,
      );
    }

    return NextResponse.json(
      directorTreatmentResponseSchema.parse({ treatment: outcome }),
    );
  } catch (error) {
    return directorErrorResponse(error);
  }
}
