import { NextResponse } from "next/server";

import { invalidRequest } from "@/server/api-response";
import { getCandidateRepository } from "@/server/candidates/service";
import {
  candidateListQuerySchema,
  listCandidatesResponseSchema,
} from "@/shared/candidates";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const query = candidateListQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const response = listCandidatesResponseSchema.parse({
      candidates: getCandidateRepository().list(query),
    });
    return NextResponse.json(response);
  } catch (error) {
    return invalidRequest(error);
  }
}
