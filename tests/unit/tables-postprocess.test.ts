// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import { createMergedTablePostProcessor } from "../../src/tables/postprocess";

function appWith(source: string) {
  const file = new (TFile as unknown as new (path: string) => TFile)("Note.md");
  file.stat = { mtime: 1, ctime: 1, size: source.length };
  return {
    vault: {
      getAbstractFileByPath: (path: string) => (path === "Note.md" ? file : null),
      cachedRead: async () => source,
    },
  } as any;
}

function section(lines: number) {
  return {
    sourcePath: "Note.md",
    getSectionInfo: () => ({ lineStart: 0, lineEnd: lines, text: "" }),
  } as any;
}

function tableHtml(rows: string[][]): HTMLElement {
  const root = document.createElement("div");
  root.className = "markdown-rendered";
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
  root.appendChild(table);
  document.body.appendChild(root);
  return root;
}

describe("Reading-view merged tables", () => {
  it("uses source markers to build spans", async () => {
    const source = [
      "| A | B |",
      "| --- | --- |",
      "| a | < |",
      "| ^ | < |",
    ].join("\n");
    const root = tableHtml([
      ["A", "B"],
      ["a", "<"],
      ["^", "<"],
    ]);
    await createMergedTablePostProcessor(appWith(source))(root, section(4));
    const table = root.querySelector("table")!;
    expect(table.classList.contains("langscape-merged-table")).toBe(true);
    expect(table.rows[1].cells[0].rowSpan).toBe(2);
    expect(table.rows[1].cells[0].colSpan).toBe(2);
    root.remove();
  });

  it("finds a table inside a callout", async () => {
    const source = [
      "> | A | B |",
      "> | --- | --- |",
      "> | a | < |",
      "> | ^ | < |",
    ].join("\n");
    const root = tableHtml([
      ["A", "B"],
      ["a", "<"],
      ["^", "<"],
    ]);
    await createMergedTablePostProcessor(appWith(source))(root, section(4));
    const table = root.querySelector("table")!;
    expect(table.rows[1].cells[0].rowSpan).toBe(2);
    expect(table.rows[1].cells[0].colSpan).toBe(2);
    root.remove();
  });

  it("does not merge a source-escaped marker", async () => {
    const source = ["| A | B |", "| --- | --- |", "| a | \\< |"].join("\n");
    const root = tableHtml([
      ["A", "B"],
      ["a", "<"],
    ]);
    await createMergedTablePostProcessor(appWith(source))(root, section(3));
    const table = root.querySelector("table")!;
    expect(table.classList.contains("langscape-merged-table")).toBe(false);
    root.remove();
  });

  it("falls back to rendered markup when no section info is available", async () => {
    const root = tableHtml([
      ["A", "B", "C"],
      ["a", "b", "c"],
      ["d", "<", "^"],
    ]);
    const processor = createMergedTablePostProcessor(appWith(""));
    await processor(root, { sourcePath: "", getSectionInfo: () => null } as any);
    const table = root.querySelector("table")!;
    expect(table.classList.contains("langscape-merged-table")).toBe(true);
    expect(table.rows[1].cells[2].rowSpan).toBe(2);
    expect(table.rows[2].cells[0].colSpan).toBe(2);
    root.remove();
  });

  it("matches formatted source cells to their rendered text", async () => {
    const source = [
      "| **Name** | Form |",
      "| --- | --- |",
      "| [apa](https://example.com) | \\< |",
    ].join("\n");
    const root = tableHtml([
      ["Name", "Form"],
      ["apa", "<"],
    ]);
    await createMergedTablePostProcessor(appWith(source))(root, section(3));
    const table = root.querySelector("table")!;
    expect(table.rows[1].cells[0].colSpan).toBe(1);
    expect(table.classList.contains("langscape-merged-table")).toBe(false);
    table.rows[1].cells[0].textContent = "apa";
    root.remove();
  });

  it("moves content for right markers", async () => {
    const source = ["| A | B | C |", "| --- | --- | --- |", "| a | > | c |"].join("\n");
    const root = tableHtml([
      ["A", "B", "C"],
      ["a", ">", "c"],
    ]);
    await createMergedTablePostProcessor(appWith(source))(root, section(3));
    const table = root.querySelector("table")!;
    expect(table.rows[1].cells[1].textContent).toBe("c");
    expect(table.rows[1].cells[1].colSpan).toBe(2);
    root.remove();
  });
});
