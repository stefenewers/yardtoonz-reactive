import { NextResponse } from "next/server";

import { apiError, invalidRequest } from "@/server/api-response";
import { storyboardResponseSchema } from "@/domain/storyboard";
import { getStoryboardService } from "@/server/storyboard/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const storyboard = getStoryboardService().get(id);
    if (!storyboard) {
      return apiError("STORYBOARD_NOT_FOUND", "Storyboard not found.", 404);
    }

    return NextResponse.json(storyboardResponseSchema.parse({ storyboard }));
  } catch (error) {
    return invalidRequest(error, "Storyboard");
  }
}
