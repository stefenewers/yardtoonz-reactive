import type { ServerEnvironment } from "./env-schema";
import type {
  MediaToolDiagnostic,
  MediaToolName,
  MediaToolStatus,
} from "./media-tools";

interface PublicMediaToolStatus {
  name: MediaToolName;
  available: boolean;
  diagnostic: MediaToolDiagnostic;
}

export interface PublicHealthReport {
  status: "ok" | "degraded";
  providers: {
    image: ServerEnvironment["IMAGE_PROVIDER"];
    animation: ServerEnvironment["ANIMATION_PROVIDER"];
  };
  checks: {
    mediaTools: PublicMediaToolStatus[];
  };
}

function toPublicMediaToolStatus(
  status: MediaToolStatus,
): PublicMediaToolStatus {
  return {
    name: status.name,
    available: status.available,
    diagnostic: status.diagnostic,
  };
}

export function createPublicHealthReport(
  environment: Pick<ServerEnvironment, "IMAGE_PROVIDER" | "ANIMATION_PROVIDER">,
  mediaTools: MediaToolStatus[],
): PublicHealthReport {
  return {
    status: mediaTools.every((tool) => tool.available) ? "ok" : "degraded",
    providers: {
      image: environment.IMAGE_PROVIDER,
      animation: environment.ANIMATION_PROVIDER,
    },
    checks: { mediaTools: mediaTools.map(toPublicMediaToolStatus) },
  };
}
