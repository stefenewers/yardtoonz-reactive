import { execFile } from "node:child_process";
import { promisify } from "node:util";

import ffmpegPath from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

const execFileAsync = promisify(execFile);

export type MediaToolName = "ffmpeg" | "ffprobe";
export type MediaToolDiagnostic =
  | "available"
  | "binary-unavailable"
  | "timed-out"
  | "execution-failed";

export interface MediaToolStatus {
  name: MediaToolName;
  available: boolean;
  diagnostic: MediaToolDiagnostic;
  path: string;
  version?: string;
  error?: string;
}

function requireBinaryPath(name: MediaToolName, path: string | null): string {
  if (!path)
    throw new Error(`No ${name} binary is available for this platform`);
  return path;
}

function getErrorProperty(error: unknown, property: string): unknown {
  if (typeof error !== "object" || error === null || !(property in error))
    return undefined;
  return error[property as keyof typeof error];
}

function classifyMediaToolError(error: unknown): MediaToolDiagnostic {
  if (getErrorProperty(error, "code") === "ENOENT") return "binary-unavailable";
  if (
    getErrorProperty(error, "code") === "ETIMEDOUT" ||
    getErrorProperty(error, "killed") === true
  )
    return "timed-out";
  return "execution-failed";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown media tool error";
}

export const mediaToolPaths = {
  ffmpeg: requireBinaryPath("ffmpeg", ffmpegPath),
  ffprobe: requireBinaryPath("ffprobe", ffprobeInstaller.path),
} as const;

async function inspectMediaTool(
  name: MediaToolName,
  path: string,
): Promise<MediaToolStatus> {
  try {
    const { stdout, stderr } = await execFileAsync(path, ["-version"], {
      timeout: 10_000,
    });
    const firstLine = `${stdout}${stderr}`.split("\n")[0]?.trim();

    return {
      name,
      available: true,
      diagnostic: "available",
      path,
      version: firstLine,
    };
  } catch (error: unknown) {
    return {
      name,
      available: false,
      diagnostic: classifyMediaToolError(error),
      path,
      error: getErrorMessage(error),
    };
  }
}

export async function getMediaToolHealth(): Promise<MediaToolStatus[]> {
  return Promise.all([
    inspectMediaTool("ffmpeg", mediaToolPaths.ffmpeg),
    inspectMediaTool("ffprobe", mediaToolPaths.ffprobe),
  ]);
}
