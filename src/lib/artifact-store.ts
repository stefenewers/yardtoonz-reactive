import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { env } from "./env";

export type ArtifactStoreErrorCode =
  | "INVALID_STORAGE_KEY"
  | "SIZE_LIMIT_EXCEEDED"
  | "INVALID_ARTIFACT"
  | "WRITE_FAILED"
  | "ARTIFACT_NOT_FOUND";

export class ArtifactStoreError extends Error {
  constructor(public readonly code: ArtifactStoreErrorCode) {
    super(code);
  }
}

export interface StoredArtifact {
  storageKey: string;
  byteSize: number;
  sha256: string;
}

export interface SaveArtifactInput {
  bytes: Uint8Array;
  storageKey: string;
  mimeType: string;
}

/**
 * Local-filesystem artifact storage behind the technical-spec §5 interface.
 * A later object-storage implementation can replace it without changing the
 * pipeline contracts.
 */
export interface ArtifactStore {
  save(input: SaveArtifactInput): Promise<StoredArtifact>;
  inspect(storageKey: string): Promise<StoredArtifact>;
  resolve(storageKey: string): Promise<string>;
}

export interface ArtifactStoreOptions {
  rootDirectory?: string;
  maxUploadBytes?: number;
}

/**
 * Storage keys are generated internally and must stay inside the artifact
 * root: printable ASCII path segments without leading dots, so neither user
 * filenames nor traversal sequences can influence where bytes land.
 */
const storageKeySchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/,
    "Storage keys must be generated internally",
  )
  .refine((key) => !key.split("/").includes(".."), {
    message: "Storage keys may not traverse directories",
  });

export function validateStorageKey(storageKey: string): string {
  const parsed = storageKeySchema.safeParse(storageKey);
  if (!parsed.success) {
    throw new ArtifactStoreError("INVALID_STORAGE_KEY");
  }
  return parsed.data;
}

/**
 * Builds a storage key from trusted internal components. User-supplied
 * filenames are never passed here; anything outside the key grammar is
 * rejected instead of sanitized.
 */
export function generateArtifactStorageKey(
  scope: string,
  fileName: string,
): string {
  const segment = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  if (!segment.test(scope) || !segment.test(fileName)) {
    throw new ArtifactStoreError("INVALID_STORAGE_KEY");
  }
  return `${scope}/${fileName}`;
}

export function getLocalArtifactRoot(): string {
  return path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    env.ARTIFACT_ROOT,
  );
}

export function createLocalArtifactStore(
  options: ArtifactStoreOptions = {},
): ArtifactStore {
  const rootDirectory = path.resolve(
    options.rootDirectory ?? getLocalArtifactRoot(),
  );
  const maxUploadBytes =
    options.maxUploadBytes ?? env.MAX_UPLOAD_MB * 1024 * 1024;

  function toAbsolutePath(storageKey: string): string {
    validateStorageKey(storageKey);
    const resolvedPath = path.resolve(rootDirectory, storageKey);
    const relative = path.relative(rootDirectory, resolvedPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new ArtifactStoreError("INVALID_STORAGE_KEY");
    }
    return resolvedPath;
  }

  return {
    async save(input: SaveArtifactInput): Promise<StoredArtifact> {
      const { bytes, storageKey } = input;
      const absolutePath = toAbsolutePath(storageKey);

      if (bytes.byteLength === 0) {
        throw new ArtifactStoreError("INVALID_ARTIFACT");
      }
      if (bytes.byteLength > maxUploadBytes) {
        throw new ArtifactStoreError("SIZE_LIMIT_EXCEEDED");
      }

      try {
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, bytes);
      } catch {
        throw new ArtifactStoreError("WRITE_FAILED");
      }

      return {
        storageKey,
        byteSize: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    },

    async inspect(storageKey: string): Promise<StoredArtifact> {
      const absolutePath = toAbsolutePath(storageKey);
      try {
        await stat(absolutePath);
      } catch {
        throw new ArtifactStoreError("ARTIFACT_NOT_FOUND");
      }

      const hash = createHash("sha256");
      let byteSize = 0;
      try {
        for await (const chunk of createReadStream(absolutePath)) {
          hash.update(chunk);
          byteSize += chunk.byteLength;
        }
      } catch {
        throw new ArtifactStoreError("WRITE_FAILED");
      }

      return { storageKey, byteSize, sha256: hash.digest("hex") };
    },

    async resolve(storageKey: string): Promise<string> {
      return toAbsolutePath(storageKey);
    },
  };
}
