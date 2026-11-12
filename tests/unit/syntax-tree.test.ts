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
    const input = document.querySelector<HTMLInputElement>(".langscape-tree-edit");
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

  it("keeps the original label in place while editing", () => {
    const tree = parseSyntaxTreeLine("{tree: S(NP(N(cat)))}")!;
    const root = renderSyntaxTree(tree, manager, document, { onChange: () => undefined });
    document.body.appendChild(root);
    const label = root.querySelector<HTMLElement>(".langscape-tree-label")!;
    label.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 })
    );
    label.dispatchEvent(
      new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 10, clientY: 10 })
    );
    expect(label.isConnected).toBe(true);
    expect(label.style.visibility).toBe("hidden");
    const input = document.querySelector<HTMLInputElement>(".langscape-tree-edit")!;
    input.dispatchEvent(new Event("blur"));
    expect(label.style.visibility).toBe("");
    root.remove();
  });

  it("deletes a node and its subtree", () => {
    const tree = parseSyntaxTreeLine("{tree: S(NP(N(cat)), VP(V(see)))}")!;
    let changes = 0;
    const root = renderSyntaxTree(tree, manager, document, {
      onChange: () => {
        changes++;
      },
    });
    document.body.appendChild(root);
    const remove = root.querySelector<HTMLButtonElement>(".langscape-tree-delete")!;
    remove.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(tree.children.map((child) => child.label)).toEqual(["VP"]);
    expect(changes).toBe(1);
    root.remove();
  });

  it("can delete the root tree", () => {
    const tree = parseSyntaxTreeLine("{tree: S(NP(N(cat)))}")!;
    let removed = 0;
    const root = renderSyntaxTree(tree, manager, document, {
      onChange: () => undefined,
      onRemove: () => {
        removed++;
      },
    });
    document.body.appendChild(root);
    const remove = root.querySelector<HTMLButtonElement>(".langscape-tree-delete")!;
    remove.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(removed).toBe(1);
    root.remove();
  });

  it("toggles the whole tree alignment", () => {
    localStorage.removeItem("langscape-tree-alignment");
    const tree = parseSyntaxTreeLine("{tree: S(NP(N(cat)))}")!;
    const root = renderSyntaxTree(tree, manager, document);
    document.body.appendChild(root);
    const treeEl = root.querySelector<HTMLElement>(".langscape-tree")!;
    const button = root.querySelector<HTMLButtonElement>(".langscape-tree-align")!;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(treeEl.classList.contains("is-align-left")).toBe(true);
    expect(button.dataset.alignment).toBe("left");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(treeEl.classList.contains("is-align-left")).toBe(false);
    expect(button.dataset.alignment).toBe("center");
    root.remove();
  });

  it("can drop a node before a sibling", () => {
    const tree = parseSyntaxTreeLine("{tree: S(A, B, C)}")!;
    let changes = 0;
    const root = renderSyntaxTree(tree, manager, document, {
      onChange: () => {
        changes++;
      },
    });
    document.body.appendChild(root);
    const labels = [...root.querySelectorAll<HTMLElement>(".langscape-tree-label")];
    const source = labels.find((label) => label.textContent === "C")!;
    const target = labels.find((label) => label.textContent === "A")!;
    target.getBoundingClientRect = () =>
      ({ left: 100, right: 200, top: 50, bottom: 70, width: 100, height: 20, x: 100, y: 50, toJSON: () => ({}) }) as DOMRect;
    const original = (document as any).elementFromPoint;
    (document as any).elementFromPoint = () => target;
    source.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 })
    );
    source.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, button: 0, clientX: 110, clientY: 55 })
    );
    source.dispatchEvent(
      new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 110, clientY: 55 })
    );
    (document as any).elementFromPoint = original;
    expect(tree.children.map((child) => child.label)).toEqual(["C", "A", "B"]);
    expect(changes).toBe(1);
    root.remove();
  });

  it("confirms before deleting a multi-node subtree", () => {
    const tree = parseSyntaxTreeLine("{tree: S(NP(N(cat)), VP(V(see)))}")!;
    let changes = 0;
    let asked = 0;
    const root = renderSyntaxTree(tree, manager, document, {
      onChange: () => {
        changes++;
      },
      confirmDelete: (node, count) => {
        asked++;
        expect(node.label).toBe("NP");
        expect(count).toBe(3);
        return false;
      },
    });
    document.body.appendChild(root);
    const remove = root.querySelector<HTMLButtonElement>(".langscape-tree-delete")!;
    remove.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(asked).toBe(1);
    expect(tree.children.map((child) => child.label)).toEqual(["NP", "VP"]);
    expect(changes).toBe(0);
    root.remove();
  });

});
