import { NextResponse } from "next/server";

import { getMediaJob, MediaPipelineError } from "@/lib/media-pipeline";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    return NextResponse.json(await getMediaJob(id));
  } catch (error: unknown) {
    if (!(error instanceof MediaPipelineError)) throw error;
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Production not found." } },
      { status: 404 },
    );
  }
}
