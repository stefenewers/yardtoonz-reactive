import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { apiError, invalidRequest } from "@/server/api-response";
import { createDatabaseProvider } from "@/server/db/client";
import { readProductionAttribution } from "@/server/productions/attribution";
import { productionAttributionResponseSchema } from "@/shared/attribution";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

const databaseProvider = createDatabaseProvider(env.DATABASE_URL);

/**
 * The persisted source attribution for one production: origin reference,
 * editorial caption, generated social caption, and rights record. Read-only
 * by design — nothing here triggers a platform fetch.
 */
export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const outcome = readProductionAttribution(
      databaseProvider.getConnection().database,
      id,
    );

    if (!outcome) {
      return apiError("PRODUCTION_NOT_FOUND", "Production not found.", 404);
    }

    return NextResponse.json(
      productionAttributionResponseSchema.parse({ attribution: outcome }),
    );
  } catch (error) {
    return invalidRequest(error, "Attribution lookup");
  }
}
