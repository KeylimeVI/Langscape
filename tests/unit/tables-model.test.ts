import { describe, expect, it } from "vitest";
import {
  cellIndexForColumn,
  escapeCell,
  findTable,
  findTables,
  mergeDirectionally,
  mergeSelection,
  normalizeRightMarkers,
  normalizeRect,
  parseTableAt,
  rectFromEditorSelection,
  resolveLayout,
  serializeTable,
  splitCellAt,
  tableFromDomRows,
} from "../../src/tables/model";

function table(lines: string[], start = 0) {
  const parsed = parseTableAt(lines, start);
  if (!parsed) throw new Error("not a table");
  return parsed;
}

const basic = [
  "| Name | Form | Meaning |",
  "| --- | :---: | ---: |",
  "| apa | < | water |",
  "| eke | river | ^ |",
];

describe("Markdown table parsing", () => {
  it("parses header, alignment and body rows", () => {
    const parsed = table(basic);
    expect(parsed.startLine).toBe(0);
    expect(parsed.endLine).toBe(3);
    expect(parsed.columns).toBe(3);
    expect(parsed.aligns).toEqual(["default", "center", "right"]);
    expect(parsed.rows.map((row) => row.map((cell) => cell.text))).toEqual([
      ["Name", "Form", "Meaning"],
      ["apa", "<", "water"],
      ["eke", "river", "^"],
    ]);
    expect(parsed.rows[1][1].marker).toBe("<");
    expect(parsed.rows[2][2].marker).toBe("^");
  });

  it("keeps escaped pipes and escaped markers as content", () => {
    const parsed = table([
      "| A | B |",
      "| --- | --- |",
      "| a \\| b | \\< |",
    ]);
    expect(parsed.rows[1][0].text).toBe("a | b");
    expect(parsed.rows[1][0].marker).toBeNull();
    expect(parsed.rows[1][1].text).toBe("<");
    expect(parsed.rows[1][1].marker).toBeNull();
  });

  it("stops at blank lines and ignores fenced code", () => {
    const lines = [
      "| A | B |",
      "| --- | --- |",
      "| a | b |",
      "",
      "| C | D |",
      "| --- | --- |",
      "| c | d |",
      "",
      "```",
      "| E | F |",
      "| --- | --- |",
      "| e | f |",
      "```",
    ];
    expect(findTables(lines)).toHaveLength(2);
    expect(findTables(lines).map((entry) => entry.startLine)).toEqual([0, 4]);
    expect(findTable(lines, 10)).toBeNull();
  });

  it("parses and rewrites a table inside a blockquote/callout", () => {
    const lines = [
      "> | A | B |",
      "> | --- | --- |",
      "> | a | b |",
    ];
    const parsed = table(lines);
    expect(parsed.prefix).toBe("> ");
    expect(parsed.rows[1].map((cell) => cell.text)).toEqual(["a", "b"]);
    expect(cellIndexForColumn(parsed, lines[2], 6)).toBe(1);
    const result = mergeSelection(parsed, { r1: 1, c1: 0, r2: 1, c2: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = serializeTable(parsed, result.rows, lines)!;
    expect(serialized.text.split("\n")).toEqual([
      "> | A | B |",
      "> | --- | --- |",
      "> | a b | < |",
    ]);
  });

  it("does not treat a naked separator as a table", () => {
    expect(parseTableAt(["| --- | --- |", "| a | b |"], 0)).toBeNull();
  });
});

describe("merge layout", () => {
  it("resolves left and up markers into spans", () => {
    const parsed = table([
      "| A | B | C |",
      "| --- | --- | --- |",
      "| a | b | c |",
      "| d | < | ^ |",
    ]);
    const layout = resolveLayout(parsed);
    expect(layout.groups).toHaveLength(2);
    expect(layout.groups[0]).toMatchObject({ r: 1, c: 2, rowSpan: 2, colSpan: 1, text: "c" });
    expect(layout.groups[1]).toMatchObject({ r: 2, c: 0, rowSpan: 1, colSpan: 2, text: "d" });
  });

  it("resolves a 2x2 rectangle", () => {
    const parsed = table([
      "| A | B |",
      "| --- | --- |",
      "| a | < |",
      "| ^ | < |",
    ]);
    const layout = resolveLayout(parsed);
    expect(layout.groups).toHaveLength(1);
    expect(layout.groups[0]).toMatchObject({ r: 1, c: 0, rowSpan: 2, colSpan: 2, text: "a" });
    expect(layout.byCell[2][1]).toBe(layout.groups[0]);
  });

  it("chains left markers across several columns", () => {
    const parsed = table([
      "| A | B | C | D |",
      "| --- | --- | --- | --- |",
      "| a | < | < | d |",
    ]);
    const layout = resolveLayout(parsed);
    expect(layout.groups).toHaveLength(1);
    expect(layout.groups[0]).toMatchObject({ r: 1, c: 0, colSpan: 3, text: "a" });
  });

  it("leaves invalid and non-rectangular markers visible", () => {
    const parsed = table([
      "| A | B | C |",
      "| --- | --- | --- |",
      "| a | < | c |",
      "| d | ^ | e |",
    ]);
    const layout = resolveLayout(parsed);
    expect(layout.groups).toHaveLength(0);
    expect(layout.warnings[0]).toContain("not a rectangle");
  });

  it("does not merge across the header/body boundary", () => {
    const parsed = table([
      "| A | B |",
      "| --- | --- |",
      "| ^ | b |",
    ]);
    expect(resolveLayout(parsed).groups).toHaveLength(0);
  });

  it("canonicalizes right markers so text sits in the anchor", () => {
    const parsed = table([
      "| A | B | C |",
      "| --- | --- | --- |",
      "| a | > | c |",
    ]);
    const rows = normalizeRightMarkers(parsed);
    expect(rows).not.toBeNull();
    expect(rows![1].map((cell) => [cell.text, cell.marker])).toEqual([
      ["a", null],
      ["c", null],
      ["", "<"],
    ]);
  });
});

describe("merge and split", () => {
  const grid = [
    "| A | B |",
    "| --- | --- |",
    "| a | b |",
    "| c | d |",
  ];

  it("merges a rectangle and joins non-empty contents", () => {
    const parsed = table(grid);
    const result = mergeSelection(parsed, { r1: 1, c1: 0, r2: 2, c2: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[1].map((cell) => cell.marker)).toEqual([null, "<"]);
    expect(result.rows[2].map((cell) => cell.marker)).toEqual(["^", "<"]);
    expect(result.rows[1][0].text).toBe("a b c d");
    const layout = resolveLayout({ ...parsed, rows: result.rows });
    expect(layout.groups[0]).toMatchObject({ rowSpan: 2, colSpan: 2, text: "a b c d" });
  });

  it("allows header-only merges but refuses to cross the header", () => {
    const parsed = table(grid);
    expect(mergeSelection(parsed, { r1: 0, c1: 0, r2: 0, c2: 1 }).ok).toBe(true);
    const crossing = mergeSelection(parsed, { r1: 0, c1: 0, r2: 1, c2: 1 });
    expect(crossing.ok).toBe(false);
    if (!crossing.ok) expect(crossing.reason).toContain("header");
  });

  it("expands an existing merge before applying a new selection", () => {
    const parsed = table([
      "| A | B | C |",
      "| --- | --- | --- |",
      "| a | < | c |",
      "| d | e | f |",
    ]);
    const result = mergeSelection(parsed, { r1: 1, c1: 1, r2: 2, c2: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rect).toEqual({ r1: 1, c1: 0, r2: 2, c2: 1 });
  });

  it("splits a merged rectangle and clears markers", () => {
    const parsed = table([
      "| A | B |",
      "| --- | --- |",
      "| a | < |",
      "| ^ | < |",
    ]);
    const result = splitCellAt(parsed, 2, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.slice(1).flat().map((cell) => cell.marker)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(result.rows[1][0].text).toBe("a");
  });

  it("splits a right-marker group without losing its text", () => {
    const parsed = table([
      "| A | B |",
      "| --- | --- |",
      "| > | c |",
    ]);
    const result = splitCellAt(parsed, 1, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[1][0]).toEqual({ text: "c", marker: null });
    expect(result.rows[1][1]).toEqual({ text: "", marker: null });
  });

  it("merges in a direction and rejects impossible directions", () => {
    const parsed = table(grid);
    const right = mergeDirectionally(parsed, 1, 0, "right");
    expect(right.ok).toBe(true);
    if (right.ok) expect(right.rect).toEqual({ r1: 1, c1: 0, r2: 1, c2: 1 });
    expect(mergeDirectionally(parsed, 1, 0, "left").ok).toBe(false);
  });
});

describe("serialization", () => {
  it("keeps alignment and untouched rows byte-for-byte", () => {
    const lines = [
      "| Name | Form |",
      "| ---- | ---: |",
      "| apa  | <    |",
      "| eke  | river |",
    ];
    const parsed = table(lines);
    const result = splitCellAt(parsed, 1, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = serializeTable(parsed, result.rows, lines)!;
    expect(serialized.text.split("\n")).toEqual([
      "| Name | Form |",
      "| ---- | ---: |",
      "| apa  |     |",
      "| eke  | river |",
    ]);
  });

  it("escapes content that would otherwise look like a marker", () => {
    expect(escapeCell("<")).toBe("\\<");
    expect(escapeCell("a | b")).toBe("a \\| b");
    expect(escapeCell("plain")).toBe("plain");
  });

  it("returns null when nothing changed", () => {
    const lines = ["| A | B |", "| --- | --- |", "| a | b |"];
    const parsed = table(lines);
    expect(serializeTable(parsed, parsed.rows, lines)).toBeNull();
  });
});

describe("right-marker normalization and serialization", () => {
  it("rewrites > into a canonical < and preserves the content", () => {
    const lines = ["| A | B | C |", "| --- | --- | --- |", "| a | > | c |"];
    const parsed = table(lines);
    const rows = normalizeRightMarkers(parsed)!;
    const serialized = serializeTable(parsed, rows, lines)!;
    expect(serialized.text.split("\n")[2]).toBe("| a | c | < |");
    const canonical = { ...parsed, rows };
    expect(resolveLayout(canonical).groups[0]).toMatchObject({ c: 1, colSpan: 2, text: "c" });
  });
});

describe("selection mapping", () => {
  const lines = [
    "| A | B | C |",
    "| --- | --- | --- |",
    "| a | b | c |",
    "| d | e | f |",
  ];

  it("maps character offsets to cell indexes", () => {
    const parsed = table(lines);
    expect(cellIndexForColumn(parsed, lines[2], 2)).toBe(0);
    expect(cellIndexForColumn(parsed, lines[2], 6)).toBe(1);
    expect(cellIndexForColumn(parsed, lines[2], 10)).toBe(2);
  });

  it("maps an editor selection to a rectangle", () => {
    const parsed = table(lines);
    const rect = rectFromEditorSelection(
      parsed,
      lines,
      { line: 2, ch: 2 },
      { line: 3, ch: 6 }
    );
    expect(rect).toEqual({ r1: 1, c1: 0, r2: 2, c2: 1 });
  });

  it("normalizes and clamps rectangles", () => {
    expect(normalizeRect({ r1: 5, c1: 5, r2: -2, c2: 1 }, 3, 3)).toEqual({
      r1: 0,
      c1: 1,
      r2: 2,
      c2: 2,
    });
  });
});

describe("DOM fallback", () => {
  it("builds a table from rendered rows", () => {
    const parsed = tableFromDomRows([
      { cells: ["A", "B"] },
      { cells: ["a", "<"] },
    ]);
    expect(parsed?.columns).toBe(2);
    expect(parsed?.rows[1][1].marker).toBe("<");
    expect(resolveLayout(parsed!).groups).toHaveLength(1);
  });
});
