import { describe, expect, it } from "vitest";

import { CsvParseError, parseCsvTable } from "../../src/domain/csv";

function csvError(parse: () => unknown): CsvParseError {
  try {
    parse();
  } catch (error) {
    if (error instanceof CsvParseError) return error;
    throw error;
  }
  throw new Error("expected parseCsvTable to throw a CsvParseError");
}

describe("parseCsvTable", () => {
  it("parses a header and rows separated by commas and newlines", () => {
    const table = parseCsvTable("id,platform\nc1,TIKTOK\nc2,YOUTUBE");

    expect(table.header).toEqual(["id", "platform"]);
    expect(table.rows.map((row) => row.cells)).toEqual([
      ["c1", "TIKTOK"],
      ["c2", "YOUTUBE"],
    ]);
  });

  it("accepts CRLF record separators", () => {
    const table = parseCsvTable("a,b\r\n1,2\r\n");

    expect(table.header).toEqual(["a", "b"]);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].cells).toEqual(["1", "2"]);
  });

  it("supports quoted fields with commas, escaped quotes, and embedded newlines", () => {
    const table = parseCsvTable(
      'caption,note\n"He said, ""wait""","line one\nline two"',
    );

    expect(table.rows[0].cells).toEqual([
      'He said, "wait"',
      "line one\nline two",
    ]);
  });

  it("skips blank lines between records", () => {
    const table = parseCsvTable("a\n\n1\n\n2");

    expect(table.rows.map((row) => row.cells)).toEqual([["1"], ["2"]]);
  });

  it("keeps short rows as-is and rejects rows wider than the header", () => {
    const short = parseCsvTable("a,b,c\n1");
    expect(short.rows[0].cells).toEqual(["1"]);

    const tooWide = csvError(() => parseCsvTable("a,b\n1,2,3"));
    expect(tooWide.message).toContain("more fields than the header");
  });

  it("rejects empty input", () => {
    expect(() => parseCsvTable("")).toThrowError(CsvParseError);
    expect(() => parseCsvTable("\n\n")).toThrowError(CsvParseError);
  });

  it("reports the starting line of an unterminated quoted field", () => {
    const error = csvError(() => parseCsvTable('a,b\n1,"unterminated'));

    expect(error.lineNumber).toBe(2);
  });

  it("rejects quotes that appear inside unquoted fields", () => {
    const error = csvError(() => parseCsvTable('a,b\nsay "hi",2'));

    expect(error.lineNumber).toBe(2);
  });
});
