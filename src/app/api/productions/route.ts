import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { getProductionRepository } from "@/server/productions/service";
import { productionErrorResponse } from "@/server/productions/http";
import {
  createProductionRequestSchema,
  productionDetailResponseSchema,
} from "@/shared/productions";

export const dynamic = "force-dynamic";

/**
 * Creates a DRAFT production job for an approved candidate. Omitted provider
 * selections persist the environment's configured defaults so provider
 * attribution is always recorded.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = createProductionRequestSchema.parse(await request.json());
    const repository = getProductionRepository();
    const id = repository.createDraft({
      candidateId: body.candidateId,
      segment: body.segment,
      imageProvider: body.imageProvider ?? env.IMAGE_PROVIDER,
      animationProvider: body.animationProvider ?? env.ANIMATION_PROVIDER,
      now: new Date(),
    });

    const detail = productionDetailResponseSchema.parse(
      repository.getDetail(id),
    );
    return NextResponse.json(detail, { status: 201 });
  } catch (error) {
    return productionErrorResponse(error);
  }
}
