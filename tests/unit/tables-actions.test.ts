import { describe, expect, it } from "vitest";
import { Menu, type Editor } from "obsidian";
import {
  addTableMenuItems,
  hasTableAtCursor,
  insertTable,
  mergeTableCells,
  splitTableCell,
} from "../../src/tables/actions";

class FakeEditor {
  value: string;
  cursor = { line: 0, ch: 0 };
  from = { line: 0, ch: 0 };
  to = { line: 0, ch: 0 };

  constructor(value: string) {
    this.value = value;
  }

  getValue(): string {
    return this.value;
  }

  getCursor(which?: "from" | "to") {
    if (which === "from") return this.from;
    if (which === "to") return this.to;
    return this.cursor;
  }

  setCursor(position: { line: number; ch: number }): void {
    this.cursor = position;
    this.from = position;
    this.to = position;
  }

  getLine(line: number): string {
    return this.value.split("\n")[line] ?? "";
  }

  replaceRange(
    text: string,
    from: { line: number; ch: number },
    to: { line: number; ch: number }
  ): void {
    const lines = this.value.split("\n");
    const head = (lines[from.line] ?? "").slice(0, from.ch);
    const tail = (lines[to.line] ?? "").slice(to.ch);
    const inserted = text.split("\n");
    const merged = [
      ...lines.slice(0, from.line),
      head + inserted[0],
      ...inserted.slice(1, -1),
      inserted[inserted.length - 1] + tail,
      ...lines.slice(to.line + 1),
    ];
    this.value = merged.join("\n");
  }

  replaceSelection(text: string): void {
    this.replaceRange(text, this.from, this.to);
    const insertedLines = text.split("\n");
    if (insertedLines.length > 1) {
      this.cursor = { line: this.cursor.line + insertedLines.length - 1, ch: 0 };
    }
  }

  focus(): void {}
}

const table = [
  "| A | B |",
  "| --- | --- |",
  "| a | b |",
].join("\n");

describe("table commands", () => {
  it("detects the cursor inside a table", () => {
    const editor = new FakeEditor(table);
    editor.setCursor({ line: 2, ch: 2 });
    expect(hasTableAtCursor(editor as unknown as Editor)).toBe(true);
    editor.setCursor({ line: 3, ch: 0 });
    expect(hasTableAtCursor(editor as unknown as Editor)).toBe(false);
  });

  it("merges the selected cells and writes markers", () => {
    const editor = new FakeEditor(table);
    editor.from = { line: 2, ch: 2 };
    editor.to = { line: 2, ch: 6 };
    expect(mergeTableCells(editor as unknown as Editor)).toBe(true);
    const lines = editor.value.split("\n");
    expect(lines[1]).toBe("| --- | --- |");
    expect(lines[2]).toContain("a b");
    expect(lines[2]).toContain("<");
  });

  it("splits a merged cell at the cursor", () => {
    const editor = new FakeEditor(
      ["| A | B |", "| --- | --- |", "| a b | < |"].join("\n")
    );
    editor.setCursor({ line: 2, ch: 6 });
    expect(splitTableCell(editor as unknown as Editor)).toBe(true);
    const line = editor.value.split("\n")[2];
    expect(line).not.toContain("<");
    expect(line).toContain("a b");
  });

  it("adds only merge and split actions to the editor menu", () => {
    const editor = new FakeEditor(
      ["| A | B |", "| --- | --- |", "| a | < |"].join("\n")
    );
    editor.setCursor({ line: 2, ch: 2 });
    const menu = new Menu();
    expect(addTableMenuItems(menu as any, editor as unknown as Editor)).toBe(true);
    const items = (menu as any).items.filter((item: any) => typeof item === "object");
    const titles = items.map((item: any) => item.title);
    expect(titles).toEqual(["Merge cells", "Split cells"]);
    expect(items.find((item: any) => item.title === "Merge cells")?.disabled).toBe(true);
    expect(items.find((item: any) => item.title === "Split cells")?.disabled).toBe(false);
  });

  it("enables Merge cells when the source selection crosses cells", () => {
    const editor = new FakeEditor(
      ["| A | B |", "| --- | --- |", "| a | b |"].join("\n")
    );
    editor.from = { line: 2, ch: 2 };
    editor.to = { line: 2, ch: 6 };
    const menu = new Menu();
    addTableMenuItems(menu as any, editor as unknown as Editor);
    const items = (menu as any).items.filter((item: any) => typeof item === "object");
    expect(items.find((item: any) => item.title === "Merge cells")?.disabled).toBe(false);
    expect(items.find((item: any) => item.title === "Split cells")?.disabled).toBe(true);
  });

  it("does nothing when the cursor is outside a table", () => {
    const editor = new FakeEditor("no table here");
    const menu = new Menu();
    expect(addTableMenuItems(menu as any, editor as unknown as Editor)).toBe(false);
  });

  it("inserts a starter table", () => {
    const editor = new FakeEditor("");
    editor.setCursor({ line: 0, ch: 0 });
    insertTable(editor as unknown as Editor);
    expect(editor.value).toContain("| Column 1 | Column 2 | Column 3 |");
    expect(editor.value).toContain("| --- | --- | --- |");
  });
});
