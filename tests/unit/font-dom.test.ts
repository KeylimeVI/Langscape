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

describe("FontDomDecorator", () => {
  it("decorates font spans inside Bases views", () => {
    document.body.innerHTML =
      '<div class="bases-view"><span class="bases-table-cell">Say {gothic: 𐌰𐍆𐌰}</span></div>';
    const app = { workspace: { containerEl: document.body } } as any;
    const decorator = new FontDomDecorator(app, manager);
    decorator.scan();
    expect(document.querySelector(".bases-view .langscape-font")?.textContent).toBe("𐌰𐍆𐌰");
    expect(document.querySelector(".bases-view")?.textContent).toBe("Say 𐌰𐍆𐌰");
  });

  it("decorates Excalidraw embedded Markdown hosts", () => {
    document.body.innerHTML = '<div class="excalidraw-md-host"><p>{gothic: text}</p></div>';
    const app = { workspace: { containerEl: document.body } } as any;
    new FontDomDecorator(app, manager).scan();
    expect(document.querySelector(".excalidraw-md-host .langscape-font")?.textContent).toBe("text");
  });
});
