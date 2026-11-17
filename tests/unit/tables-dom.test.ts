// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseTableAt, resolveLayout } from "../../src/tables/model";
import {
  applyTableLayout,
  cellAt,
  cellIsEmpty,
  domRowTexts,
  paintSelection,
  resetTableLayout,
  tableCells,
} from "../../src/tables/render";

function renderDom(rows: string[][]): HTMLTableElement {
  const table = document.createElement("table");
  const thead = table.createTHead();
  const head = thead.insertRow();
  for (const text of rows[0]) {
    const cell = document.createElement("th");
    cell.textContent = text;
    head.appendChild(cell);
  }
  const tbody = table.createTBody();
  for (const row of rows.slice(1)) {
    const tr = tbody.insertRow();
    for (const text of row) {
      const cell = document.createElement("td");
      cell.textContent = text;
      tr.appendChild(cell);
    }
  }
  document.body.appendChild(table);
  return table;
}

const source = [
  "| A | B |",
  "| --- | --- |",
  "| a | < |",
  "| ^ | < |",
];

describe("merged table DOM rendering", () => {
  it("sets spans and hides covered cells without removing them", () => {
    const tableEl = renderDom([
      ["A", "B"],
      ["a", "<"],
      ["^", "<"],
    ]);
    const table = parseTableAt(source, 0)!;
    const layout = resolveLayout(table);
    const applied = applyTableLayout(tableEl, table, layout);
    expect(applied).toBe(1);
    expect(tableEl.classList.contains("langscape-merged-table")).toBe(true);
    expect(tableEl.rows[1].cells[0].rowSpan).toBe(2);
    expect(tableEl.rows[1].cells[0].colSpan).toBe(2);
    expect(tableEl.rows[1].cells[1].classList.contains("langscape-table-covered")).toBe(true);
    expect(tableEl.rows[2].cells[0].classList.contains("langscape-table-covered")).toBe(true);
    expect(tableEl.rows[2].cells[1].classList.contains("langscape-table-covered")).toBe(true);
    // All four logical cells still exist for Obsidian's source mapping.
    expect(tableCells(tableEl).map((row) => row.length)).toEqual([2, 2, 2]);
    expect(domRowTexts(tableEl)).toEqual([
      ["A", "B"],
      ["a", "<"],
      ["^", "<"],
    ]);
    expect(cellAt(tableEl, 2, 1)?.textContent).toBe("<");
    expect(cellIsEmpty(cellAt(tableEl, 1, 0)!)).toBe(false);
    tableEl.remove();
  });

  it("resets everything it added", () => {
    const tableEl = renderDom([
      ["A", "B"],
      ["a", "<"],
      ["^", "<"],
    ]);
    const table = parseTableAt(source, 0)!;
    applyTableLayout(tableEl, table, resolveLayout(table));
    resetTableLayout(tableEl);
    expect(tableEl.classList.contains("langscape-merged-table")).toBe(false);
    expect(tableEl.rows[1].cells[0].hasAttribute("rowspan")).toBe(false);
    expect(tableEl.rows[1].cells[0].hasAttribute("colspan")).toBe(false);
    expect(tableEl.querySelectorAll(".langscape-table-covered")).toHaveLength(0);
    tableEl.remove();
  });

  it("highlights the selected cells", () => {
    const tableEl = renderDom([
      ["A", "B", "C"],
      ["a", "b", "c"],
    ]);
    const table = parseTableAt(["| A | B | C |", "| --- | --- | --- |", "| a | b | c |"], 0)!;
    const layout = resolveLayout(table);
    applyTableLayout(tableEl, table, layout);
    paintSelection(tableEl, layout, { r1: 1, c1: 0, r2: 1, c2: 1 });
    expect(tableEl.rows[1].cells[0].classList.contains("langscape-table-selected")).toBe(true);
    expect(tableEl.rows[1].cells[1].classList.contains("langscape-table-selected")).toBe(true);
    expect(tableEl.rows[1].cells[2].classList.contains("langscape-table-selected")).toBe(false);
    tableEl.remove();
  });

  it("moves right-marker content into its anchor in static views", () => {
    const tableEl = renderDom([
      ["A", "B", "C"],
      ["a", ">", "c"],
    ]);
    const table = parseTableAt(
      ["| A | B | C |", "| --- | --- | --- |", "| a | > | c |"],
      0
    )!;
    const layout = resolveLayout(table);
    expect(layout.groups).toHaveLength(1);
    expect(layout.groups[0]).toMatchObject({ r: 1, c: 1, colSpan: 2, text: "c" });
    applyTableLayout(tableEl, table, layout, { moveContent: true });
    expect(tableEl.rows[1].cells[1].textContent).toBe("c");
    expect(tableEl.rows[1].cells[1].colSpan).toBe(2);
    expect(tableEl.rows[1].cells[2].classList.contains("langscape-table-covered")).toBe(true);
    tableEl.remove();
  });

  it("does not merge when the source escapes the marker", () => {
    const tableEl = renderDom([
      ["A", "B"],
      ["a", "<"],
    ]);
    const table = parseTableAt(["| A | B |", "| --- | --- |", "| a | \\< |"], 0)!;
    const layout = resolveLayout(table);
    expect(layout.groups).toHaveLength(0);
    applyTableLayout(tableEl, table, layout);
    expect(tableEl.classList.contains("langscape-merged-table")).toBe(false);
    expect(tableEl.rows[1].cells[0].hasAttribute("colspan")).toBe(false);
    tableEl.remove();
  });
});
