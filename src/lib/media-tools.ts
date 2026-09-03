import { execFile } from "node:child_process";
import { promisify } from "node:util";

import ffmpegPath from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

const execFileAsync = promisify(execFile);

export type MediaToolName = "ffmpeg" | "ffprobe";

export interface MediaToolStatus {
  name: MediaToolName;
  available: boolean;
  path: string;
  version?: string;
  error?: string;
}

function requireBinaryPath(name: MediaToolName, path: string | null): string {
  if (!path)
    throw new Error(`No ${name} binary is available for this platform`);
  return path;
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

    return { name, available: true, path, version: firstLine };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown media tool error";
    return { name, available: false, path, error: message };
  }
}

export async function getMediaToolHealth(): Promise<MediaToolStatus[]> {
  return Promise.all([
    inspectMediaTool("ffmpeg", mediaToolPaths.ffmpeg),
    inspectMediaTool("ffprobe", mediaToolPaths.ffprobe),
  ]);
}
