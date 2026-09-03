import { NextResponse } from "next/server";
import { ZodError } from "zod";

import type { apiErrorCodes } from "@/shared/candidates";

type ApiErrorCode = (typeof apiErrorCodes)[number];

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function invalidRequest(error: unknown): NextResponse {
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return apiError("INVALID_REQUEST", "The request body is invalid.", 400);
  }

  console.error("Candidate API request failed", error);
  return apiError("INTERNAL_ERROR", "The request could not be completed.", 500);
}
