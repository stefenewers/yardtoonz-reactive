import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export type ArtifactRootHealthDiagnostic = "writable" | "unwritable";

export interface ArtifactRootProbe {
  diagnostic: ArtifactRootHealthDiagnostic;
  /** Internal resolved path for server-side logs; never serialized publicly. */
  path: string;
  /** Internal failure detail for server-side logs; never serialized publicly. */
  error?: string;
}

/**
 * Verifies the artifact root exists (creating it if needed) and accepts a
 * uniquely named probe file. Writing and removing a file is the only honest
 * writability test; access bits alone do not prove the process can write.
 */
export function probeArtifactRoot(
  artifactRoot: string,
  workingDirectory = process.cwd(),
): ArtifactRootProbe {
  const resolvedPath = path.resolve(workingDirectory, artifactRoot);
  const probeFile = path.join(resolvedPath, `.health-probe-${randomUUID()}`);

  try {
    mkdirSync(resolvedPath, { recursive: true });
    writeFileSync(probeFile, "yardtoonz artifact-root health probe", "utf8");

    return { diagnostic: "writable", path: resolvedPath };
  } catch (error: unknown) {
    return {
      diagnostic: "unwritable",
      path: resolvedPath,
      error:
        error instanceof Error ? error.message : "Unknown artifact-root error",
    };
  } finally {
    try {
      rmSync(probeFile, { force: true });
    } catch {
      // Cleanup is best effort: an unremovable probe file must not mask the
      // probe result itself.
    }
  }
}
