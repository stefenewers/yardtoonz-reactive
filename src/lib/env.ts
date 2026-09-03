import "server-only";

import { parseServerEnvironment } from "@/lib/env-schema";

export const env = parseServerEnvironment(process.env);
