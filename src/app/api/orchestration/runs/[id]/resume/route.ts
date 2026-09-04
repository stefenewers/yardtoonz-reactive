import { NextResponse } from "next/server";

import { apiError, invalidRequest } from "@/server/api-response";
import { getOrchestrationService } from "@/server/orchestration/service";
import { runDetailResponseSchema } from "@/shared/orchestration";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Re-enter a FAILED run after the underlying subsystem recovered. */
export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const outcome = getOrchestrationService().resume(id);

    if (outcome === "RUN_NOT_FOUND") {
      return apiError("RUN_NOT_FOUND", "Orchestration run not found.", 404);
    }
    if (outcome === "RESUME_NOT_ALLOWED") {
      return apiError(
        "RESUME_NOT_ALLOWED",
        "Only a FAILED run can be resumed.",
        409,
      );
    }

    return NextResponse.json(runDetailResponseSchema.parse(outcome));
  } catch (error) {
    return invalidRequest(error, "Orchestration");
  }
}
