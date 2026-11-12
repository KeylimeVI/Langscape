// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { FontRecord } from "../../src/fonts/css";
import {
  isValidSyntaxTreeLabel,
  parseSyntaxTreeLine,
  serializeSyntaxTree,
} from "../../src/trees/model";
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

describe("syntax tree serialization", () => {
  it("round-trips a parsed tree", () => {
    const source = "{tree: VP(NP(I), V(see), NP(Det(the), Adj(blue), N(sky)))}";
    const tree = parseSyntaxTreeLine(source)!;
    expect(serializeSyntaxTree(tree)).toBe(source);
    expect(parseSyntaxTreeLine(serializeSyntaxTree(tree))).toEqual(tree);
  });

  it("validates labels that can round-trip", () => {
    expect(isValidSyntaxTreeLabel("NP")).toBe(true);
    expect(isValidSyntaxTreeLabel("{tengwar: 𐌰𐍆𐌰}")).toBe(true);
    expect(isValidSyntaxTreeLabel("two words")).toBe(true);
    expect(isValidSyntaxTreeLabel("A(B)")).toBe(false);
    expect(isValidSyntaxTreeLabel("A, B")).toBe(false);
    expect(isValidSyntaxTreeLabel("   ")).toBe(false);
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
  it("adds a child from the hover control", () => {
    const tree = parseSyntaxTreeLine("{tree: S(NP(N(cat)))}")!;
    let changes = 0;
    const root = renderSyntaxTree(tree, manager, document, {
      onChange: (next) => {
        changes++;
        expect(next).toBe(tree);
      },
    });
    document.body.appendChild(root);
    const add = root.querySelector<HTMLButtonElement>(".langscape-tree-add")!;
    add.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(tree.children.at(-1)?.label).toBe("X");
    expect(changes).toBe(1);
    root.remove();
  });

  it("renames a node when its label is clicked", () => {
    const tree = parseSyntaxTreeLine("{tree: S(NP(N(cat)))}")!;
    let changes = 0;
    const root = renderSyntaxTree(tree, manager, document, {
      onChange: () => {
        changes++;
      },
    });
    document.body.appendChild(root);
    const label = root.querySelector<HTMLElement>(".langscape-tree-label")!;
    label.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 })
    );
    label.dispatchEvent(
      new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 10, clientY: 10 })
    );
    const input = root.querySelector<HTMLInputElement>(".langscape-tree-edit");
    expect(input).not.toBeNull();
    input!.value = "CP";
    input!.dispatchEvent(new Event("blur"));
    expect(tree.label).toBe("CP");
    expect(changes).toBe(1);
    root.remove();
  });

  it("moves a subtree when dragged onto another node", () => {
    const tree = parseSyntaxTreeLine("{tree: S(NP(N(cat)), VP(V(see)))}")!;
    let changes = 0;
    const root = renderSyntaxTree(tree, manager, document, {
      onChange: () => {
        changes++;
      },
    });
    document.body.appendChild(root);
    const labels = [...root.querySelectorAll<HTMLElement>(".langscape-tree-label")];
    const source = labels.find((label) => label.textContent === "NP")!;
    const target = labels.find((label) => label.textContent === "VP")!;
    const original = (document as any).elementFromPoint;
    (document as any).elementFromPoint = () => target;
    source.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 })
    );
    source.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, button: 0, clientX: 30, clientY: 30 })
    );
    source.dispatchEvent(
      new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 30, clientY: 30 })
    );
    (document as any).elementFromPoint = original;
    expect(tree.children.map((child) => child.label)).toEqual(["VP"]);
    expect(tree.children[0].children.map((child) => child.label)).toEqual(["V", "NP"]);
    expect(changes).toBe(1);
    root.remove();
  });

});
