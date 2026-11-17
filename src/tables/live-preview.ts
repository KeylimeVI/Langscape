import { Menu, Notice, type App } from "obsidian";
import { Transaction, type Extension, type Text } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { FontManager } from "../fonts/manager";
import { decorateFontSpans } from "../fonts/render";
import {
  expandRect,
  findTables,
  hasMarkers,
  mergeDirectionally,
  mergeSelection,
  neighboringRect,
  normalizeRect,
  normalizeRightMarkers,
  parseTableAt,
  plainCellText,
  rectFromCell,
  resolveLayout,
  serializeTable,
  splitCellAt,
  type MarkdownTable,
  type MergeDirection,
  type TableCell,
  type TableRect,
} from "./model";
import {
  applyTableLayout,
  cellAt,
  cellEditable,
  cellIsEmpty,
  clearSelection,
  domRowTexts,
  isCoveredCell,
  paintSelection,
  resetTableLayout,
} from "./render";

interface TableMeta {
  table: MarkdownTable;
  startLine: number;
}

interface SelectionState {
  anchorR: number;
  anchorC: number;
  focusR: number;
  focusC: number;
}

interface PendingFocus {
  startLine: number;
  r: number;
  c: number;
  expires: number;
}

function selectionRect(selection: SelectionState, table: MarkdownTable): TableRect {
  return normalizeRect(
    {
      r1: selection.anchorR,
      c1: selection.anchorC,
      r2: selection.focusR,
      c2: selection.focusC,
    },
    table.rows.length,
    table.columns
  );
}

function sameShape(table: MarkdownTable, domRows: string[][]): boolean {
  if (table.rows.length !== domRows.length) return false;
  for (let r = 0; r < domRows.length; r++) {
    if (table.rows[r].length !== domRows[r].length) return false;
    for (let c = 0; c < domRows[r].length; c++) {
      if (plainCellText(table.rows[r][c].text) !== plainCellText(domRows[r][c])) return false;
    }
  }
  return true;
}

function looseShape(table: MarkdownTable, domRows: string[][]): boolean {
  if (table.rows.length !== domRows.length) return false;
  for (let r = 0; r < domRows.length; r++) {
    if (table.rows[r].length !== domRows[r].length) return false;
  }
  return true;
}

function layoutMatchesDom(tableEl: HTMLTableElement, layout: ReturnType<typeof resolveLayout>): boolean {
  if (!cellAt(tableEl, 0, 0)) return false;
  const applied = layout.groups.filter(
    (group) => group.contentR === group.r && group.contentC === group.c
  );
  if (applied.length === 0) return true;
  if (!tableEl.classList.contains("langscape-merged-table")) return false;
  for (const group of applied) {
    const anchor = cellAt(tableEl, group.r, group.c);
    if (!anchor) return false;
    if (group.rowSpan > 1 && anchor.rowSpan !== group.rowSpan) return false;
    if (group.colSpan > 1 && anchor.colSpan !== group.colSpan) return false;
    for (let r = group.r; r < group.r + group.rowSpan; r++) {
      for (let c = group.c; c < group.c + group.colSpan; c++) {
        if (r === group.r && c === group.c) continue;
        if (!cellAt(tableEl, r, c)?.classList.contains("langscape-table-covered")) return false;
      }
    }
  }
  return true;
}

function hasRightMarker(table: MarkdownTable): boolean {
  return table.rows.some((row) => row.some((cell) => cell.marker?.includes(">") ?? false));
}

interface PendingTableMenu {
  at: number;
  build: (menu: Menu) => void;
}

let pendingTableMenu: PendingTableMenu | null = null;

/**
 * Obsidian renders table cells with its own menu and does not fire
 * `editor-menu` for them. Append Langscape's items to that native menu so
 * copy/paste and the rest of Obsidian's actions stay available.
 */
export function installTableMenuPatch(): () => void {
  const originalMouse = Menu.prototype.showAtMouseEvent;
  const originalPosition = Menu.prototype.showAtPosition;

  const consume = (menu: Menu): void => {
    const pending = pendingTableMenu;
    pendingTableMenu = null;
    if (!pending || Date.now() - pending.at >= 1500) return;
    try {
      pending.build(menu);
    } catch (error) {
      console.error("[langscape] table menu failed", error);
    }
  };

  Menu.prototype.showAtMouseEvent = function (this: Menu, event: MouseEvent): Menu {
    consume(this);
    return originalMouse.call(this, event);
  };
  Menu.prototype.showAtPosition = function (
    this: Menu,
    position: Parameters<Menu["showAtPosition"]>[0],
    doc?: Document
  ): Menu {
    consume(this);
    return originalPosition.call(this, position, doc);
  };

  return () => {
    Menu.prototype.showAtMouseEvent = originalMouse;
    Menu.prototype.showAtPosition = originalPosition;
  };
}

function groupSpanAt(table: MarkdownTable, r: number, c: number): number {
  const layout = resolveLayout(table);
  const group = layout.byCell[r]?.[c];
  return group ? group.rowSpan * group.colSpan : 1;
}

/**
 * Live Preview / source-mode table decoration.
 *
 * Obsidian's table widget keeps one DOM cell per Markdown cell and maps each
 * cell to a source position. Covered cells are therefore hidden rather than
 * removed, which keeps cell editing and source mapping intact.
 */
export function createMergedTableExtension(app: App, fontManager?: FontManager): Extension {
  return ViewPlugin.fromClass(
    class {
      private readonly controller: MergedTableController;

      constructor(view: EditorView) {
        this.controller = new MergedTableController(app, view, fontManager);
      }

      update(update: ViewUpdate): void {
        this.controller.update(update);
      }

      destroy(): void {
        this.controller.destroy();
      }
    }
  );
}

export class MergedTableController {
  private readonly metas = new WeakMap<HTMLTableElement, TableMeta>();
  private readonly selections = new WeakMap<HTMLTableElement, SelectionState>();
  private readonly selectionByLine = new Map<number, { state: SelectionState; at: number }>();
  private readonly bound = new WeakSet<HTMLTableElement>();
  private readonly known = new Set<HTMLTableElement>();
  private readonly cleanup: Array<() => void> = [];
  private scanFrame: number | null = null;
  private docCache: { doc: Text; lines: string[]; tables: MarkdownTable[] } | null = null;
  private pendingFocus: PendingFocus | null = null;
  private normalizing = false;
  private destroyed = false;

  constructor(
    private readonly app: App,
    private readonly view: EditorView,
    private readonly fontManager?: FontManager
  ) {
    const doc = this.view.dom.ownerDocument;
    const clearOutside = (event: PointerEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".cm-table-widget table")) return;
      for (const tableEl of this.known) {
        clearSelection(tableEl);
        this.selections.delete(tableEl);
      }
      this.selectionByLine.clear();
    };
    doc.addEventListener("pointerdown", clearOutside, true);
    this.cleanup.push(() => doc.removeEventListener("pointerdown", clearOutside, true));

    // Obsidian swaps a table cell between its static wrapper and a nested
    // editor. Re-scan when that happens so the static wrapper is decorated
    // again after editing.
    const observer = new MutationObserver(() => this.scheduleScan());
    observer.observe(this.view.contentDOM, { childList: true, subtree: true });
    this.cleanup.push(() => observer.disconnect());

    this.scheduleScan();
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) this.docCache = null;
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      update.focusChanged
    ) {
      this.scheduleScan();
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.scanFrame !== null) cancelAnimationFrame(this.scanFrame);
    for (const remove of [...this.cleanup]) remove();
    this.cleanup.length = 0;
    this.selectionByLine.clear();
  }

  private scheduleScan(): void {
    if (this.destroyed || this.scanFrame !== null) return;
    this.scanFrame = requestAnimationFrame(() => {
      this.scanFrame = null;
      this.scan();
    });
  }

  private lines(): string[] {
    const doc = this.view.state.doc;
    if (this.docCache?.doc === doc) return this.docCache.lines;
    const lines = doc.toString().split("\n");
    this.docCache = { doc, lines, tables: findTables(lines) };
    return lines;
  }

  private tables(): MarkdownTable[] {
    this.lines();
    return this.docCache?.tables ?? [];
  }

  private locate(tableEl: HTMLTableElement): TableMeta | null {
    let hint: number | null = null;
    try {
      const pos = this.view.posAtDOM(tableEl);
      hint = this.view.state.doc.lineAt(Math.max(0, Math.min(pos, this.view.state.doc.length))).number - 1;
    } catch {
      hint = null;
    }

    const domRows = domRowTexts(tableEl);
    const tables = this.tables();
    const model =
      hint === null
        ? null
        : tables.find((candidate) => hint >= candidate.startLine && hint <= candidate.endLine) ?? null;
    const exact = tables.filter((candidate) => sameShape(candidate, domRows));
    if (exact.length > 0) {
      const near =
        hint === null
          ? undefined
          : exact.find((candidate) => hint >= candidate.startLine && hint <= candidate.endLine);
      const match = near ?? exact[0];
      return { table: match, startLine: match.startLine };
    }
    if (model && looseShape(model, domRows)) {
      return { table: model, startLine: model.startLine };
    }
    const previous = this.metas.get(tableEl);
    if (previous) {
      const candidate = parseTableAt(this.lines(), previous.startLine);
      if (candidate && looseShape(candidate, domRows)) {
        return { table: candidate, startLine: candidate.startLine };
      }
    }
    const byShape = tables.find((candidate) => looseShape(candidate, domRows));
    if (byShape) return { table: byShape, startLine: byShape.startLine };
    return null;
  }

  private scan(): void {
    if (this.destroyed || !this.view.dom.isConnected) return;
    if (this.pendingFocus && Date.now() > this.pendingFocus.expires) {
      this.pendingFocus = null;
    }
    const domTables = [
      ...this.view.contentDOM.querySelectorAll<HTMLTableElement>("table"),
    ].filter(
      (table) =>
        table.closest(".cm-table-widget") !== null &&
        table.parentElement?.closest("table") === null
    );

    let normalize: TableMeta | null = null;
    const current = new Set<HTMLTableElement>();

    for (const tableEl of domTables) {
      current.add(tableEl);
      const meta = this.locate(tableEl);
      if (!meta) {
        if (this.known.has(tableEl)) resetTableLayout(tableEl);
        continue;
      }
      this.known.add(tableEl);
      this.metas.set(tableEl, meta);

      const layout = resolveLayout(meta.table);
      const signature =
        `${meta.table.rows.length}x${meta.table.columns}:` +
        layout.groups
          .map((group) => `${group.r},${group.c},${group.rowSpan},${group.colSpan},${group.contentR},${group.contentC}`)
          .join(";");
      if (
        tableEl.dataset.langscapeSignature !== signature ||
        !layoutMatchesDom(tableEl, layout)
      ) {
        applyTableLayout(tableEl, meta.table, layout);
        tableEl.dataset.langscapeSignature = signature;
      }
      const saved = this.selectionByLine.get(meta.startLine);
      if (saved) {
        if (Date.now() - saved.at < 60_000) {
          this.selections.set(tableEl, saved.state);
        } else {
          this.selectionByLine.delete(meta.startLine);
        }
      }
      const selection = this.selections.get(tableEl);
      paintSelection(
        tableEl,
        layout,
        selection ? expandRect(meta.table, layout, selectionRect(selection, meta.table)) : null
      );
      this.decorateStaticCells(tableEl);
      this.bind(tableEl);

      if (hasMarkers(meta.table) && hasRightMarker(meta.table)) normalize = meta;
      if (this.pendingFocus && this.pendingFocus.startLine === meta.startLine) {
        this.focusCell(tableEl, meta, this.pendingFocus.r, this.pendingFocus.c);
      }
    }

    for (const tableEl of this.known) {
      if (!current.has(tableEl)) {
        this.selections.delete(tableEl);
        resetTableLayout(tableEl);
        this.known.delete(tableEl);
      }
    }

    if (normalize) this.normalizeTable(normalize);
  }

  private decorateStaticCells(tableEl: HTMLTableElement): void {
    if (!this.fontManager) return;
    for (const wrapper of tableEl.querySelectorAll<HTMLElement>(".table-cell-wrapper")) {
      if (wrapper.style.display === "none") continue;
      if (wrapper.querySelector(".cm-editor, .cm-s-obsidian")) continue;
      if (wrapper.querySelector(".langscape-font")) continue;
      const text = wrapper.textContent ?? "";
      if (!text.includes("{") && !text.includes("'''")) continue;
      decorateFontSpans(wrapper, this.fontManager);
    }
  }

  private focusCell(tableEl: HTMLTableElement, meta: TableMeta, r: number, c: number): void {
    const pending = this.pendingFocus;
    if (!pending) return;
    if (Date.now() > pending.expires) {
      this.pendingFocus = null;
      return;
    }
    const cell = cellAt(tableEl, r, c);
    if (!cell) return;
    const editable = cellEditable(cell);
    try {
      editable.focus({ preventScroll: true });
    } catch {
      editable.focus();
    }
    const doc = this.view.dom.ownerDocument;
    const selection = doc.getSelection();
    if (selection && editable.isContentEditable) {
      const range = doc.createRange();
      range.selectNodeContents(editable);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (doc.activeElement === editable || cell.contains(doc.activeElement)) {
      this.pendingFocus = null;
      return;
    }
    // Obsidian's table editor owns focus; fall back to a source cursor on the
    // anchor cell's line so the next keystroke still goes somewhere sensible.
    try {
      const line = meta.table.lineNumbers[Math.min(r, meta.table.lineNumbers.length - 1)];
      if (line !== undefined) {
        const pos = this.view.state.doc.line(line + 1).from;
        this.view.dispatch({ selection: { anchor: pos } });
        this.pendingFocus = null;
      }
    } catch {
      // Leave pending focus for the next scan.
    }
  }

  private applyRows(
    tableEl: HTMLTableElement,
    meta: TableMeta,
    rows: TableCell[][],
    anchor: { r: number; c: number }
  ): boolean {
    if (this.destroyed) return false;
    const lines = this.lines();
    const fresh = this.locate(tableEl) ?? meta;
    const current = parseTableAt(lines, fresh.startLine);
    if (!current) return false;
    if (current.columns !== fresh.table.columns || current.rows.length !== fresh.table.rows.length) {
      return false;
    }
    const serialized = serializeTable(current, rows, lines);
    if (!serialized) return false;

    const from = this.view.state.doc.line(serialized.fromLine + 1).from;
    const to = this.view.state.doc.line(serialized.toLine + 1).to;
    this.pendingFocus = {
      startLine: current.startLine,
      r: anchor.r,
      c: anchor.c,
      expires: Date.now() + 4000,
    };
    this.view.dispatch({
      changes: { from, to, insert: serialized.text },
      userEvent: "input.langscape-table",
    });
    this.scheduleScan();
    return true;
  }

  private normalizeTable(meta: TableMeta): void {
    if (this.normalizing) return;
    const rows = normalizeRightMarkers(meta.table);
    if (!rows) return;
    const lines = this.lines();
    const current = parseTableAt(lines, meta.startLine);
    if (!current) return;
    if (current.columns !== meta.table.columns || current.rows.length !== meta.table.rows.length) {
      return;
    }
    const serialized = serializeTable(current, rows, lines);
    if (!serialized) return;
    this.normalizing = true;
    try {
      this.view.dispatch({
        changes: {
          from: this.view.state.doc.line(serialized.fromLine + 1).from,
          to: this.view.state.doc.line(serialized.toLine + 1).to,
          insert: serialized.text,
        },
        annotations: Transaction.addToHistory.of(false),
      });
      this.docCache = null;
    } finally {
      this.normalizing = false;
    }
    this.scheduleScan();
  }

  private updateSelection(
    tableEl: HTMLTableElement,
    meta: TableMeta,
    selection: SelectionState
  ): void {
    this.selections.set(tableEl, selection);
    this.selectionByLine.set(meta.startLine, { state: selection, at: Date.now() });
    const layout = resolveLayout(meta.table);
    paintSelection(
      tableEl,
      layout,
      expandRect(meta.table, layout, selectionRect(selection, meta.table))
    );
  }

  private bind(tableEl: HTMLTableElement): void {
    if (this.bound.has(tableEl)) return;
    this.bound.add(tableEl);

    tableEl.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const cell = (event.target as HTMLElement | null)?.closest<HTMLTableCellElement>("th, td");
      const meta = this.metas.get(tableEl);
      if (!cell || !meta || !tableEl.contains(cell) || isCoveredCell(cell)) return;
      if (cell.dataset.langscapeR === undefined) return;
      const r = Number(cell.dataset.langscapeR);
      const c = Number(cell.dataset.langscapeC);
      if (event.shiftKey) {
        const existing = this.selections.get(tableEl);
        const anchor = existing ?? { anchorR: r, anchorC: c, focusR: r, focusC: c };
        this.updateSelection(tableEl, meta, {
          anchorR: anchor.anchorR,
          anchorC: anchor.anchorC,
          focusR: r,
          focusC: c,
        });
        return;
      }
      this.updateSelection(tableEl, meta, {
        anchorR: r,
        anchorC: c,
        focusR: r,
        focusC: c,
      });

      const start = { x: event.clientX, y: event.clientY };
      let dragging = false;
      const doc = this.view.dom.ownerDocument;
      const onMove = (move: PointerEvent): void => {
        if (!dragging && Math.hypot(move.clientX - start.x, move.clientY - start.y) < 4) {
          return;
        }
        dragging = true;
        tableEl.classList.add("langscape-table-selecting");
        doc.getSelection()?.removeAllRanges();
        const target = doc.elementFromPoint(move.clientX, move.clientY);
        const over = target?.closest<HTMLTableCellElement>("th, td");
        if (!over || !tableEl.contains(over) || over.dataset.langscapeR === undefined) return;
        this.updateSelection(tableEl, meta, {
          anchorR: r,
          anchorC: c,
          focusR: Number(over.dataset.langscapeR),
          focusC: Number(over.dataset.langscapeC),
        });
        move.preventDefault();
      };
      const removeDragListeners = (): void => {
        tableEl.classList.remove("langscape-table-selecting");
        doc.removeEventListener("pointermove", onMove, true);
        doc.removeEventListener("pointerup", onUp, true);
        const index = this.cleanup.indexOf(removeDragListeners);
        if (index >= 0) this.cleanup.splice(index, 1);
      };
      const onUp = (): void => {
        removeDragListeners();
      };
      doc.addEventListener("pointermove", onMove, true);
      doc.addEventListener("pointerup", onUp, true);
      this.cleanup.push(removeDragListeners);
    }, true);

    tableEl.addEventListener(
      "keydown",
      (event) => {
        const meta = this.metas.get(tableEl);
        if (!meta) return;
        if (event.isComposing || event.defaultPrevented) return;
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const direction: MergeDirection | null =
          event.key === "<" ? "left" : event.key === "^" ? "up" : event.key === ">" ? "right" : null;
        if (!direction) return;

        const cell = (event.target as HTMLElement | null)?.closest<HTMLTableCellElement>("th, td");
        if (!cell || !tableEl.contains(cell) || isCoveredCell(cell)) return;
        if (cell.dataset.langscapeR === undefined) return;
        if (!cellIsEmpty(cell)) return;
        const r = Number(cell.dataset.langscapeR);
        const c = Number(cell.dataset.langscapeC);
        if (!neighboringRect(meta.table, r, c, direction)) return;

        const result = mergeDirectionally(meta.table, r, c, direction);
        if (!result.ok) {
          if (result.reason.includes("header")) {
            event.preventDefault();
            event.stopPropagation();
            new Notice(result.reason);
          }
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.applyRows(tableEl, meta, result.rows, { r: result.rect.r1, c: result.rect.c1 });
      },
      true
    );

    tableEl.addEventListener(
      "focusout",
      () => this.scheduleScan(),
      true
    );

    tableEl.addEventListener(
      "contextmenu",
      (event) => {
        const meta = this.metas.get(tableEl);
        const cell = (event.target as HTMLElement | null)?.closest<HTMLTableCellElement>("th, td");
        if (!meta || !cell || !tableEl.contains(cell) || isCoveredCell(cell)) return;
        if (cell.dataset.langscapeR === undefined) return;
        pendingTableMenu = {
          at: Date.now(),
          build: (menu) => this.populateMenu(menu, tableEl, meta, cell),
        };
      },
      true
    );
  }

  private populateMenu(
    menu: Menu,
    tableEl: HTMLTableElement,
    meta: TableMeta,
    cell: HTMLTableCellElement
  ): void {
    if (this.destroyed) return;
    const r = Number(cell.dataset.langscapeR);
    const c = Number(cell.dataset.langscapeC);
    const table = meta.table;
    const layout = resolveLayout(table);
    let selection = this.selections.get(tableEl);
    if (!selection) {
      const saved = this.selectionByLine.get(meta.startLine);
      if (saved && Date.now() - saved.at < 60_000) {
        selection = saved.state;
        this.selections.set(tableEl, selection);
      }
    }
    if (!selection) {
      selection = { anchorR: r, anchorC: c, focusR: r, focusC: c };
      this.updateSelection(tableEl, meta, selection);
    }
    let rect = expandRect(table, layout, selectionRect(selection, table));
    if (r < rect.r1 || r > rect.r2 || c < rect.c1 || c > rect.c2) {
      selection = { anchorR: r, anchorC: c, focusR: r, focusC: c };
      this.updateSelection(tableEl, meta, selection);
      rect = rectFromCell(table, r, c);
    }

    const rawRect = selectionRect(selection, table);
    const rawArea = (rawRect.r2 - rawRect.r1 + 1) * (rawRect.c2 - rawRect.c1 + 1);
    const canMerge = rawArea >= 2;
    const canSplit = groupSpanAt(table, r, c) > 1;

    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Merge cells")
        .setIcon("merge")
        .setDisabled(!canMerge)
        .onClick(() => {
          const result = mergeSelection(table, rect);
          if (!result.ok) {
            new Notice(result.reason);
            return;
          }
          this.applyRows(tableEl, meta, result.rows, {
            r: result.rect.r1,
            c: result.rect.c1,
          });
        })
    );
    menu.addItem((item) =>
      item
        .setTitle("Split cells")
        .setIcon("scissors")
        .setDisabled(!canSplit)
        .onClick(() => {
          const result = splitCellAt(table, r, c);
          if (!result.ok) {
            new Notice(result.reason);
            return;
          }
          this.applyRows(tableEl, meta, result.rows, { r, c });
        })
    );

  }
}
