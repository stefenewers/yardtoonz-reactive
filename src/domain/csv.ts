/**
 * Minimal RFC 4180 CSV parsing for candidate intake. Pure by design:
 * text in, table out, no filesystem or network access.
 */

export class CsvParseError extends Error {
  constructor(
    message: string,
    readonly lineNumber: number,
  ) {
    super(`CSV parse error on line ${lineNumber}: ${message}`);
    this.name = "CsvParseError";
  }
}

export interface CsvRow {
  readonly cells: string[];
  readonly startLine: number;
}

export interface CsvTable {
  readonly header: string[];
  readonly rows: readonly CsvRow[];
}

interface RawRecord {
  readonly cells: string[];
  readonly startLine: number;
}

export function parseCsvTable(text: string): CsvTable {
  const records: RawRecord[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordOpen = false;
  let recordStartLine = 1;
  let fieldStartLine = 1;

  const endRecord = () => {
    cells.push(field);
    field = "";
    records.push({ cells, startLine: recordStartLine });
    cells = [];
    recordOpen = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (character === "\n") line += 1;
        field += character;
      }
      continue;
    }
    if (character === '"') {
      if (field !== "") {
        throw new CsvParseError("quote appears inside an unquoted field", line);
      }
      if (!recordOpen) {
        recordOpen = true;
        recordStartLine = line;
      }
      fieldStartLine = line;
      inQuotes = true;
      continue;
    }
    if (character === ",") {
      if (!recordOpen) {
        recordOpen = true;
        recordStartLine = line;
      }
      cells.push(field);
      field = "";
      continue;
    }
    if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      if (recordOpen || field !== "") endRecord();
      line += 1;
      continue;
    }
    if (!recordOpen) {
      recordOpen = true;
      recordStartLine = line;
    }
    field += character;
  }

  if (inQuotes) {
    throw new CsvParseError("unterminated quoted field", fieldStartLine);
  }
  if (recordOpen || field !== "") endRecord();

  const content = records.filter(
    (record) => record.cells.length > 1 || (record.cells[0] ?? "") !== "",
  );
  const [header, ...rows] = content;
  if (!header) {
    throw new CsvParseError("input is empty", 1);
  }
  for (const row of rows) {
    if (row.cells.length > header.cells.length) {
      throw new CsvParseError(
        "row has more fields than the header",
        row.startLine,
      );
    }
  }

  return {
    header: header.cells,
    rows: rows.map((row) => ({ cells: row.cells, startLine: row.startLine })),
  };
}
