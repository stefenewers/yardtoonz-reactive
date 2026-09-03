import { NextResponse } from "next/server";

import { apiError, invalidRequest } from "@/server/api-response";
import { directorTreatmentResponseSchema } from "@/domain/director";
import { getDirectorTreatmentService } from "@/server/director/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const outcome = getDirectorTreatmentService().get(id);
    if (!outcome) {
      return apiError(
        "TREATMENT_NOT_FOUND",
        "Director treatment not found.",
        404,
      );
    }

    return NextResponse.json(
      directorTreatmentResponseSchema.parse({ treatment: outcome }),
    );
  } catch (error) {
    return invalidRequest(error, "Director");
  }
}
