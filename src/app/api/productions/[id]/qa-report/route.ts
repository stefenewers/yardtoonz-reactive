import { NextResponse } from "next/server";

import { apiError, invalidRequest } from "@/server/api-response";
import { getQaReportService } from "@/server/qa/service";
import {
  qaReportListResponseSchema,
  qaReportResponseSchema,
} from "@/shared/qa-reports";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

/**
 * Runs the QA Inspector: the deterministic checks registry judges the
 * production's persisted artifact facts, and the new report persists as an
 * observation appended to the production's QA history (alongside its
 * qa-inspector agent-trace row).
 */
export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const outcome = await getQaReportService().runReport(id, new Date());

    if (outcome === "PRODUCTION_NOT_FOUND") {
      return apiError("PRODUCTION_NOT_FOUND", "Production not found.", 404);
    }

    return NextResponse.json(qaReportResponseSchema.parse(outcome));
  } catch (error) {
    return invalidRequest(error, "QA report");
  }
}

/** Newest-first QA report history for one production. */
export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const outcome = getQaReportService().listReports(id);

    if (outcome === "PRODUCTION_NOT_FOUND") {
      return apiError("PRODUCTION_NOT_FOUND", "Production not found.", 404);
    }

    return NextResponse.json(qaReportListResponseSchema.parse(outcome));
  } catch (error) {
    return invalidRequest(error, "QA report");
  }
}
