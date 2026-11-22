// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { FontRecord } from "../../src/fonts/css";
import {
  isValidSyntaxTreeLabel,
  parseSyntaxTreeLine,
  serializeSyntaxTree,
} from "../../src/trees/model";
import { createSyntaxTreePostProcessor } from "../../src/trees/postprocess";
import { cancelTreeDrag } from "../../src/trees/drag";
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
    expect(isValidSyntaxTreeLabel("")).toBe(true);
    expect(isValidSyntaxTreeLabel("   ")).toBe(true);
    expect(parseSyntaxTreeLine('{tree: ""}')).toEqual({ label: "", children: [] });
    expect(serializeSyntaxTree({ label: "", children: [] })).toBe('{tree: ""}');
    expect(parseSyntaxTreeLine('{tree: S("")}')?.children[0].label).toBe("");
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

  it("renders a placeholder for an empty label", () => {
    const tree = parseSyntaxTreeLine('{tree: ""}')!;
    const root = renderSyntaxTree(tree, manager);
    expect(root.querySelector(".langscape-tree-empty")?.textContent).toBe("○");
    expect(root.textContent?.trim()).toBe("○");
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
    expect(tree.children.at(-1)?.label).toBe("");
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
    expect(label.dataset.editing).toBe("true");
    const input = document.querySelector<HTMLInputElement>(".langscape-tree-edit")!;
    input.dispatchEvent(new Event("blur"));
    expect(label.dataset.editing).toBe("false");
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
    const tree = parseSyntaxTreeLine("{tree: S(NP(N(cat)))}")!;
    let preference: "left" | "center" = "center";
    const alignment = { get: () => preference, set: (value: typeof preference) => { preference = value; } };
    const root = renderSyntaxTree(tree, manager, document, { alignment });
    document.body.appendChild(root);
    const treeEl = root.querySelector<HTMLElement>(".langscape-tree")!;
    const button = root.querySelector<HTMLButtonElement>(".langscape-tree-align")!;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(treeEl.classList.contains("is-align-left")).toBe(true);
    expect(button.dataset.alignment).toBe("left");
    expect(preference).toBe("left");
    expect(renderSyntaxTree(tree, manager, document, { alignment }).querySelector(".langscape-tree.is-align-left")).not.toBeNull();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(treeEl.classList.contains("is-align-left")).toBe(false);
    expect(button.dataset.alignment).toBe("center");
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

function withDrag(
  source: string,
  test: (ui: {
    root: HTMLElement;
    label: (text: string) => HTMLElement;
    side: (text: string, kind: "before" | "after") => HTMLElement;
    pointer: (type: string, target: HTMLElement | null, x: number) => void;
    changes: string[];
  }) => void
): void {
  const changes: string[] = [];
  const tree = parseSyntaxTreeLine(source)!;
  const root = renderSyntaxTree(tree, manager, document, {
    onChange: (next) => changes.push(serializeSyntaxTree(next)),
  });
  document.body.appendChild(root);
  let under: HTMLElement | null = null;
  const original = document.elementFromPoint;
  document.elementFromPoint = () => under;
  const label = (text: string) => [...root.querySelectorAll<HTMLElement>(".langscape-tree-label")]
    .find((element) => element.textContent === text)!;
  try {
    test({
      root,
      label,
      side: (text, kind) => label(text).parentElement!.querySelector<HTMLElement>(`.langscape-tree-drop-side.is-${kind}`)!,
      pointer: (type, target, x) => {
        under = target;
        (target ?? document.body).dispatchEvent(new MouseEvent(type, {
          bubbles: true, button: 0, clientX: x, clientY: 10,
        }));
      },
      changes,
    });
  } finally {
    cancelTreeDrag(root);
    document.elementFromPoint = original;
    root.remove();
  }
}

describe("syntax tree drag targets", () => {
  it("drops on a label to append the entire subtree as a child", () => {
    withDrag("{tree: S(NP(N(cat)), VP(V(see)))}", ({ label, pointer, changes }) => {
      pointer("pointerdown", label("N"), 10);
      pointer("pointermove", label("VP"), 30);
      expect(label("VP").classList.contains("is-tree-drop-active")).toBe(true);
      pointer("pointerup", label("VP"), 30);
      expect(changes).toEqual(["{tree: S(NP, VP(V(see), N(cat)))}"]);
    });
  });

  it("can move a subtree across parents without dropping it into the sibling", () => {
    withDrag("{tree: S(NP(N(cat)), VP(V(see)))}", ({ label, side, pointer, changes }) => {
      pointer("pointerdown", label("N"), 10);
      const before = side("V", "before");
      pointer("pointermove", before, 30);
      expect(before.classList.contains("is-tree-drop-active")).toBe(true);
      pointer("pointerup", before, 30);
      expect(changes).toEqual(["{tree: S(NP, VP(N(cat), V(see)))}"]);
    });
  });

  it("uses the point of release and handles moving forward in the same list", () => {
    withDrag("{tree: S(A, B, C)}", ({ label, side, pointer, changes }) => {
      pointer("pointerdown", label("A"), 10);
      pointer("pointermove", label("B"), 30);
      pointer("pointerup", side("C", "after"), 90);
      expect(changes).toEqual(["{tree: S(B, C, A)}"]);
    });
  });

  it.each(["blank space", "a descendant", "the original position", "Escape", "pointer cancellation"])(
    "does not edit Markdown after dropping on %s",
    (reason) => {
      withDrag("{tree: S(A(X), B, C)}", ({ root, label, side, pointer, changes }) => {
        pointer("pointerdown", label("A"), 10);
        pointer("pointermove", label("C"), 30);
        expect(label("C").classList.contains("is-tree-drop-active")).toBe(true);
        expect(label("X").classList.contains("is-tree-drop-zone")).toBe(false);
        if (reason === "Escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        if (reason === "pointer cancellation") pointer("pointercancel", label("C"), 30);
        const target = reason === "blank space" ? root
          : reason === "a descendant" ? label("X")
          : reason === "the original position" ? side("B", "before") : label("C");
        pointer("pointerup", target, 50);
        expect(changes).toEqual([]);
        expect(root.querySelector(".is-tree-drop-zone, .is-dragging-source")).toBeNull();
        expect(document.querySelector(".langscape-tree-drag-preview")).toBeNull();
      });
    }
  );
});
