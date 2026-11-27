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
  const block = createDiv({ cls: "langscape-tree-block" });
  if (block.ownerDocument !== doc) doc.adoptNode(block);

  const toolbar = block.createDiv({ cls: "langscape-tree-toolbar" });
  const alignButton = toolbar.createEl("button", {
    type: "button",
    cls: "langscape-tree-align",
    attr: { "aria-pressed": "false" },
  });

  const tree = block.createDiv({
    cls: "langscape-tree",
    attr: { role: actions.onChange ? "tree" : "img" },
  });

  const svg = tree.createSvg("svg", {
    cls: "langscape-tree-edges",
    attr: { "aria-hidden": "true" },
  });

  const editable = Boolean(actions.onChange);
  const redrawEdges = () => drawEdges(tree, svg);

  // Highlight only the innermost hovered node without relying on CSS :has().
  if (editable) {
    let hoveredNode: HTMLElement | null = null;
    const setHovered = (next: HTMLElement | null) => {
      if (hoveredNode === next) return;
      hoveredNode?.classList.remove("is-tree-hovered");
      next?.classList.add("is-tree-hovered");
      hoveredNode = next;
    };
    tree.addEventListener("mouseover", (event) => {
      const target = event.target as HTMLElement | null;
      const node = target?.closest?.<HTMLElement>(".langscape-tree-node") ?? null;
      setHovered(node && tree.contains(node) ? node : null);
    });
    tree.addEventListener("mouseleave", () => setHovered(null));
  }

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
    // Keep the input outside CodeMirror. A native input nested in the CM
    // contenteditable leaks keystrokes into the Markdown source.
    const input = doc.body.createEl("input", {
      type: "text",
      cls: "langscape-tree-edit",
      value: context.node.label,
    });
    const rect = context.label.getBoundingClientRect();
    input.style.left = `${Math.max(4, rect.left - 5)}px`;
    input.style.top = `${Math.max(4, rect.top - 1)}px`;
    input.style.width = `${Math.max(52, rect.width + 10)}px`;
    input.style.height = `${Math.max(26, rect.height + 2)}px`;

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
    container: HTMLElement,
    node: SyntaxTreeNode,
    parent: SyntaxTreeNode | null,
    level: number
  ): HTMLDivElement => {
    const item = container.createDiv({
      cls: "langscape-tree-node",
      attr: { role: "treeitem", "aria-level": String(level) },
    });

    const row = item.createDiv({ cls: "langscape-tree-label-row" });
    const label = row.createSpan({ cls: "langscape-tree-label" });
    paintLabelText(label, node.label, manager, doc);

    const context: NodeContext = { node, parent, item, row, label };
    bindLabel(context);

    if (editable) {
      const add = row.createEl("button", {
        type: "button",
        cls: "langscape-tree-add",
        text: "+",
      });
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

      if (parent || actions.onRemove) {
        const remove = row.createEl("button", {
          type: "button",
          cls: "langscape-tree-delete",
        });
        setTrashIcon(remove);
        remove.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        const handleRemove = async (): Promise<void> => {
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
        };
        remove.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          void handleRemove();
        });
      }
    }

    if (node.children.length > 0) {
      const children = item.createDiv({ cls: "langscape-tree-children" });
      for (const child of node.children) {
        renderNode(children, child, node, level + 1);
      }
    }
    return item;
  };

  renderNode(tree, root, null, 1);

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
  button.empty();
  const svg = button.createSvg("svg", {
    attr: {
      viewBox: "0 0 24 24",
      width: "16",
      height: "16",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
    },
  });
  const paths =
    alignment === "left"
      ? ["M4 6h16", "M4 10h10", "M4 14h14", "M4 18h6"]
      : ["M4 6h16", "M7 10h10", "M5 14h14", "M9 18h6"];
  for (const definition of paths) {
    svg.createSvg("path", { attr: { d: definition } });
  }
  button.setAttribute("aria-pressed", String(alignment === "left"));
  button.dataset.alignment = alignment;
}

function countNodes(node: SyntaxTreeNode): number {
  return 1 + node.children.reduce((total, child) => total + countNodes(child), 0);
}

function setTrashIcon(button: HTMLButtonElement): void {
  button.empty();
  const svg = button.createSvg("svg", {
    attr: {
      viewBox: "0 0 24 24",
      width: "14",
      height: "14",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    },
  });
  for (const definition of [
    "M3 6h18",
    "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
    "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
    "M10 11v6",
    "M14 11v6",
  ]) {
    svg.createSvg("path", { attr: { d: definition } });
  }
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
  label.empty();
  if (!text.trim()) {
    label.createSpan({ cls: "langscape-tree-empty", text: "○" });
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
      svg.createSvg("line", {
        attr: {
          x1: String(parentRect.left - treeRect.left + parentRect.width / 2),
          y1: String(parentRect.bottom - treeRect.top),
          x2: String(childRect.left - treeRect.left + childRect.width / 2),
          y2: String(childRect.top - treeRect.top),
          "stroke-width": "1",
          stroke: "currentColor",
        },
      });
    }
  }
}
