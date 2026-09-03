import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import path from "node:path";

import * as schema from "./schema";

export interface DatabaseOptions {
  migrationsFolder?: string;
  workingDirectory?: string;
}

export interface DatabaseConnection {
  database: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
}

export function resolveSqliteFilename(
  databaseUrl: string,
  workingDirectory = process.cwd(),
): string {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("DATABASE_URL must use the file: scheme for local SQLite");
  }

  const encodedFilename = databaseUrl.slice("file:".length);
  if (encodedFilename === ":memory:") return encodedFilename;
  if (
    encodedFilename.length === 0 ||
    encodedFilename.includes("\0") ||
    encodedFilename.includes("?") ||
    encodedFilename.includes("#") ||
    (encodedFilename.startsWith("//") && !encodedFilename.startsWith("///"))
  ) {
    throw new Error("DATABASE_URL must name a local SQLite file");
  }

  let filename: string;
  try {
    filename = decodeURIComponent(encodedFilename);
  } catch (cause) {
    throw new Error("DATABASE_URL contains invalid path encoding", { cause });
  }
  return path.resolve(workingDirectory, filename);
}

export function openDatabase(
  databaseUrl: string,
  options: DatabaseOptions = {},
): DatabaseConnection {
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const filename = resolveSqliteFilename(databaseUrl, workingDirectory);
  if (filename !== ":memory:") {
    mkdirSync(path.dirname(filename), { recursive: true });
  }

  let sqlite: Database.Database | undefined;
  try {
    sqlite = new Database(filename);
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("busy_timeout = 5000");
    if (filename !== ":memory:") sqlite.pragma("journal_mode = WAL");

    const foreignKeysEnabled = sqlite.pragma("foreign_keys", {
      simple: true,
    });
    if (foreignKeysEnabled !== 1) {
      throw new Error("SQLite foreign key enforcement could not be enabled");
    }

    const database = drizzle(sqlite, { schema });
    migrate(database, {
      migrationsFolder:
        options.migrationsFolder ?? path.resolve(workingDirectory, "drizzle"),
    });
    return { database, sqlite };
  } catch (cause) {
    sqlite?.close();
    throw new Error("Failed to initialize the application database", { cause });
  }
}
