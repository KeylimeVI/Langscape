import { TFile, type App, type MarkdownPostProcessorContext } from "obsidian";
import {
  findTables,
  hasMarkers,
  plainCellText,
  resolveLayout,
  tableFromDomRows,
  type MarkdownTable,
} from "./model";
import {
  applyTableLayout,
  domRowTexts,
} from "./render";

type SectionContext = Pick<MarkdownPostProcessorContext, "sourcePath" | "getSectionInfo">;

function shapeMatches(table: MarkdownTable, domRows: string[][]): boolean {
  if (table.rows.length !== domRows.length) return false;
  for (let r = 0; r < domRows.length; r++) {
    if (table.rows[r].length < domRows[r].length) return false;
    for (let c = 0; c < domRows[r].length; c++) {
      if (plainCellText(table.rows[r][c].text) !== plainCellText(domRows[r][c])) return false;
    }
  }
  return true;
}

function tableFromDomLayout(tableEl: HTMLTableElement): MarkdownTable | null {
  return tableFromDomRows(domRowTexts(tableEl).map((cells) => ({ cells })));
}

/**
 * Reading view / exported HTML: turn `<`/`^`/`>` marker cells into real
 * colspan/rowspan cells. Source text is preferred so escaped markers are not
 * mistaken for merges; rendered markup is the fallback for embeds and previews.
 */
export function createMergedTablePostProcessor(app: App) {
  const cache = new Map<string, { mtime: number; size: number; lines: string[] }>();

  const sourceLines = async (path: string): Promise<string[]> => {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return [];
    const cached = cache.get(path);
    if (cached && cached.mtime === file.stat.mtime && cached.size === file.stat.size) {
      return cached.lines;
    }
    try {
      const text = await app.vault.cachedRead(file);
      const lines = text.replace(/\r\n?/g, "\n").split("\n");
      if (cache.size > 8) cache.clear();
      cache.set(path, { mtime: file.stat.mtime, size: file.stat.size, lines });
      return lines;
    } catch {
      return [];
    }
  };

  return async (el: HTMLElement, context: SectionContext): Promise<void> => {
    const tables = [...el.querySelectorAll<HTMLTableElement>("table")];
    if (el.matches("table")) tables.unshift(el as HTMLTableElement);
    const candidates = tables.filter(
      (table) =>
        !table.closest(".langscape-table-skip") &&
        table.dataset.langscapeProcessed !== "true"
    );
    if (candidates.length === 0) return;

    const sourcePath = context.sourcePath;
    let sectionTables: MarkdownTable[] = [];
    let info: ReturnType<MarkdownPostProcessorContext["getSectionInfo"]> = null;
    try {
      info = context.getSectionInfo?.(el) ?? null;
    } catch {
      info = null;
    }
    if (sourcePath && info && info.lineStart >= 0 && info.lineEnd >= info.lineStart) {
      const lines = await sourceLines(sourcePath);
      if (lines.length > 0) sectionTables = findTables(lines, info.lineStart, info.lineEnd);
    }

    const used = new Set<MarkdownTable>();
    let sourceIndex = 0;
    for (const tableEl of candidates) {
      const domRows = domRowTexts(tableEl);
      if (domRows.length === 0) continue;

      let table: MarkdownTable | null = null;
      const byIndex = sectionTables[sourceIndex];
      if (byIndex && !used.has(byIndex) && shapeMatches(byIndex, domRows)) {
        table = byIndex;
        used.add(byIndex);
        sourceIndex++;
      } else {
        const match = sectionTables.find(
          (candidate) => !used.has(candidate) && shapeMatches(candidate, domRows)
        );
        if (match) {
          used.add(match);
          table = match;
        }
      }
      if (!table) table = tableFromDomLayout(tableEl);
      if (!table || !hasMarkers(table)) continue;

      tableEl.dataset.langscapeProcessed = "true";
      const layout = resolveLayout(table);
      applyTableLayout(tableEl, table, layout, { moveContent: true });
    }
  };
}
