import { NextResponse } from "next/server";

import { generateArtifactStorageKey } from "@/lib/artifact-store";
import { env } from "@/lib/env";
import { probeStoredVideo, type StoredVideoProbe } from "@/lib/media-pipeline";
import { assertMp4Upload, MediaUploadError } from "@/lib/upload-validation";
import { ProductionGateError } from "@/server/productions/errors";
import { productionErrorResponse } from "@/server/productions/http";
import {
  getProductionArtifactStore,
  getProductionRepository,
} from "@/server/productions/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

/**
 * Uploads and probes the authorized source MP4 for a pre-queue production.
 * Validation happens before storage, probing after; the repository records
 * the artifact only when both pass, so a rejected upload leaves no rows.
 */
export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const formData = await request.formData();
    const source = formData.get("source");
    if (!(source instanceof File)) {
      throw new ProductionGateError("SOURCE_REQUIRED");
    }

    const bytes = new Uint8Array(await source.arrayBuffer());
    assertMp4Upload(bytes, source.type, env.MAX_UPLOAD_MB * 1024 * 1024);

    const store = getProductionArtifactStore();
    const storageKey = generateArtifactStorageKey(id, "source.mp4");
    const stored = await store.save({
      bytes,
      storageKey,
      mimeType: "video/mp4",
    });

    let probe: StoredVideoProbe;
    try {
      probe = await probeStoredVideo(await store.resolve(stored.storageKey));
    } catch {
      // FFprobe could not decode the stored bytes: treat as invalid media.
      throw new MediaUploadError("INVALID_MEDIA_CONTENT");
    }

    const detail = getProductionRepository().recordSourceUpload(
      id,
      {
        storageKey: stored.storageKey,
        mimeType: "video/mp4",
        byteSize: stored.byteSize,
        sha256: stored.sha256,
        metadata: {
          durationSeconds: probe.durationSeconds,
          audioPresent: probe.audioPresent,
          width: probe.width,
          height: probe.height,
          videoCodec: probe.videoCodec,
          audioCodec: probe.audioCodec,
        },
      },
      new Date(),
    );

    return NextResponse.json(detail, { status: 201 });
  } catch (error) {
    return productionErrorResponse(error);
  }
}
