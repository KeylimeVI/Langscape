// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Menu } from "obsidian";
import {
  installTableMenuPatch,
  MergedTableController,
} from "../../src/tables/live-preview";

const source = ["| A | B |", "| --- | --- |", "| a |  |"].join("\n");

function fakeViewWith(sourceText: string, rows: string[][]) {
  const contentDOM = document.createElement("div");
  contentDOM.className = "cm-content";
  document.body.appendChild(contentDOM);
  const widget = document.createElement("div");
  widget.className = "cm-table-widget";
  const table = document.createElement("table");
  const head = rows[0].map((text) => `<th>${text}</th>`).join("");
  const body = rows
    .slice(1)
    .map((row) => `<tr>${row.map((text) => `<td><div class="table-cell-wrapper">${text}</div></td>`).join("")}</tr>`)
    .join("");
  table.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
  widget.appendChild(table);
  contentDOM.appendChild(widget);

  let controller: MergedTableController | null = null;
  const view = {
    contentDOM,
    dom: contentDOM,
    state: EditorState.create({ doc: sourceText }),
    posAtDOM: () => 0,
    dispatch: (spec: any) => {
      view.state = view.state.update(spec).state;
      controller?.update({ docChanged: true } as any);
    },
  };
  return {
    view,
    table,
    cell: () => table.rows[1].cells[1] as HTMLTableCellElement,
    attach: (instance: MergedTableController) => {
      controller = instance;
    },
  };
}

function fakeView() {
  return fakeViewWith(source, [
    ["A", "B"],
    ["a", ""],
  ]);
}

describe("Live Preview table controller", () => {
  let raf: typeof requestAnimationFrame;
  let caf: typeof cancelAnimationFrame;

  beforeEach(() => {
    raf = globalThis.requestAnimationFrame;
    caf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0) as unknown as number) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((handle: number) =>
      clearTimeout(handle as unknown as NodeJS.Timeout)) as typeof cancelAnimationFrame;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = caf;
    document.body.innerHTML = "";
  });

  it("keeps a callout prefix when editing a table", () => {
    const fake = fakeView();
    fake.view.state = EditorState.create({
      doc: "> | A | B |\n> | --- | --- |\n> | a |  |",
    });
    const controller = new MergedTableController({} as any, fake.view as any);
    fake.attach(controller);
    (controller as any).scan();
    fake.cell().dispatchEvent(
      new KeyboardEvent("keydown", { key: "<", bubbles: true, cancelable: true })
    );
    const lines = fake.view.state.doc.toString().split("\n");
    expect(lines[2].startsWith("> ")).toBe(true);
    expect(lines[2]).toContain("<");
    controller.destroy();
  });

  it("appends merge actions to the native table menu", () => {
    const fake = fakeView();
    const controller = new MergedTableController({} as any, fake.view as any);
    fake.attach(controller);
    (controller as any).scan();
    const restore = installTableMenuPatch();
    try {
      const first = fake.table.rows[1].cells[0];
      const second = fake.table.rows[1].cells[1];
      first.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      second.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, shiftKey: true })
      );
      first.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const menu = new Menu();
      menu.showAtMouseEvent(new MouseEvent("contextmenu"));
      const items = (menu as any).items.filter((item: any) => typeof item === "object");
      const titles = items.map((item: any) => item.title);
      expect(titles).toContain("Merge cells");
      expect(titles).toContain("Split cells");
      expect(titles.some((title: string) => title.startsWith("Merge with"))).toBe(false);
      expect(items.find((item: any) => item.title === "Merge cells")?.disabled).toBe(false);
    } finally {
      restore();
      controller.destroy();
    }
  });

  it("keeps a multi-cell selection when the table widget re-renders", () => {
    const fake = fakeView();
    const controller = new MergedTableController({} as any, fake.view as any);
    fake.attach(controller);
    (controller as any).scan();
    const first = fake.table.rows[1].cells[0];
    const second = fake.table.rows[1].cells[1];
    first.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    second.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0, shiftKey: true })
    );

    const clone = fake.table.cloneNode(true) as HTMLTableElement;
    fake.table.replaceWith(clone);
    (controller as any).scan();

    const restore = installTableMenuPatch();
    try {
      clone.rows[1].cells[0].dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
      );
      const menu = new Menu();
      menu.showAtMouseEvent(new MouseEvent("contextmenu"));
      const merge = (menu as any).items.find((item: any) => item.title === "Merge cells");
      expect(merge?.disabled).toBe(false);
    } finally {
      restore();
      controller.destroy();
    }
  });

  it("expands a selection touching merged groups to a full rectangle", () => {
    const mergedSource = [
      "| A | B | C |",
      "| --- | --- | --- |",
      "| v | x | y |",
      "| ^ | h | < |",
    ].join("\n");
    const fake = fakeViewWith(mergedSource, [
      ["A", "B", "C"],
      ["v", "x", "y"],
      ["^", "h", "<"],
    ]);
    const controller = new MergedTableController({} as any, fake.view as any);
    fake.attach(controller);
    (controller as any).scan();

    const cellAt = (r: number, c: number) =>
      fake.table.querySelector<HTMLTableCellElement>(
        `[data-langscape-r="${r}"][data-langscape-c="${c}"]`
      );
    cellAt(1, 0)!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    cellAt(2, 1)!.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0, shiftKey: true })
    );

    // The selection touches a vertical group in column 0 and a horizontal
    // group in row 2. The top-right cell is not in either group, but it is
    // inside the bounding rectangle and must be selected too.
    expect(cellAt(1, 2)!.classList.contains("langscape-table-selected")).toBe(true);
    for (let r = 1; r <= 2; r++) {
      for (let c = 0; c <= 2; c++) {
        expect(cellAt(r, c)!.classList.contains("langscape-table-selected")).toBe(true);
      }
    }
    expect(cellAt(0, 2)!.classList.contains("langscape-table-selected")).toBe(false);
    controller.destroy();
  });

  it("decorates a raw font span in a static table cell", () => {
    const fontSource = ["| A | B |", "| --- | --- |", "| x | {gothic: 𐌰} |"].join("\n");
    const fake = fakeViewWith(fontSource, [
      ["A", "B"],
      ["x", "{gothic: 𐌰}"],
    ]);
    const fontManager = {
      find: (name: string) =>
        name.toLowerCase() === "gothic"
          ? {
              id: "gothic",
              family: "Noto Sans Gothic",
              displayName: "Noto Sans Gothic",
              nickname: "gothic",
              className: "langscape-font-gothic",
              source: "vault",
            }
          : undefined,
    };
    const controller = new MergedTableController({} as any, fake.view as any, fontManager as any);
    fake.attach(controller);
    (controller as any).scan();
    expect(fake.table.querySelector("td .langscape-font")?.textContent).toBe("𐌰");
    controller.destroy();
  });

  it("turns a typed > into a right merge", () => {
    const fake = fakeView();
    const table = fake.table;
    table.rows[1].cells[0].textContent = "";
    table.rows[1].cells[1].textContent = "b";
    fake.view.state = EditorState.create({ doc: "| A | B |\n| --- | --- |\n|  | b |" });
    const controller = new MergedTableController({} as any, fake.view as any);
    fake.attach(controller);
    (controller as any).scan();

    const event = new KeyboardEvent("keydown", {
      key: ">",
      bubbles: true,
      cancelable: true,
    });
    table.rows[1].cells[0].dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    const updated = fake.view.state.doc.toString();
    expect(updated.split("\n")[2]).toBe("| b | < |");
    controller.destroy();
  });

  it("renders merges and turns a typed marker into a source merge", () => {
    const fake = fakeView();
    const controller = new MergedTableController({} as any, fake.view as any);
    fake.attach(controller);
    (controller as any).scan();
    expect(fake.table.classList.contains("langscape-merged-table")).toBe(false);
    expect(fake.cell().dataset.langscapeC).toBe("1");

    const event = new KeyboardEvent("keydown", {
      key: "<",
      bubbles: true,
      cancelable: true,
    });
    fake.cell().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    const updated = fake.view.state.doc.toString();
    expect(updated.split("\n")[2]).toContain("<");
    expect(updated.split("\n")[2]).toContain("a");

    (controller as any).scan();
    expect(fake.table.classList.contains("langscape-merged-table")).toBe(true);
    expect(fake.table.rows[1].cells[0].colSpan).toBe(2);
    controller.destroy();
  });
});
