import { readFile } from "node:fs/promises";

import { ArtifactStoreError } from "@/lib/artifact-store";
import { ProductionGateError } from "@/server/productions/errors";
import { productionErrorResponse } from "@/server/productions/http";
import {
  getProductionArtifactStore,
  getProductionRepository,
} from "@/server/productions/service";

interface RouteContext {
  params: Promise<{ id: string; artifactId: string }>;
}

export const runtime = "nodejs";

const extensionByMimeType: Record<string, string> = {
  "video/mp4": "mp4",
  "image/png": "png",
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
};

/**
 * Download names are generated from trusted identifiers (production id,
 * artifact kind, stored mime type) — never from user filenames.
 */
function downloadName(
  productionId: string,
  kind: string,
  mimeType: string,
): string {
  const extension = extensionByMimeType[mimeType] ?? "bin";
  return `yardtoonz-${productionId}-${kind.toLowerCase()}.${extension}`;
}

/**
 * Serves a persisted production artifact's bytes for preview, lineage
 * inspection, and download (`?download=1`). Identifiers locate the row;
 * the storage key stays internal so traversal cannot reach outside the
 * artifact root.
 */
export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { id, artifactId } = await context.params;
    const artifact = getProductionRepository().getArtifact(id, artifactId);
    if (!artifact) {
      return productionErrorResponse(
        new ProductionGateError("PRODUCTION_NOT_FOUND"),
      );
    }

    const store = getProductionArtifactStore();
    const bytes = await readFile(await store.resolve(artifact.storageKey));
    const fileName = downloadName(id, artifact.kind, artifact.mimeType);
    const disposition = new URL(request.url).searchParams.has("download")
      ? `attachment; filename="${fileName}"`
      : `inline; filename="${fileName}"`;

    return new Response(bytes, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": disposition,
        "Content-Type": artifact.mimeType,
      },
    });
  } catch (error) {
    if (
      error instanceof ArtifactStoreError &&
      error.code === "ARTIFACT_NOT_FOUND"
    ) {
      return productionErrorResponse(
        new ProductionGateError("PRODUCTION_NOT_FOUND"),
      );
    }
    return productionErrorResponse(error);
  }
}
