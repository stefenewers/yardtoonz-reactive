import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { getMediaToolHealth } from "@/lib/media-tools";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const mediaTools = await getMediaToolHealth();
  const healthy = mediaTools.every((tool) => tool.available);

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      providerMode: env.PROVIDER_MODE,
      checks: { mediaTools },
    },
    { status: healthy ? 200 : 503 },
  );
}
