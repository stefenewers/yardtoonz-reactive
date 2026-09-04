import { NextResponse } from "next/server";

import { productionErrorResponse } from "@/server/productions/http";
import {
  getProductionRepository,
  getProductionWorkerRepository,
} from "@/server/productions/service";
import { ProductionGateError } from "@/server/productions/errors";
import {
  productionDetailResponseSchema,
  productionRetryRequestSchema,
} from "@/shared/productions";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

/**
 * Re-arms a FAILED production through the domain RETRY transition after the
 * request carries an explicit human retry approval: every required upstream
 * artifact is re-verified against storage (existence and digest) before a
 * fresh stage attempt is seeded. Requests without the approval payload are
 * rejected with RETRY_APPROVAL_REQUIRED, so paid output is never
 * regenerated automatically. Upstream artifacts are never rewritten, and
 * the response is the re-armed production detail.
 */
export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    // API-gate approval: regenerating paid provider output requires an
    // explicit human confirmation payload. Missing, malformed, or
    // declined approval never reaches the worker repository, so a retry
    // can never be triggered automatically.
    const body: unknown = await request.json().catch(() => undefined);
    const parsed = productionRetryRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ProductionGateError("RETRY_APPROVAL_REQUIRED");
    }
    await getProductionWorkerRepository().retryFailedStage(id, new Date());
    const detail = getProductionRepository().getDetail(id);
    if (!detail) {
      return productionErrorResponse(undefined);
    }
    return NextResponse.json(productionDetailResponseSchema.parse(detail));
  } catch (error) {
    return productionErrorResponse(error);
  }
}
