import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { createPublicHealthReport } from "@/lib/health-report";
import { getMediaToolHealth } from "@/lib/media-tools";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const report = createPublicHealthReport(env, await getMediaToolHealth());

  return NextResponse.json(report, {
    status: report.status === "ok" ? 200 : 503,
  });
}
