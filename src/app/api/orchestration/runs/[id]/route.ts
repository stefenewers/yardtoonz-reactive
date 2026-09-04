import { NextResponse } from "next/server";

import { apiError, invalidRequest } from "@/server/api-response";
import { getOrchestrationService } from "@/server/orchestration/service";
import { runDetailResponseSchema } from "@/shared/orchestration";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Run detail with the freshly derived demo timeline. */
export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const outcome = getOrchestrationService().get(id);

    if (outcome === "RUN_NOT_FOUND") {
      return apiError("RUN_NOT_FOUND", "Orchestration run not found.", 404);
    }

    return NextResponse.json(runDetailResponseSchema.parse(outcome));
  } catch (error) {
    return invalidRequest(error, "Orchestration");
  }
}
