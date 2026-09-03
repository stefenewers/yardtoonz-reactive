import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createMockCartoon,
  MediaPipelineError,
  resolveArtifactPath,
} from "../../src/lib/media-pipeline";
import { mediaToolPaths } from "../../src/lib/media-tools";

const execFileAsync = promisify(execFile);

let fixtureDirectory: string;
let fixtureBytes: Uint8Array;
let createdJobId: string | undefined;

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(path.join(tmpdir(), "yardtoonz-media-"));
  const fixturePath = path.join(fixtureDirectory, "authorized-source.mp4");
  await execFileAsync(mediaToolPaths.ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x240:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100",
    "-t",
    "6.3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    fixturePath,
  ]);
  fixtureBytes = await readFile(fixturePath);
});

afterAll(async () => {
  await rm(fixtureDirectory, { recursive: true, force: true });
  if (createdJobId) {
    await rm(path.resolve(".data/artifacts", createdJobId), {
      recursive: true,
      force: true,
    });
  }
});

describe("mock media pipeline", () => {
  it("rejects processing until rights are confirmed", async () => {
    await expect(
      createMockCartoon({
        bytes: new Uint8Array(),
        contentType: "video/mp4",
        rightsConfirmed: false,
      }),
    ).rejects.toEqual(new MediaPipelineError("INVALID_REQUEST"));
  });

  it("creates a vertical mock cartoon with original audio and attributed artifacts", async () => {
    const result = await createMockCartoon({
      bytes: fixtureBytes,
      contentType: "video/mp4",
      rightsConfirmed: true,
      segmentDuration: 6,
    });
    createdJobId = result.id;

    expect(result).toMatchObject({
      status: "COMPLETE",
      imageProvider: "MOCK",
      animationProvider: "MOCK",
      segmentDuration: 6,
      width: 360,
      height: 640,
      audioPresent: true,
    });

    const finalArtifact = resolveArtifactPath(result.id, "final");
    const { stdout } = await execFileAsync(mediaToolPaths.ffprobe, [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type:format=duration",
      "-of",
      "json",
      finalArtifact.path,
    ]);
    const probe = JSON.parse(stdout) as {
      streams: Array<{ codec_type: string }>;
      format: { duration: string };
    };
    expect(probe.streams.map((stream) => stream.codec_type).sort()).toEqual([
      "audio",
      "video",
    ]);
    expect(Number(probe.format.duration)).toBeGreaterThanOrEqual(5.9);

    const stored = JSON.parse(
      await readFile(
        path.resolve(".data/artifacts", result.id, "job.json"),
        "utf8",
      ),
    ) as {
      artifactRecords: Array<{ provider: string }>;
    };
    expect(stored.artifactRecords.map((artifact) => artifact.provider)).toEqual(
      ["USER_UPLOAD", "FFMPEG", "FFMPEG", "FFMPEG", "MOCK", "MOCK", "FFMPEG"],
    );
  }, 120_000);
});
