import { NextResponse } from "next/server";

import { collectHealthReport } from "@/server/health/service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const report = await collectHealthReport();

  return NextResponse.json(report, {
    status: report.status === "ok" ? 200 : 503,
  });
}
