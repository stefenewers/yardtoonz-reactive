import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync, statSync } from "node:fs";
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

interface FileIdentity {
  dev: number;
  ino: number;
}

function readFileIdentity(filename: string): FileIdentity | undefined {
  try {
    const stats = statSync(filename);
    return { dev: stats.dev, ino: stats.ino };
  } catch {
    // The file was removed (for example by a concurrent demo reset); the
    // caller treats a missing file as a stale handle.
    return undefined;
  }
}

/**
 * A database connection that stays fresh across demo resets.
 *
 * `demo:reset` deletes and recreates the SQLite file, so a long-lived server
 * singleton holding one `openDatabase` handle would keep reading the deleted
 * inode — pre-reset rows — for the rest of the process. The provider returns
 * the same connection while the file on disk is still the one it opened, and
 * silently reopens (migrations included) when the file was replaced.
 */
export interface DatabaseProvider {
  getConnection(): DatabaseConnection;
}

export function createDatabaseProvider(
  databaseUrl: string,
  options: DatabaseOptions = {},
): DatabaseProvider {
  let connection: DatabaseConnection | undefined;
  let openedIdentity: FileIdentity | undefined;

  function openFresh(): DatabaseConnection {
    connection?.sqlite.close();
    connection = openDatabase(databaseUrl, options);
    openedIdentity = readFileIdentity(
      resolveSqliteFilename(
        databaseUrl,
        options.workingDirectory ?? process.cwd(),
      ),
    );
    return connection;
  }

  return {
    getConnection(): DatabaseConnection {
      const filename = resolveSqliteFilename(
        databaseUrl,
        options.workingDirectory ?? process.cwd(),
      );
      // In-memory databases have no file identity to re-check; the handle
      // lives and dies with this provider.
      if (filename === ":memory:") {
        connection ??= openDatabase(databaseUrl, options);
        return connection;
      }
      const current = readFileIdentity(filename);
      if (
        connection &&
        current &&
        openedIdentity &&
        current.dev === openedIdentity.dev &&
        current.ino === openedIdentity.ino
      ) {
        return connection;
      }
      return openFresh();
    },
  };
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
