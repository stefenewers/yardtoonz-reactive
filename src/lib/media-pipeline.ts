import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import { env } from "./env";
import { mediaToolPaths } from "./media-tools";
import {
  createArtifactRecord,
  createProductionJobRecord,
  type ArtifactRecord,
} from "./production-records";

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

const mediaPipelineRequestSchema = z.object({
  contentType: z.literal("video/mp4"),
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
      | "SOURCE_TOO_SHORT"
      | "SOURCE_AUDIO_REQUIRED"
      | "MOCK_PROVIDERS_REQUIRED"
      | "PROCESSING_FAILED",
  ) {
    super(code);
  }
}

function getArtifactRoot(): string {
  return path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    env.ARTIFACT_ROOT,
  );
}

function getJobDirectory(jobId: string): string {
  return path.join(/* turbopackIgnore: true */ getArtifactRoot(), jobId);
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

function getArtifactPath(jobId: string, name: MediaArtifactName): string {
  return path.join(
    /* turbopackIgnore: true */ getJobDirectory(jobId),
    getArtifactFileName(name),
  );
}

function getArtifactUrl(jobId: string, name: MediaArtifactName): string {
  return `/api/productions/${jobId}/artifacts/${name}`;
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

function assertMockProviders(): void {
  if (env.IMAGE_PROVIDER !== "MOCK" || env.ANIMATION_PROVIDER !== "MOCK") {
    throw new MediaPipelineError("MOCK_PROVIDERS_REQUIRED");
  }
}

function createArtifactRecords(jobId: string): ArtifactRecord[] {
  const providers = {
    source: "USER_UPLOAD",
    clip: "FFMPEG",
    audio: "FFMPEG",
    keyframe: "FFMPEG",
    "styled-frame": "MOCK",
    animation: "MOCK",
    final: "FFMPEG",
  } as const;

  return artifactNames.map((name) =>
    createArtifactRecord({
      id: `${jobId}-${name}`,
      jobId,
      provider: providers[name],
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
  segmentStart: number,
  segmentDuration: number,
): Promise<void> {
  const source = getArtifactPath(jobId, "source");
  const clip = getArtifactPath(jobId, "clip");
  const audio = getArtifactPath(jobId, "audio");
  const keyframe = getArtifactPath(jobId, "keyframe");
  const styledFrame = getArtifactPath(jobId, "styled-frame");
  const animation = getArtifactPath(jobId, "animation");
  const final = getArtifactPath(jobId, "final");
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
  if (
    !parsed.success ||
    input.bytes.byteLength > env.MAX_UPLOAD_MB * 1024 * 1024
  ) {
    throw new MediaPipelineError("INVALID_REQUEST");
  }

  const jobId = randomUUID();
  await mkdir(getJobDirectory(jobId), { recursive: true });
  await writeFile(getArtifactPath(jobId, "source"), input.bytes);

  try {
    const sourceProbe = await probeMedia(getArtifactPath(jobId, "source"));
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
      parsed.data.segmentStart,
      parsed.data.segmentDuration,
    );

    const finalProbe = await probeMedia(getArtifactPath(jobId, "final"));
    const video = finalProbe.streams.find(
      (stream) => stream.codec_type === "video",
    );
    const finalHasAudio = finalProbe.streams.some(
      (stream) => stream.codec_type === "audio",
    );
    if (!video?.width || !video.height || !finalHasAudio) {
      throw new MediaPipelineError("PROCESSING_FAILED");
    }

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
      artifactRecords: createArtifactRecords(jobId),
    };
    await writeFile(
      path.join(getJobDirectory(jobId), "job.json"),
      JSON.stringify(stored, null, 2),
    );
    return stored;
  } catch (error: unknown) {
    if (error instanceof MediaPipelineError) throw error;
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
  const filePath = getArtifactPath(parsedJobId.data, parsedName.data);
  return {
    path: filePath,
    downloadName: getArtifactFileName(parsedName.data),
    contentType:
      parsedName.data.includes("frame") || parsedName.data === "keyframe"
        ? "image/png"
        : parsedName.data === "audio"
          ? "audio/mp4"
          : "video/mp4",
  };
}
