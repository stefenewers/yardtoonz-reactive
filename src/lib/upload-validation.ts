import { z } from "zod";

const mp4ContentTypeSchema = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase())
  .refine((value) => value.split(";")[0]?.trim() === "video/mp4", {
    message: "Only MP4 video uploads are accepted",
  });

export type MediaUploadErrorCode =
  | "UNSUPPORTED_MEDIA_TYPE"
  | "UPLOAD_TOO_LARGE"
  | "INVALID_MEDIA_CONTENT";

export class MediaUploadError extends Error {
  constructor(public readonly code: MediaUploadErrorCode) {
    super(code);
  }
}

/**
 * MP4 files are ISO base media files whose first box must carry the "ftyp"
 * brand. Checking the signature up front rejects renamed non-media payloads
 * before any bytes reach storage; FFprobe still validates the decoded media.
 */
function hasMp4Signature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  return (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  );
}

/**
 * Validates an authorized upload before persistence: MP4 content type only,
 * a configurable size ceiling, and the MP4 box signature in the actual bytes.
 * Filenames are deliberately absent — storage keys are generated internally.
 */
export function assertMp4Upload(
  bytes: Uint8Array,
  contentType: string,
  maxBytes: number,
): void {
  if (bytes.byteLength === 0) {
    throw new MediaUploadError("INVALID_MEDIA_CONTENT");
  }
  const parsed = mp4ContentTypeSchema.safeParse(contentType);
  if (!parsed.success) {
    throw new MediaUploadError("UNSUPPORTED_MEDIA_TYPE");
  }
  if (bytes.byteLength > maxBytes) {
    throw new MediaUploadError("UPLOAD_TOO_LARGE");
  }
  if (!hasMp4Signature(bytes)) {
    throw new MediaUploadError("INVALID_MEDIA_CONTENT");
  }
}
