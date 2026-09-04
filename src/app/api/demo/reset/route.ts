import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, invalidRequest } from "@/server/api-response";
import { resetDemoData } from "@/server/db/reset";
import { parseServerEnvironment } from "@/lib/env-schema";

export const dynamic = "force-dynamic";

const resetDemoRequestSchema = z
  .object({ confirmation: z.literal(true) })
  .strict();

/**
 * Guarded rehearsal reset: reuses the proven `demo:reset` script semantics
 * (wipe the demo database and artifact root, reseed fixtures) behind three
 * guards — an explicit confirmation body, a non-production runtime, and
 * MOCK/MOCK provider mode. Live-provider credentials never run next to a
 * bulk delete.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (process.env.NODE_ENV === "production") {
    return apiError(
      "DEMO_RESET_DISABLED",
      "The demo reset control is disabled outside local demo mode.",
      403,
    );
  }

  // Parsed per request (not the cached singleton) so the guard reflects the
  // environment a rehearsal is actually running in.
  let environment: ReturnType<typeof parseServerEnvironment>;
  try {
    environment = parseServerEnvironment(process.env);
  } catch (error) {
    return invalidRequest(error, "Demo reset environment");
  }
  if (
    environment.IMAGE_PROVIDER !== "MOCK" ||
    environment.ANIMATION_PROVIDER !== "MOCK"
  ) {
    return apiError(
      "DEMO_RESET_PROVIDER_GUARD",
      "The demo reset control requires MOCK image and animation providers.",
      403,
    );
  }

  let confirmation: boolean;
  try {
    confirmation = resetDemoRequestSchema.safeParse(
      await request.json(),
    ).success;
  } catch {
    confirmation = false;
  }
  if (!confirmation) {
    return apiError(
      "RESET_CONFIRMATION_REQUIRED",
      'Send { "confirmation": true } to reset the demo data.',
      400,
    );
  }

  try {
    const result = await resetDemoData(environment);
    return NextResponse.json({
      reset: { seededCandidates: result.seededCandidates },
    });
  } catch (error) {
    return invalidRequest(error, "Demo reset");
  }
}
