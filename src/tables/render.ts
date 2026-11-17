import {
  type MarkdownTable,
  type MergeGroup,
  type TableLayout,
  type TableRect,
  type TableCell,
} from "./model";

/** All <th>/<td> elements in visual row/column order (covered cells included). */
export function tableCells(table: HTMLTableElement): HTMLTableCellElement[][] {
  return Array.from(table.rows).map((row) => Array.from(row.cells));
}

export function domRowTexts(table: HTMLTableElement): string[][] {
  return tableCells(table).map((row) =>
    row.map((cell) => (cell.textContent ?? "").replace(/\u200b/g, "").trim())
  );
}

export interface ApplyOptions {
  /**
   * Reading view is static, so content can be moved when a `>` marker puts the
   * text to the right of its anchor. Live Preview must keep each cell's text in
   * place, so it normalizes the source instead and leaves these groups alone.
   */
  moveContent?: boolean;
}

export function resetTableLayout(table: HTMLTableElement): void {
  table.classList.remove("langscape-merged-table", "langscape-table-selecting");
  table.removeAttribute("data-langscape-table");
  table.removeAttribute("data-langscape-signature");
  for (const cell of table.querySelectorAll<HTMLTableCellElement>("th, td")) {
    cell.removeAttribute("rowspan");
    cell.removeAttribute("colspan");
    cell.removeAttribute("aria-hidden");
    cell.removeAttribute("data-langscape-covered");
    cell.classList.remove(
      "langscape-table-anchor",
      "langscape-table-covered",
      "langscape-table-selected"
    );
    cell.removeAttribute("aria-selected");
  }
}

function moveCellContent(from: HTMLTableCellElement, to: HTMLTableCellElement): void {
  while (from.firstChild) to.appendChild(from.firstChild);
}

function groupRect(group: MergeGroup): TableRect {
  return {
    r1: group.r,
    c1: group.c,
    r2: group.r + group.rowSpan - 1,
    c2: group.c + group.colSpan - 1,
  };
}

/**
 * Apply a merged-cell layout to an already-rendered HTML table. All source
 * cells stay in the DOM (hidden instead of removed) so Obsidian's Live Preview
 * table editor can keep its cell -> source mapping intact.
 */
export function applyTableLayout(
  tableEl: HTMLTableElement,
  table: MarkdownTable,
  layout: TableLayout,
  options: ApplyOptions = {}
): number {
  resetTableLayout(tableEl);
  const cells = tableCells(tableEl);
  if (cells.length < table.rows.length) return 0;

  let applied = 0;
  for (let r = 0; r < table.rows.length; r++) {
    for (let c = 0; c < table.columns; c++) {
      const cell = cells[r]?.[c];
      if (!cell) continue;
      cell.dataset.langscapeR = String(r);
      cell.dataset.langscapeC = String(c);
    }
  }

  for (const group of layout.groups) {
    const anchor = cells[group.r]?.[group.c];
    const content = cells[group.contentR]?.[group.contentC];
    if (!anchor || !content) continue;

    if (group.contentR !== group.r || group.contentC !== group.c) {
      if (!options.moveContent) continue;
      anchor.replaceChildren();
      moveCellContent(content, anchor);
    }

    if (group.rowSpan > 1) anchor.rowSpan = group.rowSpan;
    if (group.colSpan > 1) anchor.colSpan = group.colSpan;
    anchor.classList.add("langscape-table-anchor");
    for (let r = group.r; r < group.r + group.rowSpan; r++) {
      for (let c = group.c; c < group.c + group.colSpan; c++) {
        if (r === group.r && c === group.c) continue;
        const covered = cells[r]?.[c];
        if (!covered) continue;
        covered.classList.add("langscape-table-covered");
        covered.setAttribute("aria-hidden", "true");
        covered.dataset.langscapeCovered = "true";
      }
    }
    applied++;
  }

  if (applied > 0) {
    tableEl.classList.add("langscape-merged-table");
    tableEl.dataset.langscapeTable = "true";
  }
  return applied;
}

export function paintSelection(
  tableEl: HTMLTableElement,
  layout: TableLayout,
  rect: TableRect | null
): void {
  const cells = tableCells(tableEl);
  for (let r = 0; r < cells.length; r++) {
    for (let c = 0; c < (cells[r]?.length ?? 0); c++) {
      const cell = cells[r][c];
      let selected = false;
      if (rect) {
        const group = layout.byCell[r]?.[c];
        const target = group ? groupRect(group) : { r1: r, c1: c, r2: r, c2: c };
        selected = !(
          target.r2 < rect.r1 ||
          target.r1 > rect.r2 ||
          target.c2 < rect.c1 ||
          target.c1 > rect.c2
        );
      }
      cell.classList.toggle("langscape-table-selected", selected);
      if (selected) cell.setAttribute("aria-selected", "true");
      else cell.removeAttribute("aria-selected");
    }
  }
}

export function clearSelection(tableEl: HTMLTableElement): void {
  for (const cell of tableEl.querySelectorAll<HTMLTableCellElement>("th, td")) {
    cell.classList.remove("langscape-table-selected");
    cell.removeAttribute("aria-selected");
  }
}

export function cellAt(tableEl: HTMLTableElement, r: number, c: number): HTMLTableCellElement | null {
  return (
    tableEl.querySelector<HTMLTableCellElement>(
      `[data-langscape-r="${r}"][data-langscape-c="${c}"]`
    ) ?? null
  );
}

export function isCoveredCell(cell: HTMLElement): boolean {
  return cell.classList.contains("langscape-table-covered");
}

export function cellEditable(cell: HTMLTableCellElement): HTMLElement {
  return (
    cell.querySelector<HTMLElement>('[contenteditable="true"]') ??
    cell.querySelector<HTMLElement>(".table-cell-wrapper") ??
    cell
  );
}

export function cellText(cell: HTMLTableCellElement): string {
  return (cell.textContent ?? "").replace(/\u200b/g, "").replace(/\u00a0/g, " ").trim();
}

export function cellIsEmpty(cell: HTMLTableCellElement): boolean {
  return cellText(cell) === "";
}

/** Read a table model from rendered markup when source text is unavailable. */
export function tableFromDom(tableEl: HTMLTableElement): { rows: TableCell[][] } | null {
  const rows = domRowTexts(tableEl);
  if (rows.length === 0) return null;
  const columns = Math.max(1, ...rows.map((row) => row.length));
  return {
    rows: rows.map((row) => {
      const cells = row.map((text) => ({
        text,
        marker: /^[<>^]+$/.test(text) ? text : null,
      }));
      while (cells.length < columns) cells.push({ text: "", marker: null });
      return cells;
    }),
  };
}
