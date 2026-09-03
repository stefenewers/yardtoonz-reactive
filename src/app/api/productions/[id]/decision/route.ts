import { NextResponse } from "next/server";

import { productionErrorResponse } from "@/server/productions/http";
import { getProductionRepository } from "@/server/productions/service";
import {
  productionDetailResponseSchema,
  recordOutputDecisionRequestSchema,
} from "@/shared/productions";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

/**
 * Records the producer's editorial decision on a COMPLETE production's
 * output. The verdict persists as an OUTPUT editorial_decisions row; the
 * response is the refreshed detail so the UI shows the authoritative
 * decision with its timestamp. Approval records editorial acceptance only —
 * nothing is published (UX specification §3, step 5).
 */
export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const body = recordOutputDecisionRequestSchema.parse(await request.json());
    const detail = getProductionRepository().recordOutputDecision(
      id,
      body,
      new Date(),
    );
    return NextResponse.json(productionDetailResponseSchema.parse(detail));
  } catch (error) {
    return productionErrorResponse(error);
  }
}
