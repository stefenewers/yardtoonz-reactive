import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import type { ArtifactKind } from "../domain/production";
import {
  createLocalArtifactStore,
  generateArtifactStorageKey,
  getLocalArtifactRoot,
  type ArtifactStore,
  type StoredArtifact,
} from "./artifact-store";
import { env } from "./env";
import { mediaToolPaths } from "./media-tools";
import {
  createArtifactRecord,
  createProductionJobRecord,
  type ArtifactRecord,
} from "./production-records";
import { assertMp4Upload, MediaUploadError } from "./upload-validation";

const execFileAsync = promisify(execFile);

const artifactNames = [
  "source",
  "clip",
  "audio",
  "keyframe",
  "styled-frame",
  "animation",
  "final",
] as const;

export type MediaArtifactName = (typeof artifactNames)[number];

interface ArtifactSpec {
  kind: ArtifactKind;
  mimeType: string;
  parents: readonly MediaArtifactName[];
}

/**
 * Kind, stored media type, and parent lineage for every artifact the mock
 * pipeline records. Lineage follows the FFmpeg data flow: clip from source,
 * audio and keyframe from the clip, styled frame from the keyframe,
 * animation from the styled frame, and the final mux from animation + audio.
 */
const artifactSpecs: Record<MediaArtifactName, ArtifactSpec> = {
  source: { kind: "SOURCE_VIDEO", mimeType: "video/mp4", parents: [] },
  clip: { kind: "EXTRACTED_CLIP", mimeType: "video/mp4", parents: ["source"] },
  audio: { kind: "EXTRACTED_AUDIO", mimeType: "audio/mp4", parents: ["clip"] },
  keyframe: { kind: "KEYFRAME", mimeType: "image/png", parents: ["clip"] },
  "styled-frame": {
    kind: "STYLED_FRAME",
    mimeType: "image/png",
    parents: ["keyframe"],
  },
  animation: {
    kind: "SILENT_ANIMATION",
    mimeType: "video/mp4",
    parents: ["styled-frame"],
  },
  final: {
    kind: "FINAL_VIDEO",
    mimeType: "video/mp4",
    parents: ["animation", "audio"],
  },
};

const artifactProvidersByName: Record<
  MediaArtifactName,
  ArtifactRecord["provider"]
> = {
  source: "USER_UPLOAD",
  clip: "FFMPEG",
  audio: "FFMPEG",
  keyframe: "FFMPEG",
  "styled-frame": "MOCK",
  animation: "MOCK",
  final: "FFMPEG",
};

const mediaPipelineRequestSchema = z.object({
  contentType: z.string(),
  rightsConfirmed: z.literal(true),
  segmentStart: z.number().finite().nonnegative().default(0),
  segmentDuration: z.number().finite().min(5).max(8).default(6),
});

const probeSchema = z.object({
  format: z.object({ duration: z.coerce.number().positive() }),
  streams: z.array(
    z.object({
      codec_type: z.enum(["video", "audio"]).or(z.string()),
      codec_name: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    }),
  ),
});

type MediaProbe = z.infer<typeof probeSchema>;

export interface MediaPipelineRequest {
  bytes: Uint8Array;
  contentType: string;
  rightsConfirmed: boolean;
  segmentStart?: number;
  segmentDuration?: number;
}

export interface MediaPipelineResult {
  id: string;
  status: "COMPLETE";
  imageProvider: "MOCK";
  animationProvider: "MOCK";
  segmentDuration: number;
  width: number;
  height: number;
  videoCodec: string;
  audioPresent: true;
  artifacts: Record<MediaArtifactName, string>;
}

interface StoredMediaJob extends MediaPipelineResult {
  artifactRecords: ArtifactRecord[];
}

export class MediaPipelineError extends Error {
  constructor(
    public readonly code:
      | "INVALID_REQUEST"
      | "UNSUPPORTED_MEDIA_TYPE"
      | "UPLOAD_TOO_LARGE"
      | "INVALID_MEDIA_CONTENT"
      | "SOURCE_TOO_SHORT"
      | "SOURCE_AUDIO_REQUIRED"
      | "MOCK_PROVIDERS_REQUIRED"
      | "PROCESSING_FAILED",
  ) {
    super(code);
  }
}

function getArtifactFileName(name: MediaArtifactName): string {
  const names: Record<MediaArtifactName, string> = {
    source: "source.mp4",
    clip: "clip.mp4",
    audio: "audio.m4a",
    keyframe: "keyframe.png",
    "styled-frame": "styled-frame.png",
    animation: "animation.mp4",
    final: "yardtoonz-mock.mp4",
  };
  return names[name];
}

function getStorageKey(jobId: string, name: MediaArtifactName): string {
  return generateArtifactStorageKey(jobId, getArtifactFileName(name));
}

function getJobDirectory(jobId: string): string {
  return path.join(/* turbopackIgnore: true */ getLocalArtifactRoot(), jobId);
}

function getArtifactUrl(jobId: string, name: MediaArtifactName): string {
  return `/api/demo/cartoons/${jobId}/artifacts/${name}`;
}

async function runMediaTool(executable: string, args: string[]): Promise<void> {
  await execFileAsync(executable, args, {
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
  });
}

async function probeMedia(filePath: string) {
  const { stdout } = await execFileAsync(mediaToolPaths.ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,codec_name,width,height",
    "-of",
    "json",
    filePath,
  ]);
  return probeSchema.parse(JSON.parse(stdout) as unknown);
}

export interface StoredVideoProbe {
  durationSeconds: number;
  audioPresent: boolean;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
}

/**
 * Probes a stored source video so the API can gate production start on real
 * media facts (duration, audio) instead of trusting the upload alone.
 */
export async function probeStoredVideo(
  filePath: string,
): Promise<StoredVideoProbe> {
  const probe = await probeMedia(filePath);
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  return {
    durationSeconds: probe.format.duration,
    audioPresent: probe.streams.some((stream) => stream.codec_type === "audio"),
    width: video?.width ?? null,
    height: video?.height ?? null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
  };
}

function assertMockProviders(): void {
  if (env.IMAGE_PROVIDER !== "MOCK" || env.ANIMATION_PROVIDER !== "MOCK") {
    throw new MediaPipelineError("MOCK_PROVIDERS_REQUIRED");
  }
}

function probeMetadata(
  probe: MediaProbe,
): Record<string, string | number | boolean | null> {
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  return {
    durationSeconds: probe.format.duration,
    width: video?.width ?? null,
    height: video?.height ?? null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    audioPresent: probe.streams.some((stream) => stream.codec_type === "audio"),
  };
}

async function buildArtifactRecords(input: {
  jobId: string;
  store: ArtifactStore;
  sourceIntegrity: StoredArtifact;
  sourceProbe: MediaProbe;
  finalProbe: MediaProbe;
}): Promise<ArtifactRecord[]> {
  const { jobId, store, sourceIntegrity, sourceProbe, finalProbe } = input;
  const createdAt = new Date().toISOString();

  return Promise.all(
    artifactNames.map(async (name) => {
      const spec = artifactSpecs[name];
      const storageKey = getStorageKey(jobId, name);
      const integrity =
        name === "source" ? sourceIntegrity : await store.inspect(storageKey);
      const metadata =
        name === "source"
          ? probeMetadata(sourceProbe)
          : name === "final"
            ? probeMetadata(finalProbe)
            : {};

      return createArtifactRecord({
        id: `${jobId}-${name}`,
        jobId,
        kind: spec.kind,
        storageKey,
        mimeType: spec.mimeType,
        byteSize: integrity.byteSize,
        sha256: integrity.sha256,
        parentArtifactIds: spec.parents.map((parent) => `${jobId}-${parent}`),
        provider: artifactProvidersByName[name],
        metadata,
        createdAt,
      });
    }),
  );
}

function createArtifactUrls(jobId: string): Record<MediaArtifactName, string> {
  return Object.fromEntries(
    artifactNames.map((name) => [name, getArtifactUrl(jobId, name)]),
  ) as Record<MediaArtifactName, string>;
}

async function runPipeline(
  jobId: string,
  store: ArtifactStore,
  segmentStart: number,
  segmentDuration: number,
): Promise<void> {
  const [source, clip, audio, keyframe, styledFrame, animation, final] =
    await Promise.all([
      store.resolve(getStorageKey(jobId, "source")),
      store.resolve(getStorageKey(jobId, "clip")),
      store.resolve(getStorageKey(jobId, "audio")),
      store.resolve(getStorageKey(jobId, "keyframe")),
      store.resolve(getStorageKey(jobId, "styled-frame")),
      store.resolve(getStorageKey(jobId, "animation")),
      store.resolve(getStorageKey(jobId, "final")),
    ]);
  const start = segmentStart.toFixed(3);
  const duration = segmentDuration.toFixed(3);

  await runMediaTool(mediaToolPaths.ffmpeg, [
    "-y",
    "-ss",
    start,
    "-i",
    source,
    "-t",
    duration,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    clip,
  ]);

  await runMediaTool(mediaToolPaths.ffmpeg, [
    "-y",
    "-i",
    clip,
    "-vn",
    "-c:a",
    "aac",
    audio,
  ]);

  await runMediaTool(mediaToolPaths.ffmpeg, [
    "-y",
    "-ss",
    (segmentDuration / 2).toFixed(3),
    "-i",
    clip,
    "-frames:v",
    "1",
    keyframe,
  ]);

  await runMediaTool(mediaToolPaths.ffmpeg, [
    "-y",
    "-i",
    keyframe,
    "-vf",
    "scale=360:640:force_original_aspect_ratio=increase,crop=360:640,gblur=sigma=1.2,eq=saturation=1.45:contrast=1.12:brightness=0.04,vignette=PI/5,drawbox=x=0:y=0:w=iw:h=36:color=0xFFD83D@0.95:t=fill",
    "-frames:v",
    "1",
    styledFrame,
  ]);

  await runMediaTool(mediaToolPaths.ffmpeg, [
    "-y",
    "-loop",
    "1",
    "-framerate",
    "24",
    "-i",
    styledFrame,
    "-t",
    duration,
    "-vf",
    "zoompan=z='min(zoom+0.0007,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=360x640:fps=24,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    animation,
  ]);

  await runMediaTool(mediaToolPaths.ffmpeg, [
    "-y",
    "-i",
    animation,
    "-i",
    audio,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    "-movflags",
    "+faststart",
    final,
  ]);
}

export async function createMockCartoon(
  input: MediaPipelineRequest,
): Promise<MediaPipelineResult> {
  assertMockProviders();

  const parsed = mediaPipelineRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new MediaPipelineError("INVALID_REQUEST");
  }

  const jobId = randomUUID();
  const store = createLocalArtifactStore();

  try {
    assertMp4Upload(
      input.bytes,
      input.contentType,
      env.MAX_UPLOAD_MB * 1024 * 1024,
    );

    const sourceKey = getStorageKey(jobId, "source");
    const storedSource = await store.save({
      bytes: input.bytes,
      storageKey: sourceKey,
      mimeType: artifactSpecs.source.mimeType,
    });
    const sourcePath = await store.resolve(sourceKey);

    const sourceProbe = await probeMedia(sourcePath);
    const hasAudio = sourceProbe.streams.some(
      (stream) => stream.codec_type === "audio",
    );
    if (!hasAudio) throw new MediaPipelineError("SOURCE_AUDIO_REQUIRED");
    if (
      sourceProbe.format.duration <
      parsed.data.segmentStart + parsed.data.segmentDuration
    ) {
      throw new MediaPipelineError("SOURCE_TOO_SHORT");
    }

    await runPipeline(
      jobId,
      store,
      parsed.data.segmentStart,
      parsed.data.segmentDuration,
    );

    const finalKey = getStorageKey(jobId, "final");
    const finalProbe = await probeMedia(await store.resolve(finalKey));
    const video = finalProbe.streams.find(
      (stream) => stream.codec_type === "video",
    );
    const finalHasAudio = finalProbe.streams.some(
      (stream) => stream.codec_type === "audio",
    );
    if (!video?.width || !video.height || !finalHasAudio) {
      throw new MediaPipelineError("PROCESSING_FAILED");
    }

    const artifactRecords = await buildArtifactRecords({
      jobId,
      store,
      sourceIntegrity: storedSource,
      sourceProbe,
      finalProbe,
    });

    const job = createProductionJobRecord({
      id: jobId,
      imageProvider: env.IMAGE_PROVIDER,
      animationProvider: env.ANIMATION_PROVIDER,
    });
    const stored: StoredMediaJob = {
      id: job.id,
      status: "COMPLETE",
      imageProvider: "MOCK",
      animationProvider: "MOCK",
      segmentDuration: parsed.data.segmentDuration,
      width: video.width,
      height: video.height,
      videoCodec: video.codec_name ?? "h264",
      audioPresent: true,
      artifacts: createArtifactUrls(jobId),
      artifactRecords,
    };
    await writeFile(
      path.join(getJobDirectory(jobId), "job.json"),
      JSON.stringify(stored, null, 2),
    );
    return stored;
  } catch (error: unknown) {
    if (error instanceof MediaPipelineError) throw error;
    if (error instanceof MediaUploadError) {
      throw new MediaPipelineError(error.code);
    }
    throw new MediaPipelineError("PROCESSING_FAILED");
  }
}

export async function getMediaJob(jobId: string): Promise<MediaPipelineResult> {
  if (!z.string().uuid().safeParse(jobId).success) {
    throw new MediaPipelineError("INVALID_REQUEST");
  }
  try {
    const stored = JSON.parse(
      await readFile(path.join(getJobDirectory(jobId), "job.json"), "utf8"),
    ) as StoredMediaJob;
    return stored;
  } catch {
    throw new MediaPipelineError("INVALID_REQUEST");
  }
}

export function resolveArtifactPath(
  jobId: string,
  artifactName: string,
): { path: string; downloadName: string; contentType: string } {
  const parsedJobId = z.string().uuid().safeParse(jobId);
  const parsedName = z.enum(artifactNames).safeParse(artifactName);
  if (!parsedJobId.success || !parsedName.success) {
    throw new MediaPipelineError("INVALID_REQUEST");
  }
  const name = parsedName.data;
  return {
    path: path.join(getLocalArtifactRoot(), getStorageKey(jobId, name)),
    downloadName: getArtifactFileName(name),
    contentType: artifactSpecs[name].mimeType,
  };
}
