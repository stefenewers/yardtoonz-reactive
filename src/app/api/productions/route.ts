import { NextResponse } from "next/server";

import { apiError } from "@/server/api-response";
import { env } from "@/lib/env";
import { getProductionRepository } from "@/server/productions/service";
import { productionErrorResponse } from "@/server/productions/http";
import { assertProviderCredentials } from "@/server/productions/provider-credentials";
import {
  createProductionRequestSchema,
  listProductionsResponseSchema,
  productionDetailResponseSchema,
} from "@/shared/productions";

export const dynamic = "force-dynamic";

/**
 * Lists one candidate's productions, newest first. The setup UI uses it to
 * recover an existing production when creation is rejected as already
 * active, so a page revisit restores the authoritative job state instead of
 * dead-ending (UX specification: "Page revisited").
 */
export async function GET(request: Request): Promise<NextResponse> {
  const candidateId = new URL(request.url).searchParams
    .get("candidateId")
    ?.trim();
  if (!candidateId) {
    return apiError(
      "INVALID_REQUEST",
      "Provide the candidateId to list productions for.",
      400,
    );
  }

  return NextResponse.json(
    listProductionsResponseSchema.parse({
      productions: getProductionRepository().listForCandidate(candidateId),
    }),
  );
}

/**
 * Creates a DRAFT production job for an approved candidate. Omitted provider
 * selections persist the environment's configured defaults so provider
 * attribution is always recorded. The EFFECTIVE selection — request value or
 * environment default — is validated against that provider's credentials
 * before persistence, so a live provider the environment cannot serve fails
 * fast at creation instead of mid-pipeline.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = createProductionRequestSchema.parse(await request.json());
    const repository = getProductionRepository();
    const imageProvider = body.imageProvider ?? env.IMAGE_PROVIDER;
    const animationProvider = body.animationProvider ?? env.ANIMATION_PROVIDER;
    assertProviderCredentials({ imageProvider, animationProvider }, env);
    const id = repository.createDraft({
      candidateId: body.candidateId,
      segment: body.segment,
      imageProvider,
      animationProvider,
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
