import { NextResponse } from "next/server";

import { apiError, invalidRequest } from "@/server/api-response";
import { storyboardParamsSchema } from "@/domain/storyboard";
import { getStoryboardService } from "@/server/storyboard/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = storyboardParamsSchema.parse(await context.params);
    const result = getStoryboardService().create(id);
    switch (result.outcome) {
      case "CANDIDATE_NOT_FOUND":
        return apiError("CANDIDATE_NOT_FOUND", "Candidate not found.", 404);
      case "TREATMENT_NOT_FOUND":
        return apiError(
          "TREATMENT_NOT_FOUND",
          "No director treatment exists for this candidate yet; ask the Director first.",
          409,
        );
      case "CONSTRAINTS_VIOLATED":
        return NextResponse.json(
          {
            error: {
              code: "STORYBOARD_CONSTRAINTS_VIOLATED",
              message:
                "The treatment's segment violates the storyboard constraints.",
              problems: result.problems,
            },
          },
          { status: 422 },
        );
      case "CREATED":
        return NextResponse.json({ storyboard: result.storyboard });
    }
  } catch (error) {
    return invalidRequest(error, "Storyboard");
  }
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = storyboardParamsSchema.parse(await context.params);
    const storyboard = getStoryboardService().getForCandidate(id);
    if (!storyboard) {
      return apiError(
        "STORYBOARD_NOT_FOUND",
        "No storyboard exists for this candidate.",
        404,
      );
    }

    return NextResponse.json({ storyboard });
  } catch (error) {
    return invalidRequest(error, "Storyboard");
  }
}
