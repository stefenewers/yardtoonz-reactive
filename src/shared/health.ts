import { z } from "zod";

/**
 * Public health payload contract (`PublicHealthReport` in lib/health-report).
 * Bounded status categories only — never secrets, paths, versions, or raw
 * exceptions. Used by the client to validate every health response.
 */
export const publicMediaToolStatusSchema = z
  .object({
    name: z.string().min(1),
    available: z.boolean(),
    diagnostic: z.string().min(1),
  })
  .readonly();

export const publicHealthReportSchema = z
  .object({
    status: z.enum(["ok", "degraded"]),
    providers: z.object({
      image: z.enum(["MOCK", "OPENAI"]),
      animation: z.enum(["MOCK", "RUNWAY"]),
    }),
    checks: z.object({
      database: z.object({ diagnostic: z.enum(["available", "unavailable"]) }),
      artifactRoot: z.object({
        diagnostic: z.enum(["writable", "unwritable"]),
      }),
      mediaTools: z.array(publicMediaToolStatusSchema),
      worker: z.object({
        diagnostic: z.enum(["fresh", "stale", "unknown"]),
      }),
    }),
  })
  .readonly();

export type PublicHealthReportPayload = z.infer<
  typeof publicHealthReportSchema
>;
