import { NextResponse } from "next/server";

import { productionErrorResponse } from "@/server/productions/http";
import { getProductionRepository } from "@/server/productions/service";
import { ProductionGateError } from "@/server/productions/errors";
import {
  productionDetailResponseSchema,
  updateProductionRequestSchema,
  type ProductionDetailResponse,
} from "@/shared/productions";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const detail = getProductionRepository().getDetail(id);
    if (!detail) {
      return productionErrorResponse(
        new ProductionGateError("PRODUCTION_NOT_FOUND"),
      );
    }

    return NextResponse.json(productionDetailResponseSchema.parse(detail));
  } catch (error) {
    return productionErrorResponse(error);
  }
}

/**
 * PATCH applies the pre-queue setup: persisted rights confirmation first,
 * then segment / creative-direction updates. Queued and worker-owned jobs
 * reject setup changes with ILLEGAL_TRANSITION.
 */
export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const body = updateProductionRequestSchema.parse(await request.json());
    const repository = getProductionRepository();
    const now = new Date();

    let detail: ProductionDetailResponse | undefined;
    if (body.rights) {
      detail = repository.confirmRights(id, now);
    }
    if (body.segment !== undefined || body.creativeDirection !== undefined) {
      detail = repository.updateSetup(
        id,
        { segment: body.segment, creativeDirection: body.creativeDirection },
        now,
      );
    }
    if (!detail) {
      // Unreachable: the request schema requires at least one field.
      detail = repository.getDetail(id);
    }
    if (!detail) {
      return productionErrorResponse(
        new ProductionGateError("PRODUCTION_NOT_FOUND"),
      );
    }

    return NextResponse.json(productionDetailResponseSchema.parse(detail));
  } catch (error) {
    return productionErrorResponse(error);
  }
}
