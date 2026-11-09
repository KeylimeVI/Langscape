// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { FontRecord } from "../../src/fonts/css";
import { parseSyntaxTreeLine } from "../../src/trees/model";
import { createSyntaxTreePostProcessor } from "../../src/trees/postprocess";
import { renderSyntaxTree } from "../../src/trees/render";

const record: FontRecord = {
  id: "gothic",
  family: "Noto Sans Gothic",
  displayName: "Noto Sans Gothic",
  nickname: "tengwar",
  className: "langscape-font-gothic",
  source: "vault",
  path: "Fonts/gothic.ttf",
};

const manager = {
  find(name: string): FontRecord | undefined {
    return name.toLowerCase() === "tengwar" ? record : undefined;
  },
  sampleFor: () => "sample",
} as any;

describe("syntax tree syntax", () => {
  it("parses a complete tree line", () => {
    const tree = parseSyntaxTreeLine(
      "{tree: VP(NP(I), V(see), NP(Det(the), Adj(blue), N(sky)))}"
    );
    expect(tree?.label).toBe("VP");
    expect(tree?.children.map((child) => child.label)).toEqual(["NP", "V", "NP"]);
    expect(tree?.children[0].children[0]).toEqual({ label: "I", children: [] });
    expect(tree?.children[2].children.map((child) => child.label)).toEqual([
      "Det",
      "Adj",
      "N",
    ]);
  });

  it("supports font spans and punctuation inside labels", () => {
    const tree = parseSyntaxTreeLine(
      "{tree: NP({tengwar: (a, b)}, V(see))}"
    );
    expect(tree?.children[0]).toEqual({
      label: "{tengwar: (a, b)}",
      children: [],
    });
    expect(tree?.children[1].label).toBe("V");
    expect(tree?.children[1].children[0].label).toBe("see");
  });

  it("allows surrounding whitespace and empty children", () => {
    expect(parseSyntaxTreeLine("  {tree: S()}  ")).toEqual({
      label: "S",
      children: [],
    });
  });

  it("rejects inline and malformed trees", () => {
    expect(parseSyntaxTreeLine("A {tree: NP(I)}")).toBeNull();
    expect(parseSyntaxTreeLine("{tree: NP(I)} trailing")).toBeNull();
    expect(parseSyntaxTreeLine("{tree: NP(I)")).toBeNull();
    expect(parseSyntaxTreeLine("{tree: NP(I), V(see)}")).toBeNull();
    expect(parseSyntaxTreeLine("{tree: }")).toBeNull();
    expect(parseSyntaxTreeLine("{tree: NP(, V(see))}")).toBeNull();
  });
});

describe("syntax tree rendering", () => {
  it("renders nested labels and fonts inside labels", () => {
    const tree = parseSyntaxTreeLine(
      "{tree: NP({tengwar: I}, N(sky))}"
    )!;
    const root = renderSyntaxTree(tree, manager);
    expect(root.querySelectorAll(".langscape-tree-label")).toHaveLength(4);
    const font = root.querySelector("span.langscape-font");
    expect(font?.textContent).toBe("I");
    expect(font?.className).toContain("langscape-font-gothic");
  });

  it("replaces a complete paragraph in reading view", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>{tree: NP(I)}</p><p>{tree: NP(I)} more</p>";
    document.body.appendChild(root);
    const process = createSyntaxTreePostProcessor(manager);
    process(root, {});
    expect(root.querySelectorAll(".langscape-tree")).toHaveLength(1);
    expect(root.querySelectorAll("p")).toHaveLength(1);
    expect(root.textContent).toContain("{tree: NP(I)} more");
    root.remove();
  });
});
