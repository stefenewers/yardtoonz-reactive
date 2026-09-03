import { NextResponse } from "next/server";

import { apiError, invalidRequest } from "@/server/api-response";
import {
  enrichPromptsRequestSchema,
  stylePromptResponseSchema,
} from "@/domain/style-api";
import { getClayStyleService } from "@/server/style/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/style/prompt — compose provider-ready claymation prompts
 * from a Director treatment's prompt lines plus the brand's controlled
 * style contract. Composed at this API layer; no Director coupling.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const input = enrichPromptsRequestSchema.parse(await request.json());
    const outcome = await getClayStyleService().enrichPrompts(input);
    if (!outcome.ok) {
      return apiError(outcome.code, outcome.message, 500);
    }

    return NextResponse.json(stylePromptResponseSchema.parse(outcome.value));
  } catch (error) {
    return invalidRequest(error, "Style prompt");
  }
}
