// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { FontDomDecorator } from "../../src/fonts/dom";

const record = {
  id: "gothic",
  family: "Noto Sans Gothic",
  displayName: "Noto Sans Gothic",
  nickname: "gothic",
  className: "langscape-font-gothic",
  source: "vault" as const,
  path: "Fonts/gothic.ttf",
};

const manager = {
  find: (name: string) => (name === "gothic" ? record : undefined),
} as any;

function decorator(): FontDomDecorator {
  return new FontDomDecorator(
    { workspace: { containerEl: document.body } } as any,
    manager
  );
}

describe("FontDomDecorator", () => {
  it("decorates font spans in Bases table/card values", () => {
    document.body.innerHTML =
      '<div class="bases-view"><span class="bases-table-cell">Say {gothic: 𐌰𐍆𐌰}</span></div>';
    decorator().scan();
    expect(document.querySelector(".bases-view .langscape-font")?.textContent).toBe("𐌰𐍆𐌰");
    expect(document.querySelector(".bases-view")?.textContent).toBe("Say 𐌰𐍆𐌰");
  });

  it("restores markup when a Bases metadata editor is focused", () => {
    document.body.innerHTML =
      '<div class="bases-view"><div contenteditable="true">Say {gothic: 𐌰𐍆𐌰}</div></div>';
    const d = decorator();
    d.scan();
    const editor = document.querySelector<HTMLElement>(".bases-view [contenteditable]")!;
    expect(editor.querySelector(".langscape-font")).toBeTruthy();
    expect(editor.textContent).toBe("Say 𐌰𐍆𐌰");

    editor.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(editor.textContent).toBe("Say {gothic: 𐌰𐍆𐌰}");
    expect(editor.querySelector(".langscape-font")).toBeNull();

    editor.textContent = "Say {gothic: new}";
    d.scan();
    expect(editor.querySelector(".langscape-font")?.textContent).toBe("new");
    expect(editor.dataset.langscapeSource).toBe("Say {gothic: new}");
  });
});
