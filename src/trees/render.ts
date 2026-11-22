import type { FontManager } from "../fonts/manager";
import { createTreeDrag } from "./drag";
import { decorateFontSpans } from "../fonts/render";
import { isValidSyntaxTreeLabel, type SyntaxTreeNode } from "./model";

export interface SyntaxTreeActions {
  /**
   * Called after a graphical edit. The receiver is responsible for writing the
   * serialized tree back to Markdown (the Live Preview widget dispatches a
   * CodeMirror change).
   */
  onChange?: (tree: SyntaxTreeNode) => void;
  /** Remove the whole tree. Used by the root node's delete control. */
  onRemove?: () => void;
  /** Confirm deletion of a subtree with two or more nodes. */
  confirmDelete?: (node: SyntaxTreeNode, count: number) => boolean | Promise<boolean>;
  alignment?: TreeAlignmentPreference;
}

interface NodeContext {
  node: SyntaxTreeNode;
  parent: SyntaxTreeNode | null;
  item: HTMLDivElement;
  row: HTMLDivElement;
  label: HTMLSpanElement;
}

export type TreeAlignment = "center" | "left";
export interface TreeAlignmentPreference {
  get(): TreeAlignment;
  set(alignment: TreeAlignment): void;
}

// One size observer per document. A mutation watcher prunes trees that have
// been detached by Obsidian's Markdown rerender, so observers do not accumulate.
const treeResizeCallbacks = new Map<HTMLElement, () => void>();
let treeResizeObserver: ResizeObserver | null = null;
let treeResizeMutation: MutationObserver | null = null;
let treeResizeDocument: Document | null = null;

function observeTreeSize(tree: HTMLElement, callback: () => void): void {
  const doc = tree.ownerDocument;
  const win = doc.defaultView;
  if (!win?.ResizeObserver || !doc.body) return;
  if (!treeResizeObserver || treeResizeDocument !== doc) {
    treeResizeObserver?.disconnect();
    treeResizeMutation?.disconnect();
    treeResizeCallbacks.clear();
    treeResizeObserver = new win.ResizeObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        if (!target.isConnected) {
          treeResizeObserver?.unobserve(target);
          treeResizeCallbacks.delete(target);
          continue;
        }
        treeResizeCallbacks.get(target)?.();
      }
    });
    treeResizeMutation = new win.MutationObserver(() => {
      for (const target of [...treeResizeCallbacks.keys()]) {
        if (target.isConnected) continue;
        treeResizeObserver?.unobserve(target);
        treeResizeCallbacks.delete(target);
      }
    });
    treeResizeMutation.observe(doc.body, { childList: true, subtree: true });
    treeResizeDocument = doc;
  }
  treeResizeCallbacks.set(tree, callback);
  treeResizeObserver.observe(tree);
}

export function renderSyntaxTree(
  root: SyntaxTreeNode,
  manager: FontManager,
  doc: Document = document,
  actions: SyntaxTreeActions = {}
): HTMLElement {
  const block = doc.createElement("div");
  block.className = "langscape-tree-block";

  const toolbar = doc.createElement("div");
  toolbar.className = "langscape-tree-toolbar";
  const alignButton = doc.createElement("button");
  alignButton.type = "button";
  alignButton.className = "langscape-tree-align";
  alignButton.setAttribute("aria-pressed", "false");
  toolbar.appendChild(alignButton);

  const tree = doc.createElement("div");
  tree.className = "langscape-tree";
  tree.setAttribute("role", actions.onChange ? "tree" : "img");

  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("langscape-tree-edges");
  svg.setAttribute("aria-hidden", "true");
  tree.appendChild(svg);

  const editable = Boolean(actions.onChange);
  const redrawEdges = () => drawEdges(tree, svg);

  const notify = () => {
    if (!actions.onChange) return;
    actions.onChange(root);
  };

  const drag = editable ? createTreeDrag(block, notify) : null;

  const centerWideTree = () => {
    if (block.scrollWidth <= block.clientWidth + 1) return;
    block.scrollLeft = tree.classList.contains("is-align-left")
      ? 0
      : Math.round((block.scrollWidth - block.clientWidth) / 2);
  };

  const setAlignment = (next: TreeAlignment) => {
    actions.alignment?.set(next);
    for (const blockEl of doc.querySelectorAll<HTMLElement>(".langscape-tree-block")) {
      const candidate = blockEl.querySelector<HTMLElement>(".langscape-tree");
      if (!candidate) continue;
      candidate.classList.toggle("is-align-left", next === "left");
      const button = blockEl.querySelector<HTMLButtonElement>(".langscape-tree-align");
      if (button) setAlignmentIcon(button, next);
      const candidateSvg = candidate.querySelector<SVGSVGElement>(".langscape-tree-edges");
      if (candidateSvg) drawEdges(candidate, candidateSvg);
      if (candidate === tree) centerWideTree();
    }
  };

  alignButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  alignButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setAlignment(tree.classList.contains("is-align-left") ? "center" : "left");
  });

  const alignment = actions.alignment?.get() ?? "center";
  tree.classList.toggle("is-align-left", alignment === "left");
  setAlignmentIcon(alignButton, alignment);

  const beginEdit = (context: NodeContext) => {
    if (!editable || context.label.dataset.editing === "true") return;
    context.label.dataset.editing = "true";
    const input = doc.createElement("input");
    input.type = "text";
    input.className = "langscape-tree-edit";
    input.value = context.node.label;
    const rect = context.label.getBoundingClientRect();
    input.style.left = `${Math.max(4, rect.left - 5)}px`;
    input.style.top = `${Math.max(4, rect.top - 1)}px`;
    input.style.width = `${Math.max(52, rect.width + 10)}px`;
    input.style.height = `${Math.max(26, rect.height + 2)}px`;
    // Keep the input outside CodeMirror. A native input nested in the CM
    // contenteditable leaks keystrokes into the Markdown source.
    doc.body.appendChild(input);

    let finished = false;
    const restoreLabel = () => {
      input.remove();
    };
    const cancel = () => {
      if (finished) return;
      finished = true;
      context.label.dataset.editing = "false";
      restoreLabel();
      paintLabel(context, manager, doc);
    };
    const commit = () => {
      if (finished) return;
      finished = true;
      context.label.dataset.editing = "false";
      const next = input.value.trim();
      restoreLabel();
      if (!isValidSyntaxTreeLabel(next)) {
        paintLabel(context, manager, doc);
        return;
      }
      if (next !== context.node.label) {
        context.node.label = next;
        notify();
        return;
      }
      paintLabel(context, manager, doc);
    };

    for (const type of ["pointerdown", "click", "keydown", "keypress", "keyup", "beforeinput", "input"]) {
      input.addEventListener(type, (event) => {
        event.stopPropagation();
      });
    }
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    });
    input.addEventListener("blur", commit);
    input.focus();
    input.select();
  };

  const bindLabel = (context: NodeContext) => {
    if (!editable) return;
    const { label } = context;
    label.tabIndex = 0;
    label.setAttribute("role", "button");
    drag?.addNode(context, () => beginEdit(context));

    label.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === "F2") {
        event.preventDefault();
        beginEdit(context);
      }
    });
  };

  const renderNode = (
    node: SyntaxTreeNode,
    parent: SyntaxTreeNode | null,
    level: number
  ): HTMLDivElement => {
    const item = doc.createElement("div");
    item.className = "langscape-tree-node";
    item.setAttribute("role", "treeitem");
    item.setAttribute("aria-level", String(level));

    const row = doc.createElement("div");
    row.className = "langscape-tree-label-row";

    const label = doc.createElement("span");
    label.className = "langscape-tree-label";
    paintLabelText(label, node.label, manager, doc);
    row.appendChild(label);

    const context: NodeContext = { node, parent, item, row, label };
    bindLabel(context);

    if (editable) {
      const add = doc.createElement("button");
      add.type = "button";
      add.className = "langscape-tree-add";
      add.textContent = "+";
      add.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      add.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        node.children.push({ label: "", children: [] });
        notify();
      });
      row.appendChild(add);

      if (parent || actions.onRemove) {
        const remove = doc.createElement("button");
        remove.type = "button";
        remove.className = "langscape-tree-delete";
        setTrashIcon(remove, doc);
        remove.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        remove.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const count = countNodes(node);
          if (count >= 2 && actions.confirmDelete) {
            const confirmed = await actions.confirmDelete(node, count);
            if (!confirmed) return;
          }
          if (!parent) {
            actions.onRemove?.();
            return;
          }
          const index = parent.children.indexOf(node);
          if (index < 0) return;
          parent.children.splice(index, 1);
          notify();
        });
        row.appendChild(remove);
      }
    }

    item.appendChild(row);

    if (node.children.length > 0) {
      const children = doc.createElement("div");
      children.className = "langscape-tree-children";
      for (const child of node.children) {
        children.appendChild(renderNode(child, node, level + 1));
      }
      item.appendChild(children);
    }
    return item;
  };

  tree.appendChild(renderNode(root, null, 1));
  block.appendChild(toolbar);
  block.appendChild(tree);

  const schedule = () => {
    const win = doc.defaultView;
    if (win?.requestAnimationFrame) {
      win.requestAnimationFrame(() => {
        win.requestAnimationFrame(() => {
          redrawEdges();
          centerWideTree();
        });
      });
    } else {
      (win ?? window).setTimeout(() => {
        redrawEdges();
        centerWideTree();
      }, 0);
    }
  };
  schedule();

  observeTreeSize(tree, () => redrawEdges());

  return block;
}

function setAlignmentIcon(button: HTMLButtonElement, alignment: TreeAlignment): void {
  const doc = button.ownerDocument;
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  const paths =
    alignment === "left"
      ? ["M4 6h16", "M4 10h10", "M4 14h14", "M4 18h6"]
      : ["M4 6h16", "M7 10h10", "M5 14h14", "M9 18h6"];
  for (const definition of paths) {
    const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", definition);
    svg.appendChild(path);
  }
  button.replaceChildren(svg);
  button.setAttribute("aria-pressed", String(alignment === "left"));
  button.dataset.alignment = alignment;
}


function countNodes(node: SyntaxTreeNode): number {
  return 1 + node.children.reduce((total, child) => total + countNodes(child), 0);
}

function setTrashIcon(button: HTMLButtonElement, doc: Document): void {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const definition of [
    "M3 6h18",
    "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
    "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
    "M10 11v6",
    "M14 11v6",
  ]) {
    const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", definition);
    svg.appendChild(path);
  }
  button.replaceChildren(svg);
}

function paintLabel(
  context: NodeContext,
  manager: FontManager,
  doc: Document
): void {
  paintLabelText(context.label, context.node.label, manager, doc);
}

function paintLabelText(
  label: HTMLElement,
  text: string,
  manager: FontManager,
  doc: Document
): void {
  label.textContent = "";
  if (!text.trim()) {
    const placeholder = doc.createElement("span");
    placeholder.className = "langscape-tree-empty";
    placeholder.textContent = "○";
    label.appendChild(placeholder);
    return;
  }
  label.textContent = text;
  // Node labels can contain {nickname: text} font spans. A Live Preview
  // widget lives inside CodeMirror's contenteditable, so include editable
  // nodes here.
  decorateFontSpans(label, manager, doc, { includeEditable: true });
}

/**
 * Draw one line from the bottom of each parent label to the top of each child
 * label. SVG coordinates keep the edges diagonal at every fan-out instead of
 * using CSS's horizontal sibling rails.
 */
function drawEdges(tree: HTMLElement, svg: SVGSVGElement): void {
  const width = Math.max(tree.scrollWidth, tree.clientWidth);
  const height = Math.max(tree.scrollHeight, tree.clientHeight);
  if (!width || !height) return;

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.style.width = `${width}px`;
  svg.style.height = `${height}px`;
  svg.replaceChildren();

  const treeRect = tree.getBoundingClientRect();
  if (!treeRect.width || !treeRect.height) return;

  const doc = tree.ownerDocument;
  for (const parent of tree.querySelectorAll<HTMLElement>(".langscape-tree-node")) {
    const parentLabel = parent.querySelector<HTMLElement>(
      ":scope > .langscape-tree-label-row > .langscape-tree-label"
    );
    const children = parent.querySelector<HTMLElement>(
      ":scope > .langscape-tree-children"
    );
    if (!parentLabel || !children) continue;
    const parentRect = parentLabel.getBoundingClientRect();
    for (const child of children.querySelectorAll<HTMLElement>(
      ":scope > .langscape-tree-node"
    )) {
      const childLabel = child.querySelector<HTMLElement>(
        ":scope > .langscape-tree-label-row > .langscape-tree-label"
      );
      if (!childLabel) continue;
      const childRect = childLabel.getBoundingClientRect();
      if (!childRect.width || !childRect.height) continue;
      const line = doc.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute(
        "x1",
        String(parentRect.left - treeRect.left + parentRect.width / 2)
      );
      line.setAttribute("y1", String(parentRect.bottom - treeRect.top));
      line.setAttribute(
        "x2",
        String(childRect.left - treeRect.left + childRect.width / 2)
      );
      line.setAttribute("y2", String(childRect.top - treeRect.top));
      line.setAttribute("stroke-width", "1");
      line.setAttribute("stroke", "currentColor");
      svg.appendChild(line);
    }
  }
}
