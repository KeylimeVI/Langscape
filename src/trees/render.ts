import type { FontManager } from "../fonts/manager";
import { decorateFontSpans } from "../fonts/render";
import { isValidSyntaxTreeLabel, type SyntaxTreeNode } from "./model";

export interface SyntaxTreeActions {
  /**
   * Called after a graphical edit. The receiver is responsible for writing the
   * serialized tree back to Markdown (the Live Preview widget dispatches a
   * CodeMirror change).
   */
  onChange?: (tree: SyntaxTreeNode) => void;
}

interface NodeContext {
  node: SyntaxTreeNode;
  parent: SyntaxTreeNode | null;
  item: HTMLDivElement;
  label: HTMLSpanElement;
}

export function renderSyntaxTree(
  root: SyntaxTreeNode,
  manager: FontManager,
  doc: Document = document,
  actions: SyntaxTreeActions = {}
): HTMLElement {
  const block = doc.createElement("div");
  block.className = "langscape-tree-block";

  const tree = doc.createElement("div");
  tree.className = "langscape-tree";
  tree.setAttribute("role", actions.onChange ? "tree" : "img");

  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("langscape-tree-edges");
  svg.setAttribute("aria-hidden", "true");
  tree.appendChild(svg);

  const byItem = new Map<HTMLElement, SyntaxTreeNode>();
  const editable = Boolean(actions.onChange);

  let currentDrag:
    | {
        node: SyntaxTreeNode;
        parent: SyntaxTreeNode;
        source: HTMLDivElement;
        ghost: HTMLDivElement;
        target: { node: SyntaxTreeNode; item: HTMLElement } | null;
      }
    | null = null;

  const redrawEdges = () => drawEdges(tree, svg);

  const notify = () => {
    if (!actions.onChange) return;
    actions.onChange(root);
  };

  const beginEdit = (context: NodeContext) => {
    if (!editable || context.label.dataset.editing === "true") return;
    context.label.dataset.editing = "true";
    const input = doc.createElement("input");
    input.type = "text";
    input.className = "langscape-tree-edit";
    input.value = context.node.label;
    input.size = Math.max(4, Math.min(24, context.node.label.length + 2));
    context.label.replaceWith(input);

    let finished = false;
    const restoreLabel = () => {
      if (!input.isConnected) return;
      input.replaceWith(context.label);
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
      if (!next || !isValidSyntaxTreeLabel(next)) {
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

    input.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
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

  const startDrag = (
    context: NodeContext,
    event: PointerEvent
  ): boolean => {
    if (!editable || !context.parent || currentDrag) return false;
    const ghost = doc.createElement("div");
    ghost.className = "langscape-tree-drag-ghost";
    ghost.textContent = context.node.label;
    ghost.style.left = `${event.clientX + 12}px`;
    ghost.style.top = `${event.clientY + 12}px`;
    doc.body.appendChild(ghost);
    context.item.classList.add("is-dragging");
    currentDrag = {
      node: context.node,
      parent: context.parent,
      source: context.item,
      ghost,
      target: null,
    };
    return true;
  };

  const updateDrag = (event: PointerEvent) => {
    const drag = currentDrag;
    if (!drag) return;
    drag.ghost.style.left = `${event.clientX + 12}px`;
    drag.ghost.style.top = `${event.clientY + 12}px`;

    const under = doc.elementFromPoint(event.clientX, event.clientY);
    const item = under?.closest<HTMLElement>(".langscape-tree-node") ?? null;
    const targetNode = item ? byItem.get(item) : undefined;
    const valid =
      item &&
      targetNode &&
      targetNode !== drag.node &&
      !isDescendant(drag.node, targetNode);

    if (drag.target?.item !== item) {
      drag.target?.item.classList.remove("is-drop-target");
      drag.target = null;
    }
    if (valid && item && targetNode) {
      drag.target = { node: targetNode, item };
      item.classList.add("is-drop-target");
    }
  };

  const finishDrag = (dropped: boolean) => {
    const drag = currentDrag;
    if (!drag) return;
    currentDrag = null;
    drag.ghost.remove();
    drag.source.classList.remove("is-dragging");
    drag.target?.item.classList.remove("is-drop-target");

    if (!dropped || !drag.target) return;
    const index = drag.parent.children.indexOf(drag.node);
    if (index < 0) return;
    drag.parent.children.splice(index, 1);
    drag.target.node.children.push(drag.node);
    notify();
  };

  const bindLabel = (context: NodeContext) => {
    if (!editable) return;
    const { label } = context;
    label.tabIndex = 0;
    label.setAttribute("role", "button");

    label.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startY = event.clientY;
      let dragging = false;
      let finished = false;

      const move = (moveEvent: PointerEvent) => {
        if (finished) return;
        if (!dragging) {
          if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) {
            return;
          }
          dragging = startDrag(context, moveEvent);
          if (!dragging) return;
        }
        moveEvent.preventDefault();
        moveEvent.stopPropagation();
        updateDrag(moveEvent);
      };
      const end = (endEvent: PointerEvent) => {
        if (finished) return;
        finished = true;
        label.removeEventListener("pointermove", move);
        label.removeEventListener("pointerup", end);
        label.removeEventListener("pointercancel", cancel);
        try {
          if (label.hasPointerCapture?.(endEvent.pointerId)) {
            label.releasePointerCapture(endEvent.pointerId);
          }
        } catch {
          // Pointer capture is an enhancement; editing still works without it.
        }
        if (dragging) {
          endEvent.preventDefault();
          finishDrag(true);
        } else {
          beginEdit(context);
        }
      };
      const cancel = () => {
        if (finished) return;
        finished = true;
        label.removeEventListener("pointermove", move);
        label.removeEventListener("pointerup", end);
        label.removeEventListener("pointercancel", cancel);
        finishDrag(false);
      };

      try {
        label.setPointerCapture?.(event.pointerId);
      } catch {
        // Pointer capture is an enhancement; editing still works without it.
      }
      label.addEventListener("pointermove", move);
      label.addEventListener("pointerup", end);
      label.addEventListener("pointercancel", cancel);
    });

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

    const context: NodeContext = { node, parent, item, label };
    byItem.set(item, node);
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
        node.children.push({ label: "X", children: [] });
        notify();
      });
      row.appendChild(add);
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
  block.appendChild(tree);

  const schedule = () => {
    const win = doc.defaultView;
    if (win?.requestAnimationFrame) {
      win.requestAnimationFrame(() => {
        win.requestAnimationFrame(redrawEdges);
      });
    } else {
      setTimeout(redrawEdges, 0);
    }
  };
  schedule();

  const ResizeObserverCtor = doc.defaultView?.ResizeObserver;
  if (ResizeObserverCtor) {
    const observer = new ResizeObserverCtor(() => redrawEdges());
    observer.observe(tree);
  }

  return block;
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
  label.textContent = text;
  // Node labels can contain {nickname: text} font spans. A Live Preview
  // widget lives inside CodeMirror's contenteditable, so include editable
  // nodes here.
  decorateFontSpans(label, manager, doc, { includeEditable: true });
}

function isDescendant(ancestor: SyntaxTreeNode, node: SyntaxTreeNode): boolean {
  for (const child of ancestor.children) {
    if (child === node || isDescendant(child, node)) return true;
  }
  return false;
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

