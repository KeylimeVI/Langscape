// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  applyFrontmatterFont,
  decorateFontSpans,
} from "../../src/fonts/render";
import type { FontRecord } from "../../src/fonts/css";

const record: FontRecord = {
  id: "gothic",
  family: "Noto Sans Gothic",
  displayName: "Noto Sans Gothic",
  nickname: "gothic",
  className: "langscape-font-gothic",
  source: "vault",
  path: "Fonts/gothic.ttf",
};

const manager = {
  find(name: string): FontRecord | undefined {
    return name.toLowerCase().replace(/-/g, " ") === "noto sans gothic" ||
      name.toLowerCase() === "gothic"
      ? record
      : undefined;
  },
  sampleFor: () => "sample",
} as any;

describe("font post-processing", () => {
  it("rewrites inline legacy spans in reading view", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>Say {font:Noto Sans Gothic|𐌰𐍆𐌰} now.</p>";
    decorateFontSpans(root, manager);
    const span = root.querySelector("span.langscape-font");
    expect(span?.textContent).toBe("𐌰𐍆𐌰");
    expect(span?.className).toContain("langscape-font-gothic");
    expect(span?.getAttribute("data-langscape-font")).toBe("Noto Sans Gothic");
    expect(root.textContent).toBe("Say 𐌰𐍆𐌰 now.");
  });

  it("rewrites inline triple-quote spans", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>Say '''Noto-Sans-Gothic 𐌰𐍆𐌰''' now.</p>";
    decorateFontSpans(root, manager);
    const span = root.querySelector("span.langscape-font");
    expect(span?.textContent).toBe("𐌰𐍆𐌰");
    expect(root.textContent).toBe("Say 𐌰𐍆𐌰 now.");
  });

  it("leaves unknown fonts and code blocks alone", () => {
    const root = document.createElement("div");
    root.innerHTML =
      "<p>{font:Missing|x}</p><p>'''missing x'''</p><code>'''Noto-Sans-Gothic code'''</code><p>{font:Noto Sans Gothic|y}</p>";
    decorateFontSpans(root, manager);
    expect(root.querySelectorAll("span.langscape-font")).toHaveLength(1);
    expect(root.querySelector("p")?.textContent).toBe("{font:Missing|x}");
    expect(root.querySelectorAll("p")[1]?.textContent).toBe("'''missing x'''");
    expect(root.querySelector("code")?.textContent).toContain("'''Noto-Sans-Gothic");
  });

  it("handles escaped markers", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>\\{font:Noto Sans Gothic|literal}</p>";
    decorateFontSpans(root, manager);
    expect(root.textContent).toBe("{font:Noto Sans Gothic|literal}");
    expect(root.querySelector("span.langscape-font")).toBeNull();
  });

  it("applies note-level frontmatter fonts", () => {
    const root = document.createElement("div");
    applyFrontmatterFont(root, { "langscape-font": "Noto Sans Gothic" }, manager);
    expect(root.className).toContain("langscape-font-gothic");
    expect(root.className).toContain("langscape-note-font");
  });
});
