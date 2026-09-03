import { NextResponse } from "next/server";

import { invalidRequest } from "@/server/api-response";
import { getScoutRunService } from "@/server/scout/run-service";
import { latestScoutRunResponseSchema } from "@/shared/trend-scout";

export const dynamic = "force-dynamic";

/**
 * The most recent scout run for the inbox header. Before the first run
 * this answers `{ run: null }` instead of an error, so a fresh demo opens
 * with a calm empty state rather than a failure banner.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const run = getScoutRunService().latestRun() ?? null;
    return NextResponse.json(latestScoutRunResponseSchema.parse({ run }));
  } catch (error) {
    return invalidRequest(error, "Scout");
  }
}
