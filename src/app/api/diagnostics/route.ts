import { NextResponse } from "next/server";

import { getDiagnosticsService } from "@/server/diagnostics/service";

export const dynamic = "force-dynamic";

/** Read-only provider diagnostics snapshot; no secret values are exposed. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(getDiagnosticsService().getSnapshot());
}
