/**
 * Merged cells for ordinary Markdown tables.
 *
 * Markdown has no colspan/rowspan syntax, so a merged cell is encoded with a
 * marker that says which neighbouring cell it belongs to:
 *
 *   | Proto | Meaning |      | Proto | Meaning |
 *   | ---   | ---     |  ->  | ---   | ---     |
 *   | apa   | water   |      | apa   | water   |
 *   | eke   | <       |      | eke   | river   |
 *
 * `<` joins a cell to its left, `^` joins it to the cell above, and `>` joins
 * it to its right. A whole rectangle is represented by putting `<`/`^` in every
 * covered cell, which keeps the table valid Markdown and round-trips cleanly.
 *
 * The first table row is the header. Merges may span header cells, but they may
 * not cross the header/body boundary because HTML cannot continue a <th>
 * rowspan into a <tbody>.
 */
import type { EditorPosition } from "obsidian";

export type TableAlign = "default" | "left" | "center" | "right";
export type MergeDirection = "left" | "up" | "right" | "down";

export interface TableCell {
  /** Unescaped cell text. */
  text: string;
  /** Raw marker string (`<`, `^`, `>`, `<^`, ...) when the cell is a marker. */
  marker: string | null;
}

export interface CellSpan {
  raw: string;
  start: number;
  end: number;
}

export interface MarkdownTable {
  startLine: number;
  endLine: number;
  /** One entry per source line occupied by a row (header first, no separator). */
  lineNumbers: number[];
  /** Header row first, then body rows. */
  rows: TableCell[][];
  aligns: TableAlign[];
  columns: number;
  /** Common line prefix, e.g. `> ` for a table inside a callout. */
  prefix: string;
}

export interface MergeGroup {
  r: number;
  c: number;
  rowSpan: number;
  colSpan: number;
  text: string;
  /** Cell that actually holds the text. Usually the top-left cell. */
  contentR: number;
  contentC: number;
}

export interface TableLayout {
  rows: number;
  columns: number;
  groups: MergeGroup[];
  byCell: Array<Array<MergeGroup | null>>;
  warnings: string[];
}

export interface TableRect {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export type TableEditResult =
  | { ok: true; rows: TableCell[][]; rect: TableRect }
  | { ok: false; reason: string };

const MARKER_CHARS = new Set(["<", "^", ">"]);

/* -------------------------------------------------------------------------- */
/* Row parsing and serialization                                              */
/* -------------------------------------------------------------------------- */

function isEscaped(line: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && line[i] === "\\"; i--) backslashes++;
  return backslashes % 2 === 1;
}

export function hasUnescapedPipe(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "|" && !isEscaped(line, i)) return true;
  }
  return false;
}

/**
 * Split one Markdown table row into its raw cell spans. Leading and trailing
 * pipes are delimiters, not empty cells. Escaped pipes stay inside their cell.
 */
export function splitRowSpans(line: string): CellSpan[] {
  let first = 0;
  while (first < line.length && /\s/.test(line[first])) first++;
  let last = line.length - 1;
  while (last >= 0 && /\s/.test(line[last])) last--;

  let start = 0;
  let end = line.length;
  if (first <= last && line[first] === "|" && !isEscaped(line, first)) {
    start = first + 1;
  }
  if (last >= first && line[last] === "|" && !isEscaped(line, last)) {
    end = last;
  }
  if (end < start) return [{ raw: "", start: start, end: start }];

  const spans: CellSpan[] = [];
  let cellStart = start;
  for (let i = start; i < end; i++) {
    if (line[i] !== "|" || isEscaped(line, i)) continue;
    spans.push({ raw: line.slice(cellStart, i), start: cellStart, end: i });
    cellStart = i + 1;
  }
  spans.push({ raw: line.slice(cellStart, end), start: cellStart, end });
  return spans;
}

export function unescapeCell(raw: string): string {
  return raw.trim().replace(/\\([|<>^])/g, "$1");
}

export function escapeCell(text: string): string {
  let value = text.replace(/\r?\n/g, "<br>").replace(/(?<!\\)\|/g, "\\|");
  if (/^[<>^]+$/.test(value)) value = `\\${value}`;
  return value;
}

/** Text as rendered, for matching source cells to rendered table cells. */
export function plainCellText(text: string): string {
  return String(text ?? "")
    .replace(/\{[^{}:]+:\s*([^{}]*)\}/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/[*_~`]/g, "")
    .replace(/\\([|<>^])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function cellMarker(raw: string): string | null {
  const value = raw.trim();
  return /^[<>^]+$/.test(value) ? value : null;
}

export function parseRow(line: string): { cells: TableCell[]; spans: CellSpan[] } {
  const spans = splitRowSpans(line);
  return {
    spans,
    cells: spans.map((span) => ({
      text: unescapeCell(span.raw),
      marker: cellMarker(span.raw),
    })),
  };
}

function isSeparatorCell(raw: string): boolean {
  return /^:?-+:?$/.test(raw.trim());
}

export function isSeparatorLine(line: string): boolean {
  if (!hasUnescapedPipe(line)) return false;
  const spans = splitRowSpans(line);
  return spans.length > 0 && spans.every((span) => isSeparatorCell(span.raw));
}

export function separatorToAlign(raw: string): TableAlign {
  const value = raw.trim();
  const left = value.startsWith(":");
  const right = value.endsWith(":");
  if (left && right) return "center";
  if (left) return "left";
  if (right) return "right";
  return "default";
}

export function alignToSeparator(align: TableAlign): string {
  if (align === "left") return ":---";
  if (align === "center") return ":---:";
  if (align === "right") return "---:";
  return "---";
}

export function cellIsMarker(cell: TableCell): boolean {
  return cell.marker !== null && /[<>^]/.test(cell.marker);
}

export function markerDirections(cell: TableCell): {
  left: boolean;
  up: boolean;
  right: boolean;
} {
  const marker = cell.marker ?? "";
  return {
    left: marker.includes("<"),
    up: marker.includes("^"),
    right: marker.includes(">"),
  };
}

function sameCell(a: TableCell, b: TableCell): boolean {
  return a.text === b.text && a.marker === b.marker;
}

function sameRow(a: TableCell[], b: TableCell[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!sameCell(a[i], b[i])) return false;
  }
  return true;
}

export function cloneRows(rows: TableCell[][]): TableCell[][] {
  return rows.map((row) => row.map((cell) => ({ text: cell.text, marker: cell.marker })));
}

function padCells(cells: TableCell[], columns: number): TableCell[] {
  const out = cells.slice(0, columns);
  while (out.length < columns) out.push({ text: "", marker: null });
  return out;
}

function padSpans(spans: CellSpan[], columns: number): CellSpan[] {
  const out = spans.slice(0, columns);
  while (out.length < columns) out.push({ raw: "", start: 0, end: 0 });
  return out;
}

function standardRow(cells: TableCell[]): string {
  return `| ${cells.map((cell) => cell.marker ?? escapeCell(cell.text)).join(" | ")} |`;
}

function fitCell(raw: string, content: string): string {
  if (!raw.trim()) return content ? ` ${content} ` : raw;
  const start = raw.length - raw.trimStart().length;
  const end = raw.trimEnd().length;
  const lead = raw.slice(0, start);
  const trail = raw.slice(end);
  if (!lead && !trail) return ` ${content} `;
  return `${lead}${content}${trail}`;
}

/** Serialize one row, reusing the original line's spacing when possible. */
export function serializeRow(
  originalLine: string,
  originalCells: TableCell[],
  nextCells: TableCell[],
  columns: number
): string {
  const { spans } = parseRow(originalLine);
  if (spans.length !== originalCells.length || spans.length !== columns) {
    return standardRow(nextCells);
  }
  let line = originalLine;
  for (let index = spans.length - 1; index >= 0; index--) {
    if (sameCell(originalCells[index], nextCells[index])) continue;
    const content = nextCells[index].marker ?? escapeCell(nextCells[index].text);
    const span = spans[index];
    const raw = fitCell(span.raw, content);
    line = line.slice(0, span.start) + raw + line.slice(span.end);
  }
  return line;
}

/* -------------------------------------------------------------------------- */
/* Table discovery                                                            */
/* -------------------------------------------------------------------------- */

function linePrefix(line: string): string {
  return /^\s*(?:>\s?)+/.exec(line)?.[0] ?? "";
}

function stripPrefix(line: string, prefix: string): string {
  return prefix && line.startsWith(prefix) ? line.slice(prefix.length) : line;
}

function fencedLines(lines: string[]): boolean[] {
  const fenced = new Array<boolean>(lines.length).fill(false);
  let fence: { char: string; length: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[i]);
    if (!fence) {
      if (match) {
        fence = { char: match[1][0], length: match[1].length };
        fenced[i] = true;
      }
      continue;
    }
    fenced[i] = true;
    if (match && match[1][0] === fence.char && match[1].length >= fence.length) {
      fence = null;
    }
  }
  return fenced;
}

export function parseTableAt(lines: string[], startLine: number): MarkdownTable | null {
  if (startLine < 0 || startLine + 1 >= lines.length) return null;
  const prefix = linePrefix(lines[startLine]);
  const headerLine = stripPrefix(lines[startLine], prefix);
  if (!headerLine.trim() || !hasUnescapedPipe(headerLine)) return null;
  if (!isSeparatorLine(stripPrefix(lines[startLine + 1], prefix))) return null;

  const header = parseRow(headerLine);
  const separator = parseRow(stripPrefix(lines[startLine + 1], prefix));
  if (separator.cells.length === 0) return null;

  let endLine = startLine + 1;
  while (endLine + 1 < lines.length) {
    const next = stripPrefix(lines[endLine + 1], prefix);
    if (!next.trim()) break;
    if (!hasUnescapedPipe(next)) break;
    // A separator row cannot be table body content; it starts the next table.
    if (isSeparatorLine(next)) break;
    endLine++;
  }

  const body: Array<{ cells: TableCell[]; lineNumber: number }> = [];
  for (let line = startLine + 2; line <= endLine; line++) {
    body.push({ cells: parseRow(stripPrefix(lines[line], prefix)).cells, lineNumber: line });
  }

  const columns = Math.max(
    1,
    header.cells.length,
    separator.cells.length,
    ...body.map((row) => row.cells.length)
  );
  const aligns: TableAlign[] = [];
  for (let i = 0; i < columns; i++) {
    aligns.push(separator.cells[i] ? separatorToAlign(separator.spans[i]?.raw ?? "") : "default");
  }

  return {
    startLine,
    endLine,
    lineNumbers: [startLine, ...body.map((row) => row.lineNumber)],
    rows: [padCells(header.cells, columns), ...body.map((row) => padCells(row.cells, columns))],
    aligns,
    columns,
    prefix,
  };
}

export function findTables(lines: string[], fromLine = 0, toLine = lines.length - 1): MarkdownTable[] {
  const fenced = fencedLines(lines);
  const tables: MarkdownTable[] = [];
  const start = Math.max(0, fromLine);
  const end = Math.min(lines.length - 1, toLine);
  for (let line = start; line <= end; line++) {
    if (fenced[line] || fenced[line + 1]) continue;
    const table = parseTableAt(lines, line);
    if (!table) continue;
    tables.push(table);
    line = table.endLine;
  }
  return tables;
}

export function findTable(lines: string[], hintLine: number): MarkdownTable | null {
  const tables = findTables(lines);
  for (const table of tables) {
    if (hintLine >= table.startLine && hintLine <= table.endLine) return table;
  }
  return tables.find((table) => table.endLine === hintLine || table.startLine === hintLine) ?? null;
}

export function hasMarkers(table: MarkdownTable): boolean {
  return table.rows.some((row) => row.some(cellIsMarker));
}

/** Render a table back to Markdown, reusing unchanged source lines. */
export function serializeTable(
  table: MarkdownTable,
  rows: TableCell[][],
  lines: string[]
): { fromLine: number; toLine: number; text: string } | null {
  if (rows.length !== table.rows.length) return null;
  const rendered: string[] = [];
  let changed = false;
  for (let index = 0; index < rows.length; index++) {
    const original = table.rows[index];
    const next = padCells(rows[index], table.columns);
    const lineNumber = table.lineNumbers[index];
    const sourceLine = lines[lineNumber] ?? "";
    if (sameRow(original, next)) {
      rendered.push(sourceLine || standardRow(original));
    } else {
      const bodyLine = stripPrefix(sourceLine, table.prefix);
      rendered.push(table.prefix + serializeRow(bodyLine, original, next, table.columns));
      changed = true;
    }
  }
  const separator = lines[table.startLine + 1] ?? standardRow(
    table.aligns.map((align) => ({ text: alignToSeparator(align), marker: null }))
  );
  const text = [rendered[0] ?? "", separator, ...rendered.slice(1)].join("\n");
  return changed ? { fromLine: table.startLine, toLine: table.endLine, text } : null;
}

/* -------------------------------------------------------------------------- */
/* Merge layout                                                               */
/* -------------------------------------------------------------------------- */

function rectOf(group: MergeGroup): TableRect {
  return {
    r1: group.r,
    c1: group.c,
    r2: group.r + group.rowSpan - 1,
    c2: group.c + group.colSpan - 1,
  };
}

function rectsIntersect(a: TableRect, b: TableRect): boolean {
  return !(a.r2 < b.r1 || a.r1 > b.r2 || a.c2 < b.c1 || a.c1 > b.c2);
}

export function normalizeRect(rect: TableRect, rows: number, columns: number): TableRect {
  return {
    r1: Math.max(0, Math.min(rows - 1, Math.min(rect.r1, rect.r2))),
    r2: Math.max(0, Math.min(rows - 1, Math.max(rect.r1, rect.r2))),
    c1: Math.max(0, Math.min(columns - 1, Math.min(rect.c1, rect.c2))),
    c2: Math.max(0, Math.min(columns - 1, Math.max(rect.c1, rect.c2))),
  };
}

export function resolveLayout(table: MarkdownTable): TableLayout {
  const rowCount = table.rows.length;
  const columns = table.columns;
  const warnings: string[] = [];
  const parent: number[] = Array.from({ length: rowCount * columns }, (_, index) => index);
  const find = (value: number): number => {
    let root = value;
    while (parent[root] !== root) {
      parent[root] = parent[parent[root]];
      root = parent[root];
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };
  const indexOf = (r: number, c: number): number => r * columns + c;
  const active: boolean[][] = Array.from({ length: rowCount }, () =>
    new Array<boolean>(columns).fill(false)
  );

  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < columns; c++) {
      const cell = table.rows[r]?.[c];
      if (!cell || !cellIsMarker(cell)) continue;
      const directions = markerDirections(cell);
      let valid = false;
      if (directions.left) {
        if (c > 0) {
          union(indexOf(r, c), indexOf(r, c - 1));
          valid = true;
        } else {
          warnings.push(`Cell ${r + 1}:${c + 1} cannot merge left.`);
        }
      }
      if (directions.up) {
        if (r > 0) {
          union(indexOf(r, c), indexOf(r - 1, c));
          valid = true;
        } else {
          warnings.push(`Cell ${r + 1}:${c + 1} cannot merge up.`);
        }
      }
      if (directions.right) {
        if (c < columns - 1) {
          union(indexOf(r, c), indexOf(r, c + 1));
          valid = true;
        } else {
          warnings.push(`Cell ${r + 1}:${c + 1} cannot merge right.`);
        }
      }
      active[r][c] = valid;
    }
  }

  const components = new Map<number, Array<{ r: number; c: number }>>();
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < columns; c++) {
      const root = find(indexOf(r, c));
      const list = components.get(root) ?? [];
      list.push({ r, c });
      components.set(root, list);
    }
  }

  const byCell: Array<Array<MergeGroup | null>> = Array.from({ length: rowCount }, () =>
    new Array<MergeGroup | null>(columns).fill(null)
  );
  const groups: MergeGroup[] = [];

  for (const cells of components.values()) {
    if (cells.length <= 1) continue;
    const content = cells.filter(({ r, c }) => !active[r][c]);
    if (content.length !== 1) {
      const first = cells[0];
      warnings.push(
        `Merge group at ${first.r + 1}:${first.c + 1} must contain exactly one content cell.`
      );
      continue;
    }
    let r1 = Infinity;
    let c1 = Infinity;
    let r2 = -Infinity;
    let c2 = -Infinity;
    for (const { r, c } of cells) {
      r1 = Math.min(r1, r);
      c1 = Math.min(c1, c);
      r2 = Math.max(r2, r);
      c2 = Math.max(c2, c);
    }
    const area = (r2 - r1 + 1) * (c2 - c1 + 1);
    if (area !== cells.length) {
      warnings.push(
        `Merge group at ${r1 + 1}:${c1 + 1} is not a rectangle; leaving its markers visible.`
      );
      continue;
    }
    if (r1 === 0 && r2 > 0) {
      warnings.push(
        `Merge group at ${r1 + 1}:${c1 + 1} crosses the header row; leaving its markers visible.`
      );
      continue;
    }
    const anchor = content[0];
    const group: MergeGroup = {
      r: r1,
      c: c1,
      rowSpan: r2 - r1 + 1,
      colSpan: c2 - c1 + 1,
      text: table.rows[anchor.r][anchor.c]?.text ?? "",
      contentR: anchor.r,
      contentC: anchor.c,
    };
    groups.push(group);
    for (const { r, c } of cells) byCell[r][c] = group;
  }

  groups.sort((a, b) => a.r - b.r || a.c - b.c);
  return { rows: rowCount, columns, groups, byCell, warnings };
}

export function hasMerges(layout: TableLayout): boolean {
  return layout.groups.length > 0;
}

function groupRectAt(layout: TableLayout, r: number, c: number): TableRect | null {
  const group = layout.byCell[r]?.[c];
  if (!group) return null;
  return rectOf(group);
}

export function expandRect(table: MarkdownTable, layout: TableLayout, rect: TableRect): TableRect {
  let out = normalizeRect(rect, table.rows.length, table.columns);
  for (let guard = 0; guard < 64; guard++) {
    let changed = false;
    for (const group of layout.groups) {
      const target = rectOf(group);
      if (!rectsIntersect(out, target)) continue;
      const next: TableRect = {
        r1: Math.min(out.r1, target.r1),
        c1: Math.min(out.c1, target.c1),
        r2: Math.max(out.r2, target.r2),
        c2: Math.max(out.c2, target.c2),
      };
      if (
        next.r1 !== out.r1 ||
        next.c1 !== out.c1 ||
        next.r2 !== out.r2 ||
        next.c2 !== out.c2
      ) {
        out = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Editing operations                                                         */
/* -------------------------------------------------------------------------- */

export function mergeSelection(
  table: MarkdownTable,
  rect: TableRect
): TableEditResult {
  const layout = resolveLayout(table);
  const range = expandRect(table, layout, rect);
  if ((range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1) < 2) {
    return { ok: false, reason: "Select at least two cells to merge." };
  }
  if (range.r1 === 0 && range.r2 > 0) {
    return { ok: false, reason: "A merged cell cannot cross the header row." };
  }

  const seen = new Set<string>();
  const parts: string[] = [];
  for (let r = range.r1; r <= range.r2; r++) {
    for (let c = range.c1; c <= range.c2; c++) {
      const group = layout.byCell[r]?.[c];
      if (group) {
        if (seen.has(`${group.r}:${group.c}`)) continue;
        seen.add(`${group.r}:${group.c}`);
        const text = (table.rows[group.contentR]?.[group.contentC]?.text ?? "").trim();
        if (text) parts.push(text);
      } else {
        const text = (table.rows[r]?.[c]?.text ?? "").trim();
        if (text) parts.push(text);
      }
    }
  }

  const rows = cloneRows(table.rows);
  for (let r = range.r1; r <= range.r2; r++) {
    for (let c = range.c1; c <= range.c2; c++) {
      if (r === range.r1 && c === range.c1) {
        rows[r][c] = { text: parts.join(" "), marker: null };
      } else if (c > range.c1) {
        rows[r][c] = { text: "", marker: "<" };
      } else {
        rows[r][c] = { text: "", marker: "^" };
      }
    }
  }
  return { ok: true, rows, rect: range };
}

export function splitCellAt(
  table: MarkdownTable,
  r: number,
  c: number
): TableEditResult {
  const layout = resolveLayout(table);
  const group = layout.byCell[r]?.[c];
  if (!group || (group.rowSpan === 1 && group.colSpan === 1)) {
    return { ok: false, reason: "This cell is not merged." };
  }
  const rect = rectOf(group);
  const rows = cloneRows(table.rows);
  // Canonicalize a right-marker group as we split it: the text belongs in the
  // top-left cell, and every other cell in the group becomes empty.
  rows[group.r][group.c] = { text: group.text, marker: null };
  for (let row = rect.r1; row <= rect.r2; row++) {
    for (let col = rect.c1; col <= rect.c2; col++) {
      if (row === group.r && col === group.c) continue;
      rows[row][col] = { text: "", marker: null };
    }
  }
  return { ok: true, rows, rect };
}

export function neighboringRect(
  table: MarkdownTable,
  r: number,
  c: number,
  direction: MergeDirection
): TableRect | null {
  const target = { r, c };
  if (direction === "left") target.c -= 1;
  else if (direction === "right") target.c += 1;
  else if (direction === "up") target.r -= 1;
  else target.r += 1;
  if (
    target.r < 0 ||
    target.c < 0 ||
    target.r >= table.rows.length ||
    target.c >= table.columns
  ) {
    return null;
  }
  return {
    r1: Math.min(r, target.r),
    c1: Math.min(c, target.c),
    r2: Math.max(r, target.r),
    c2: Math.max(c, target.c),
  };
}

export function mergeDirectionally(
  table: MarkdownTable,
  r: number,
  c: number,
  direction: MergeDirection
): TableEditResult {
  const rect = neighboringRect(table, r, c, direction);
  if (!rect) return { ok: false, reason: `There is no cell to the ${direction}.` };
  return mergeSelection(table, rect);
}

/**
 * Rewrite `>` markers into the canonical `<` form so the content always sits in
 * the top-left cell of its merge group. HTML colspan can only grow rightwards,
 * so this keeps the rendered table and the source in agreement.
 */
export function normalizeRightMarkers(table: MarkdownTable): TableCell[][] | null {
  const layout = resolveLayout(table);
  const rows = cloneRows(table.rows);
  let changed = false;
  for (const group of layout.groups) {
    if (group.contentR === group.r && group.contentC === group.c) continue;
    const content = table.rows[group.contentR]?.[group.contentC];
    if (!content) continue;
    rows[group.r][group.c] = { text: content.text, marker: null };
    const marker = group.contentC > group.c ? "<" : "^";
    rows[group.contentR][group.contentC] = { text: "", marker };
    changed = true;
  }
  return changed ? rows : null;
}

/* -------------------------------------------------------------------------- */
/* Selection helpers                                                          */
/* -------------------------------------------------------------------------- */

export function rowForLine(table: MarkdownTable, line: number): number | null {
  if (line < table.startLine || line > table.endLine) return null;
  if (line <= table.startLine + 1) return 0;
  return line - table.startLine - 1;
}

export function cellIndexForColumn(table: MarkdownTable, line: string, ch: number): number {
  const bodyLine = stripPrefix(line, table.prefix);
  const offset = line.length - bodyLine.length;
  const position = Math.max(0, ch - offset);
  const spans = splitRowSpans(bodyLine);
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (position <= span.start) return i;
    if (position < span.end) return i;
  }
  return Math.max(0, Math.min(table.columns - 1, spans.length - 1));
}

export function rectFromEditorSelection(
  table: MarkdownTable,
  lines: string[],
  from: EditorPosition,
  to: EditorPosition
): TableRect | null {
  const startRow = rowForLine(table, from.line);
  let endRow = rowForLine(table, to.line);
  if (startRow === null || endRow === null) return null;
  if (to.line !== from.line && to.ch === 0) endRow = Math.max(startRow, endRow - 1);
  const startLine = lines[from.line] ?? "";
  const endLine = lines[to.line] ?? "";
  const startColumn = cellIndexForColumn(table, startLine, from.ch);
  const endColumn = cellIndexForColumn(table, endLine, to.ch);
  return normalizeRect(
    { r1: startRow, c1: startColumn, r2: endRow, c2: endColumn },
    table.rows.length,
    table.columns
  );
}

export function rectFromCell(table: MarkdownTable, r: number, c: number): TableRect {
  return normalizeRect({ r1: r, c1: c, r2: r, c2: c }, table.rows.length, table.columns);
}

/* -------------------------------------------------------------------------- */
/* DOM fallback                                                               */
/* -------------------------------------------------------------------------- */

export interface DomTableRow {
  cells: string[];
}

/** Build a table model from already-rendered Reading-view markup. */
export function tableFromDomRows(domRows: DomTableRow[]): MarkdownTable | null {
  if (domRows.length === 0) return null;
  const columns = Math.max(1, ...domRows.map((row) => row.cells.length));
  const rows = domRows.map((row) => {
    const cells = row.cells.map((text) => {
      const value = text.trim();
      return {
        text: value,
        marker: /^[<>^]+$/.test(value) ? value : null,
      };
    });
    while (cells.length < columns) cells.push({ text: "", marker: null });
    return cells.slice(0, columns);
  });
  return {
    startLine: 0,
    endLine: rows.length - 1,
    lineNumbers: rows.map((_, index) => index),
    rows,
    aligns: new Array<TableAlign>(columns).fill("default"),
    columns,
    prefix: "",
  };
}
