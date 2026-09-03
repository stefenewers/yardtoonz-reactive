import { NextResponse } from "next/server";

import { apiError, invalidRequest } from "@/server/api-response";
import { styleGuideResponseSchema } from "@/domain/style-api";
import { styleGuideErrorCode } from "@/server/style/service";
import { getClayStyleService } from "@/server/style/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/style/palette — the clay style guide: versioned tokens, the
 * committed logo's extracted palette and conformance, and the brand
 * accent colors the conformance checker matches against.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const outcome = await getClayStyleService().getStyleGuide();
    if (!outcome.ok) {
      if (outcome.code === styleGuideErrorCode.assetUnavailable) {
        console.error("Style guide asset unavailable", outcome.cause);
      }
      return apiError(outcome.code, outcome.message, 503);
    }

    return NextResponse.json(styleGuideResponseSchema.parse(outcome.value));
  } catch (error) {
    return invalidRequest(error, "Style");
  }
}
