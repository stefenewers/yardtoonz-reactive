import { NextResponse } from "next/server";

import { apiError, invalidRequest } from "@/server/api-response";
import {
  conformanceQuerySchema,
  fixtureConformanceResponseSchema,
} from "@/domain/style-api";
import { styleGuideErrorCode } from "@/server/style/service";
import { getClayStyleService } from "@/server/style/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/style/conformance?frame=<name> — extracted palette and
 * conformance result for one named fixture frame.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const query = conformanceQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const outcome = await getClayStyleService().checkFixtureFrame(query.frame);
    if (!outcome.ok) {
      const status =
        outcome.code === styleGuideErrorCode.unknownFixture ? 400 : 503;
      if (outcome.code === styleGuideErrorCode.assetUnavailable) {
        console.error("Fixture frame asset unavailable", outcome.cause);
      }
      return apiError(outcome.code, outcome.message, status);
    }

    return NextResponse.json(
      fixtureConformanceResponseSchema.parse(outcome.value),
    );
  } catch (error) {
    return invalidRequest(error, "Style conformance");
  }
}
