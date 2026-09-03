import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createLocalArtifactStore,
  generateArtifactStorageKey,
  getLocalArtifactRoot,
} from "../../src/lib/artifact-store";
import {
  createMockCartoon,
  MediaPipelineError,
} from "../../src/lib/media-pipeline";
import { mediaToolPaths } from "../../src/lib/media-tools";
import {
  assertMp4Upload,
  MediaUploadError,
} from "../../src/lib/upload-validation";

const execFileAsync = promisify(execFile);

interface StoredArtifactRecord {
  id: string;
  kind: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  parentArtifactIds: string[];
  provider: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

function errorCodeOf(fn: () => void): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return "no-error-thrown";
}

async function errorCodeOfPromise(
  promise: Promise<unknown>,
): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return "no-error-thrown";
}

let fixtureDirectory: string;
let fixtureBytes: Uint8Array;
let storeRoot: string;
let createdJobId: string | undefined;

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(
    path.join(tmpdir(), "yardtoonz-store-fixture-"),
  );
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
  storeRoot = await mkdtemp(path.join(tmpdir(), "yardtoonz-store-root-"));
});

afterAll(async () => {
  await rm(fixtureDirectory, { recursive: true, force: true });
  await rm(storeRoot, { recursive: true, force: true });
  if (createdJobId) {
    await rm(path.resolve(".data/artifacts", createdJobId), {
      recursive: true,
      force: true,
    });
  }
});

describe("local artifact store", () => {
  it("stores valid media with generated keys and integrity data", async () => {
    const store = createLocalArtifactStore({ rootDirectory: storeRoot });
    const storageKey = generateArtifactStorageKey("production-1", "source.mp4");

    const stored = await store.save({
      bytes: fixtureBytes,
      storageKey,
      mimeType: "video/mp4",
    });

    expect(stored.storageKey).toBe(storageKey);
    expect(stored.byteSize).toBe(fixtureBytes.byteLength);
    expect(stored.sha256).toBe(
      createHash("sha256").update(fixtureBytes).digest("hex"),
    );

    const resolved = await store.resolve(storageKey);
    expect(resolved.startsWith(storeRoot)).toBe(true);
    expect(await readFile(resolved)).toEqual(fixtureBytes);

    const inspected = await store.inspect(storageKey);
    expect(inspected.byteSize).toBe(stored.byteSize);
    expect(inspected.sha256).toBe(stored.sha256);
  });

  it("rejects storage keys that attempt path traversal", async () => {
    const store = createLocalArtifactStore({ rootDirectory: storeRoot });
    const hostileKeys = [
      "../../etc/passwd",
      "production-1/../../escape.mp4",
      "/etc/passwd",
      "..\\..\\windows\\escape.mp4",
      "production-1/\0escape.mp4",
      "./production-1/source.mp4",
      "production-1//source.mp4",
      "production 1/source.mp4",
    ];

    for (const hostileKey of hostileKeys) {
      expect(await errorCodeOfPromise(store.resolve(hostileKey))).toBe(
        "INVALID_STORAGE_KEY",
      );
      expect(
        await errorCodeOfPromise(
          store.save({
            bytes: fixtureBytes,
            storageKey: hostileKey,
            mimeType: "video/mp4",
          }),
        ),
      ).toBe("INVALID_STORAGE_KEY");
    }

    expect(
      errorCodeOf(() => generateArtifactStorageKey("../evil", "source.mp4")),
    ).toBe("INVALID_STORAGE_KEY");
    expect(
      errorCodeOf(() =>
        generateArtifactStorageKey("production-1", "../../evil.mp4"),
      ),
    ).toBe("INVALID_STORAGE_KEY");
  });

  it("enforces size and emptiness limits before persistence", async () => {
    const store = createLocalArtifactStore({
      rootDirectory: storeRoot,
      maxUploadBytes: 1024,
    });
    const storageKey = generateArtifactStorageKey("production-2", "source.mp4");

    expect(
      await errorCodeOfPromise(
        store.save({
          bytes: new Uint8Array(2048),
          storageKey,
          mimeType: "video/mp4",
        }),
      ),
    ).toBe("SIZE_LIMIT_EXCEEDED");
    expect(
      await errorCodeOfPromise(
        store.save({
          bytes: new Uint8Array(0),
          storageKey,
          mimeType: "video/mp4",
        }),
      ),
    ).toBe("INVALID_ARTIFACT");
    expect(await errorCodeOfPromise(store.inspect(storageKey))).toBe(
      "ARTIFACT_NOT_FOUND",
    );
  });
});

describe("mp4 upload validation", () => {
  it("accepts a real MP4 upload regardless of parameter casing", () => {
    expect(() =>
      assertMp4Upload(fixtureBytes, "Video/MP4", Number.MAX_SAFE_INTEGER),
    ).not.toThrow();
  });

  it("rejects renamed non-media payloads", () => {
    const textBytes = new Uint8Array(Buffer.from("not a video", "utf8"));
    expect(() => assertMp4Upload(textBytes, "video/mp4", 1_000_000)).toThrow(
      MediaUploadError,
    );
    expect(
      errorCodeOf(() => assertMp4Upload(textBytes, "video/mp4", 1_000_000)),
    ).toBe("INVALID_MEDIA_CONTENT");
  });

  it("rejects unsupported claimed media types", () => {
    expect(
      errorCodeOf(() =>
        assertMp4Upload(fixtureBytes, "text/html", Number.MAX_SAFE_INTEGER),
      ),
    ).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("rejects empty uploads", () => {
    expect(
      errorCodeOf(() =>
        assertMp4Upload(
          new Uint8Array(0),
          "video/mp4",
          Number.MAX_SAFE_INTEGER,
        ),
      ),
    ).toBe("INVALID_MEDIA_CONTENT");
  });

  it("rejects uploads over the configured limit before persistence", () => {
    const headerBytes = new Uint8Array(2048);
    headerBytes.set(Buffer.from("ftyp", "ascii"), 4);

    expect(
      errorCodeOf(() => assertMp4Upload(headerBytes, "video/mp4", 1024)),
    ).toBe("UPLOAD_TOO_LARGE");
    expect(() => assertMp4Upload(headerBytes, "video/mp4", 4096)).not.toThrow();
  });

  it("surfaces precise codes through the mock pipeline", async () => {
    const textBytes = new Uint8Array(Buffer.from("not a video", "utf8"));

    await expect(
      createMockCartoon({
        bytes: textBytes,
        contentType: "video/mp4",
        rightsConfirmed: true,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_MEDIA_CONTENT",
    });

    await expect(
      createMockCartoon({
        bytes: fixtureBytes,
        contentType: "text/html",
        rightsConfirmed: true,
      }),
    ).rejects.toBeInstanceOf(MediaPipelineError);
  });
});

describe("durable artifact records", () => {
  it("records integrity, lineage, and probe metadata for every artifact", async () => {
    const result = await createMockCartoon({
      bytes: fixtureBytes,
      contentType: "video/mp4",
      rightsConfirmed: true,
      segmentDuration: 6,
    });
    createdJobId = result.id;

    const stored = JSON.parse(
      await readFile(
        path.resolve(".data/artifacts", result.id, "job.json"),
        "utf8",
      ),
    ) as { artifactRecords: StoredArtifactRecord[] };
    const records = stored.artifactRecords;

    expect(records.map((record) => record.id)).toEqual([
      `${result.id}-source`,
      `${result.id}-clip`,
      `${result.id}-audio`,
      `${result.id}-keyframe`,
      `${result.id}-styled-frame`,
      `${result.id}-animation`,
      `${result.id}-final`,
    ]);
    expect(records.map((record) => record.provider)).toEqual([
      "USER_UPLOAD",
      "FFMPEG",
      "FFMPEG",
      "FFMPEG",
      "MOCK",
      "MOCK",
      "FFMPEG",
    ]);
    expect(records.map((record) => record.kind)).toEqual([
      "SOURCE_VIDEO",
      "EXTRACTED_CLIP",
      "EXTRACTED_AUDIO",
      "KEYFRAME",
      "STYLED_FRAME",
      "SILENT_ANIMATION",
      "FINAL_VIDEO",
    ]);

    for (const record of records) {
      expect(record.storageKey.startsWith(`${result.id}/`)).toBe(true);
      expect(record.storageKey.includes("..")).toBe(false);
      expect(record.mimeType.length).toBeGreaterThan(0);
      expect(record.byteSize).toBeGreaterThan(0);
      expect(record.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(Number.isNaN(Date.parse(record.createdAt))).toBe(false);
    }
    expect(new Set(records.map((record) => record.storageKey)).size).toBe(7);

    const lineage = new Map(
      records.map((record) => [record.kind, record.parentArtifactIds]),
    );
    expect(lineage.get("SOURCE_VIDEO")).toEqual([]);
    expect(lineage.get("EXTRACTED_CLIP")).toEqual([`${result.id}-source`]);
    expect(lineage.get("EXTRACTED_AUDIO")).toEqual([`${result.id}-clip`]);
    expect(lineage.get("KEYFRAME")).toEqual([`${result.id}-clip`]);
    expect(lineage.get("STYLED_FRAME")).toEqual([`${result.id}-keyframe`]);
    expect(lineage.get("SILENT_ANIMATION")).toEqual([
      `${result.id}-styled-frame`,
    ]);
    expect(lineage.get("FINAL_VIDEO")).toEqual([
      `${result.id}-animation`,
      `${result.id}-audio`,
    ]);

    const source = records[0];
    expect(source.mimeType).toBe("video/mp4");
    expect(source.byteSize).toBe(fixtureBytes.byteLength);
    const storedSourceBytes = await readFile(
      await createLocalArtifactStore().resolve(source.storageKey),
    );
    expect(createHash("sha256").update(storedSourceBytes).digest("hex")).toBe(
      source.sha256,
    );

    expect(source.metadata.durationSeconds).toBeGreaterThan(6);
    expect(source.metadata.durationSeconds).toBeLessThan(6.6);
    expect(source.metadata.width).toBe(320);
    expect(source.metadata.height).toBe(240);
    expect(source.metadata.videoCodec).toBe("h264");
    expect(source.metadata.audioPresent).toBe(true);

    const final = records[records.length - 1];
    expect(final.metadata.width).toBe(360);
    expect(final.metadata.height).toBe(640);
    expect(final.metadata.audioPresent).toBe(true);
  }, 120_000);

  it("resolves stored keys inside the artifact root and refuses escapes", async () => {
    expect(createdJobId).toBeDefined();
    const store = createLocalArtifactStore();
    const sourceKey = generateArtifactStorageKey(
      createdJobId as string,
      "source.mp4",
    );

    const resolved = await store.resolve(sourceKey);
    expect(resolved.startsWith(getLocalArtifactRoot())).toBe(true);

    expect(
      await errorCodeOfPromise(
        store.resolve(`${createdJobId}/../../../etc/passwd`),
      ),
    ).toBe("INVALID_STORAGE_KEY");
  });
});
