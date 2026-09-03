import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { apiError } from "@/server/api-response";

import { DirectorTreatmentError } from "./service";

/**
 * Single catch-block helper for Director routes: typed failures become
 * their stable code + safe message; anything unexpected is logged and
 * answered with a generic 500 so internals never leak into responses.
 *
 * TREATMENT_UNRESOLVED is a 409 on purpose: the live request's remote
 * outcome is unknown, the recorded request ID (when the provider issued
 * one) is how a human reconciles it, and regeneration is a human-approved
 * decision — never an automatic retry.
 */
export function directorErrorResponse(error: unknown): NextResponse {
  if (error instanceof DirectorTreatmentError) {
    if (error.code === "TREATMENT_UNRESOLVED") {
      const suffix = error.requestId ? ` (request ID ${error.requestId})` : "";
      return apiError(
        "TREATMENT_UNRESOLVED",
        `The Director treatment request did not complete and its outcome is unknown${suffix}. Reconcile by request ID before any retry; regenerating requires human approval.`,
        409,
      );
    }
    return apiError(
      "PROVIDER_REQUEST_FAILED",
      "The live Director provider could not complete the request.",
      502,
    );
  }

  if (error instanceof ZodError || error instanceof SyntaxError) {
    return apiError("INVALID_REQUEST", "The request body is invalid.", 400);
  }

  console.error("Director API request failed", error);
  return apiError("INTERNAL_ERROR", "The request could not be completed.", 500);
}
