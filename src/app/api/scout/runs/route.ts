import { NextResponse } from "next/server";

import { invalidRequest } from "@/server/api-response";
import { getScoutRunService } from "@/server/scout/run-service";
import {
  listScoutRunsResponseSchema,
  runScoutRequestSchema,
  runScoutResponseSchema,
} from "@/shared/trend-scout";

export const dynamic = "force-dynamic";

/** Run the Trend Scout across all themed feeds (or the requested ones). */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const input = runScoutRequestSchema.parse(await request.json());
    const run = getScoutRunService().run(input);
    return NextResponse.json(runScoutResponseSchema.parse({ run }));
  } catch (error) {
    return invalidRequest(error, "Scout");
  }
}

/** Full scout run history, newest first. */
export async function GET(): Promise<NextResponse> {
  try {
    const runs = getScoutRunService().listRuns();
    return NextResponse.json(listScoutRunsResponseSchema.parse({ runs }));
  } catch (error) {
    return invalidRequest(error, "Scout");
  }
}
