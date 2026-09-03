/**
 * Structured logger for services and worker processes.
 *
 * Every event is a single JSON line with a stable field set so local log
 * collectors can correlate entries. The Technical Specification (§12) requires
 * request or job ID, production ID, stage, attempt, provider and provider
 * mode, elapsed time, and a stable error code.
 *
 * Callers must never pass provider credentials, source file contents, or full
 * user-supplied creative prompts in the message or context.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const logLevels: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface StructuredLogContext {
  /** Correlates one request or job across log lines. */
  requestId?: string;
  /** Worker process identity for heartbeat and startup correlation. */
  workerId?: string;
  productionId?: string;
  stage?: string;
  attempt?: number;
  provider?: string;
  providerMode?: string;
  elapsedMs?: number;
  /** Stable error code shared by tests and runbooks, e.g. WORKER_DB_OPEN_FAILED. */
  errorCode?: string;
  /** Short internal failure detail. Never include secrets or user content. */
  errorDetail?: string;
}

export interface Logger {
  debug(message: string, context?: StructuredLogContext): void;
  info(message: string, context?: StructuredLogContext): void;
  warn(message: string, context?: StructuredLogContext): void;
  error(message: string, context?: StructuredLogContext): void;
  /** Returns a logger that merges the given context into every event. */
  child(context: StructuredLogContext): Logger;
}

export interface LoggerOptions {
  /** Events below this level are dropped. Default: "info". */
  minLevel?: LogLevel;
  /** Line sink; defaults to console.log. Tests inject a collector. */
  write?: (line: string) => void;
}

function mergeContext(
  inherited: StructuredLogContext | undefined,
  overrides: StructuredLogContext | undefined,
): StructuredLogContext {
  return { ...inherited, ...overrides };
}

function toLogEntry(
  level: LogLevel,
  message: string,
  context: StructuredLogContext,
): Record<string, string | number> {
  const entry: Record<string, string | number> = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined) {
      entry[key] = value;
    }
  }

  return entry;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const minLevel = options.minLevel ?? "info";
  const write = options.write ?? ((line: string) => console.log(line));

  function log(
    level: LogLevel,
    message: string,
    context: StructuredLogContext = {},
  ): void {
    if (logLevels[level] < logLevels[minLevel]) return;

    write(JSON.stringify(toLogEntry(level, message, context)));
  }

  function child(childContext: StructuredLogContext): Logger {
    function logWithInherited(
      level: LogLevel,
      message: string,
      context: StructuredLogContext = {},
    ): void {
      log(level, message, mergeContext(childContext, context));
    }

    return {
      debug: (message, context) => logWithInherited("debug", message, context),
      info: (message, context) => logWithInherited("info", message, context),
      warn: (message, context) => logWithInherited("warn", message, context),
      error: (message, context) => logWithInherited("error", message, context),
      child: (nested) => child(mergeContext(childContext, nested)),
    };
  }

  return {
    debug: (message, context) => log("debug", message, context),
    info: (message, context) => log("info", message, context),
    warn: (message, context) => log("warn", message, context),
    error: (message, context) => log("error", message, context),
    child,
  };
}
