import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import path from "node:path";

import * as schema from "./schema";

function databasePath(databaseUrl: string): string {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("DATABASE_URL must use the file: scheme for local SQLite");
  }

  return path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    databaseUrl.slice("file:".length),
  );
}

export function openDatabase(databaseUrl: string): {
  database: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
} {
  const filename = databasePath(databaseUrl);
  mkdirSync(path.dirname(filename), { recursive: true });
  const sqlite = new Database(filename);
  sqlite.pragma("foreign_keys = ON");
  const database = drizzle(sqlite, { schema });
  migrate(database, {
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });
  return { database, sqlite };
}
