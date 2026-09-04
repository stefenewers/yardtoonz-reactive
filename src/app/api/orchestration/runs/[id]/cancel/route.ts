import { NextResponse } from "next/server";

import { apiError, invalidRequest } from "@/server/api-response";
import { getOrchestrationService } from "@/server/orchestration/service";
import {
  cancelRunRequestSchema,
  runDetailResponseSchema,
} from "@/shared/orchestration";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Cancel an active run; terminal, matching the MVP's human control. */
export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const input = cancelRunRequestSchema.parse(await request.json());
    const outcome = getOrchestrationService().cancel(id, input.reason);

    if (outcome === "RUN_NOT_FOUND") {
      return apiError("RUN_NOT_FOUND", "Orchestration run not found.", 404);
    }
    if (outcome === "CANCEL_NOT_ALLOWED") {
      return apiError(
        "CANCEL_NOT_ALLOWED",
        "Only a RUNNING or FAILED run can be cancelled.",
        409,
      );
    }

    return NextResponse.json(runDetailResponseSchema.parse(outcome));
  } catch (error) {
    return invalidRequest(error, "Orchestration");
  }
}
