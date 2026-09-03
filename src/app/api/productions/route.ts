import { NextResponse } from "next/server";

import { createMockCartoon, MediaPipelineError } from "@/lib/media-pipeline";

export const runtime = "nodejs";

const errorMessages: Record<MediaPipelineError["code"], string> = {
  INVALID_REQUEST:
    "Choose an MP4 within the upload limit and confirm source rights.",
  SOURCE_TOO_SHORT: "The source must contain the selected 5–8 second segment.",
  SOURCE_AUDIO_REQUIRED: "The source MP4 must include an audio track.",
  MOCK_PROVIDERS_REQUIRED:
    "The local demo requires MOCK image and animation providers.",
  PROCESSING_FAILED: "The local cartoon could not be created. Try another MP4.",
};

function readNumber(formData: FormData, key: string): number | undefined {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const source = formData.get("source");
    if (!(source instanceof File)) {
      throw new MediaPipelineError("INVALID_REQUEST");
    }

    const result = await createMockCartoon({
      bytes: new Uint8Array(await source.arrayBuffer()),
      contentType: source.type,
      rightsConfirmed: formData.get("rightsConfirmed") === "true",
      segmentStart: readNumber(formData, "segmentStart"),
      segmentDuration: readNumber(formData, "segmentDuration"),
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    const pipelineError =
      error instanceof MediaPipelineError
        ? error
        : new MediaPipelineError("PROCESSING_FAILED");
    return NextResponse.json(
      {
        error: {
          code: pipelineError.code,
          message: errorMessages[pipelineError.code],
        },
      },
      { status: pipelineError.code === "PROCESSING_FAILED" ? 500 : 400 },
    );
  }
}
