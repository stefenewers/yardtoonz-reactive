import { randomUUID } from "node:crypto";
import { z } from "zod";

import { candidateFixtures } from "@/../fixtures/candidates";
import { parseCsvTable, type CsvTable } from "@/domain/csv";
import type { EngagementMetrics } from "@/shared/candidates";
import { fitChecklistKeys } from "@/shared/candidates";
import {
  candidateIntakeRecordSchema,
  type CandidateIntakeProviderKind,
  type CandidateIntakeRecord,
  type CandidateIntakeResult,
} from "@/shared/candidate-intake";

import type { CandidateRepository } from "./repository";

export type CandidateIntakeErrorCode =
  | "INVALID_CSV"
  | "INVALID_RECORD"
  | "DUPLICATE_ID";

export class CandidateIntakeError extends Error {
  constructor(
    readonly code: CandidateIntakeErrorCode,
    readonly issues: readonly string[],
  ) {
    super(issues.join("; "));
    this.name = "CandidateIntakeError";
  }
}

/**
 * Intake point for future discovery providers: a provider yields raw
 * candidate payloads and `importCandidates` owns validation, scoring,
 * and non-destructive persistence.
 */
export interface CandidateIntakeProvider {
  readonly kind: CandidateIntakeProviderKind;
  load(): readonly unknown[];
}

export function createSeededCandidateIntakeProvider(): CandidateIntakeProvider {
  return { kind: "SEEDED", load: () => candidateFixtures };
}

export function createManualCandidateIntakeProvider(
  payload: unknown,
): CandidateIntakeProvider {
  return { kind: "MANUAL", load: () => [payload] };
}

/**
 * Intake point for the Trend Scout: feed items already normalized by the
 * scout domain arrive as intake records and pass through the same
 * validation, scoring, and non-destructive persistence as every other
 * provider. The scout dedupes by fingerprint before handing records over.
 */
export function createTrendFeedCandidateIntakeProvider(
  records: readonly CandidateIntakeRecord[],
): CandidateIntakeProvider {
  return { kind: "TREND_FEED", load: () => records };
}

const csvMetricColumns = [
  "views",
  "likes",
  "comments",
  "shares",
  "saves",
] as const satisfies readonly (keyof EngagementMetrics)[];

const csvFitChecklistColumns: readonly string[] = fitChecklistKeys;

export const requiredCsvColumns = [
  "platform",
  "sourceLabel",
  "caption",
  "observedAt",
  ...csvFitChecklistColumns,
] as const;

const supportedCsvColumns: readonly string[] = [
  "id",
  "platform",
  "sourceUrl",
  "sourceLabel",
  "caption",
  "publishedAt",
  "observedAt",
  "adaptationNote",
  "commentExcerpts",
  ...csvMetricColumns,
  ...csvFitChecklistColumns,
];

const csvMetricColumnSet: ReadonlySet<string> = new Set(csvMetricColumns);
const csvFitChecklistColumnSet: ReadonlySet<string> = new Set(
  csvFitChecklistColumns,
);

/**
 * Comment excerpts ride in one cell, separated by `;;`, because a lone
 * comma or semicolon is common inside real comment text.
 */
function splitCommentExcerpts(cell: string): string[] {
  return cell
    .split(";;")
    .map((excerpt) => excerpt.trim())
    .filter((excerpt) => excerpt !== "");
}

function parseBooleanCell(cell: string): boolean | string {
  const normalized = cell.toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return cell;
}

export function csvTableToIntakeRecords(table: CsvTable): readonly unknown[] {
  const header = table.header.map((column) => column.trim());
  const missingColumns = requiredCsvColumns.filter(
    (column) => !header.includes(column),
  );
  if (missingColumns.length > 0) {
    throw new CandidateIntakeError("INVALID_CSV", [
      `missing required column(s): ${missingColumns.join(", ")}`,
    ]);
  }
  const unsupportedColumns = header.filter(
    (column) => column !== "" && !supportedCsvColumns.includes(column),
  );
  if (unsupportedColumns.length > 0) {
    throw new CandidateIntakeError("INVALID_CSV", [
      `unsupported column(s): ${unsupportedColumns.join(", ")}`,
    ]);
  }

  return table.rows.map((row) => {
    const record: Record<string, unknown> = {};
    const metrics: Record<string, number> = {};
    const fitChecklist: Record<string, unknown> = {};
    header.forEach((column, index) => {
      const cell = (row.cells[index] ?? "").trim();
      if (cell === "") return;
      if (csvMetricColumnSet.has(column)) {
        metrics[column] = Number(cell);
      } else if (csvFitChecklistColumnSet.has(column)) {
        fitChecklist[column] = parseBooleanCell(cell);
      } else if (column === "commentExcerpts") {
        record[column] = splitCommentExcerpts(cell);
      } else if (column === "platform") {
        record[column] = cell.toUpperCase();
      } else {
        record[column] = cell;
      }
    });
    record.metrics = metrics;
    record.fitChecklist = fitChecklist;
    return record;
  });
}

export function createCsvCandidateIntakeProvider(
  csv: string,
): CandidateIntakeProvider {
  return {
    kind: "CSV",
    load: () => {
      let table: CsvTable;
      try {
        table = parseCsvTable(csv);
      } catch (error) {
        if (error instanceof Error) {
          throw new CandidateIntakeError("INVALID_CSV", [error.message]);
        }
        throw error;
      }
      return csvTableToIntakeRecords(table);
    },
  };
}

function formatRecordIssues(index: number, error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `record ${index + 1}: ${path}${issue.message}`;
  });
}

/**
 * Validate every payload from a provider, refuse duplicates, then persist
 * the batch in one transaction. Importing zero records is a no-op, and a
 * failed import leaves existing candidates and comments untouched.
 */
export function importCandidates(input: {
  provider: CandidateIntakeProvider;
  repository: CandidateRepository;
  now: string;
}): CandidateIntakeResult {
  const parseResults = input.provider.load().map((payload, index) => ({
    index,
    parsed: candidateIntakeRecordSchema.safeParse(payload),
  }));
  // Collect every row's failures so one import attempt reports all of them.
  const parseFailures = parseResults.flatMap(({ index, parsed }) =>
    parsed.success ? [] : formatRecordIssues(index, parsed.error),
  );
  if (parseFailures.length > 0) {
    throw new CandidateIntakeError("INVALID_RECORD", parseFailures);
  }
  const records = parseResults.flatMap(({ parsed }) =>
    parsed.success ? [parsed.data] : [],
  );
  const seenIds = new Set<string>(
    input.repository.list().map((candidate) => candidate.id),
  );
  const candidateIds = records.map((record) => {
    const id = record.id ?? `cand_${randomUUID()}`;
    if (seenIds.has(id)) {
      throw new CandidateIntakeError("DUPLICATE_ID", [
        `candidate id already exists: ${id}`,
      ]);
    }
    seenIds.add(id);
    return id;
  });

  const imported = input.repository.importIntake(
    records.map((record, index) => ({ ...record, id: candidateIds[index] })),
    input.now,
  );

  return {
    providerKind: input.provider.kind,
    imported,
    candidateIds,
  };
}
