import { NextResponse } from "next/server";

import { getCandidateRepository } from "@/server/candidates/service";
import { listCandidatesResponseSchema } from "@/shared/candidates";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const response = listCandidatesResponseSchema.parse({
    candidates: getCandidateRepository().list(),
  });
  return NextResponse.json(response);
}
