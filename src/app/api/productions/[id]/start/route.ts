import { NextResponse } from "next/server";

import { productionErrorResponse } from "@/server/productions/http";
import { getProductionRepository } from "@/server/productions/service";
import { productionDetailResponseSchema } from "@/shared/productions";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

/**
 * Atomically starts a production: persisted rights, approved candidate,
 * probed source vs. segment, and the one-active-job-per-candidate rule are
 * all verified inside the same transaction that flips status to QUEUED.
 */
export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const detail = getProductionRepository().start(id, new Date());
    return NextResponse.json(productionDetailResponseSchema.parse(detail));
  } catch (error) {
    return productionErrorResponse(error);
  }
}
