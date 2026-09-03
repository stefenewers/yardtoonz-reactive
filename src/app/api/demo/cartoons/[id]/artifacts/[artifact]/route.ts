import { readFile } from "node:fs/promises";

import { resolveArtifactPath } from "@/lib/media-pipeline";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; artifact: string }> },
): Promise<Response> {
  try {
    const { id, artifact } = await context.params;
    const resolved = resolveArtifactPath(id, artifact);
    const bytes = await readFile(resolved.path);
    const disposition = new URL(request.url).searchParams.has("download")
      ? `attachment; filename="${resolved.downloadName}"`
      : `inline; filename="${resolved.downloadName}"`;

    return new Response(bytes, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": disposition,
        "Content-Type": resolved.contentType,
      },
    });
  } catch {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Artifact not found." } },
      { status: 404 },
    );
  }
}
