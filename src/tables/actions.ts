import { Notice, type Editor, type Menu } from "obsidian";
import {
  cellIndexForColumn,
  findTable,
  mergeSelection,
  resolveLayout,
  rowForLine,
  serializeTable,
  splitCellAt,
  type MarkdownTable,
  type TableCell,
  type TableRect,
} from "./model";

interface CursorTable {
  table: MarkdownTable;
  lines: string[];
  row: number;
  column: number;
}

function tableAtCursor(editor: Editor): CursorTable | null {
  const lines = editor.getValue().replace(/\r\n?/g, "\n").split("\n");
  const cursor = editor.getCursor();
  const table = findTable(lines, cursor.line);
  if (!table) return null;
  const row = rowForLine(table, cursor.line);
  if (row === null) return null;
  const column = cellIndexForColumn(table, lines[cursor.line] ?? "", cursor.ch);
  return { table, lines, row, column };
}

function replaceTable(
  editor: Editor,
  table: MarkdownTable,
  lines: string[],
  rows: TableCell[][]
): boolean {
  const serialized = serializeTable(table, rows, lines);
  if (!serialized) return false;
  const last = lines[serialized.toLine] ?? "";
  editor.replaceRange(
    serialized.text,
    { line: serialized.fromLine, ch: 0 },
    { line: serialized.toLine, ch: last.length }
  );
  return true;
}

function cursorLineForRow(table: MarkdownTable, row: number): number {
  return table.startLine + (row === 0 ? 0 : row + 1);
}

export function hasTableAtCursor(editor: Editor): boolean {
  return tableAtCursor(editor) !== null;
}

export function mergeTableCells(editor: Editor): boolean {
  const lines = editor.getValue().replace(/\r\n?/g, "\n").split("\n");
  const from = editor.getCursor("from");
  const to = editor.getCursor("to");
  const table = findTable(lines, from.line) ?? findTable(lines, to.line);
  if (!table) {
    new Notice("Put the cursor in a Markdown table first.");
    return false;
  }
  if (from.line < table.startLine || to.line > table.endLine) {
    new Notice("The selection must stay inside one Markdown table.");
    return false;
  }
  const startRow = rowForLine(table, from.line);
  let endRow = rowForLine(table, to.line);
  if (startRow === null || endRow === null) return false;
  if (to.line !== from.line && to.ch === 0) endRow = Math.max(startRow, endRow - 1);
  const rect: TableRect = {
    r1: startRow,
    c1: cellIndexForColumn(table, lines[from.line] ?? "", from.ch),
    r2: endRow,
    c2: cellIndexForColumn(table, lines[to.line] ?? "", to.ch),
  };
  const result = mergeSelection(table, rect);
  if (!result.ok) {
    new Notice(result.reason);
    return true;
  }
  if (!replaceTable(editor, table, lines, result.rows)) return true;
  editor.setCursor({ line: cursorLineForRow(table, result.rect.r1), ch: 0 });
  return true;
}

export function splitTableCell(editor: Editor): boolean {
  const current = tableAtCursor(editor);
  if (!current) {
    new Notice("Put the cursor in a Markdown table first.");
    return false;
  }
  const result = splitCellAt(current.table, current.row, current.column);
  if (!result.ok) {
    new Notice(result.reason);
    return true;
  }
  if (!replaceTable(editor, current.table, current.lines, result.rows)) return true;
  editor.setCursor({ line: cursorLineForRow(current.table, current.row), ch: 0 });
  return true;
}

export function insertTable(editor: Editor): void {
  const template = [
    "| Column 1 | Column 2 | Column 3 |",
    "| --- | --- | --- |",
    "|  |  |  |",
    "|  |  |  |",
  ].join("\n");
  const cursor = editor.getCursor();
  const line = editor.getLine(cursor.line) ?? "";
  const before = line.trim() ? "\n\n" : "";
  editor.replaceSelection(`${before}${template}\n`);
  editor.focus();
}

export function addTableMenuItems(menu: Menu, editor: Editor): boolean {
  const current = tableAtCursor(editor);
  if (!current) return false;
  const { table, lines } = current;
  const selection = editor.getCursor("from");
  const selectionEnd = editor.getCursor("to");
  const fromRow = rowForLine(table, selection.line);
  const toRow = rowForLine(table, selectionEnd.line);
  const fromColumn = cellIndexForColumn(table, lines[selection.line] ?? "", selection.ch);
  const toColumn = cellIndexForColumn(table, lines[selectionEnd.line] ?? "", selectionEnd.ch);
  const multiCell = fromRow !== toRow || fromColumn !== toColumn;
  const layout = resolveLayout(table);
  const group = layout.byCell[current.row]?.[current.column];
  const canSplit = Boolean(group && (group.rowSpan > 1 || group.colSpan > 1));

  menu.addItem((item) =>
    item
      .setTitle("Merge cells")
      .setIcon("merge")
      .setDisabled(!multiCell)
      .onClick(() => mergeTableCells(editor))
  );
  menu.addItem((item) =>
    item
      .setTitle("Split cells")
      .setIcon("scissors")
      .setDisabled(!canSplit)
      .onClick(() => splitTableCell(editor))
  );

  return true;
}
