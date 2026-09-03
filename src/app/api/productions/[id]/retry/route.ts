import { NextResponse } from "next/server";

import { productionErrorResponse } from "@/server/productions/http";
import {
  getProductionRepository,
  getProductionWorkerRepository,
} from "@/server/productions/service";
import { productionDetailResponseSchema } from "@/shared/productions";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

/**
 * Re-arms a FAILED production through the domain RETRY transition: every
 * required upstream artifact is re-verified against storage (existence and
 * digest) before a fresh stage attempt is seeded. Upstream artifacts are
 * never rewritten, and the response is the re-armed production detail.
 */
export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
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
