import { NextResponse } from "next/server";

import { apiError } from "@/server/api-response";

import { productionErrorResult } from "./errors";

/**
 * Single catch-block helper for production routes: typed failures become
 * their stable code + safe message; anything unexpected is logged and
 * answered with a generic 500 so internals never leak into responses.
 */
export function productionErrorResponse(error: unknown): NextResponse {
  const result = productionErrorResult(error);
  if (result) return apiError(result.code, result.message, result.status);

  console.error("Production API request failed", error);
  return apiError("INTERNAL_ERROR", "The request could not be completed.", 500);
}
