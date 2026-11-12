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
  /** Remove the whole tree. Used by the root node's delete control. */
  onRemove?: () => void;
  /** Confirm deletion of a subtree with two or more nodes. */
  confirmDelete?: (node: SyntaxTreeNode, count: number) => boolean | Promise<boolean>;
}

interface NodeContext {
  node: SyntaxTreeNode;
  parent: SyntaxTreeNode | null;
  item: HTMLDivElement;
  row: HTMLDivElement;
  label: HTMLSpanElement;
}

type DropMode = "child" | "before" | "after";
type TreeAlignment = "center" | "left";

interface DragState {
  node: SyntaxTreeNode;
  parent: SyntaxTreeNode;
  source: HTMLDivElement;
  ghost: HTMLDivElement;
  target: {
    node: SyntaxTreeNode;
    item: HTMLDivElement;
    mode: DropMode;
  } | null;
}

const ALIGNMENT_KEY = "langscape-tree-alignment";
let treeAlignment: TreeAlignment | null = null;

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

  const byItem = new Map<HTMLElement, SyntaxTreeNode>();
  const parentByNode = new Map<SyntaxTreeNode, SyntaxTreeNode | null>();
  const editable = Boolean(actions.onChange);

  let currentDrag: DragState | null = null;

  const redrawEdges = () => drawEdges(tree, svg);

  const notify = () => {
    if (!actions.onChange) return;
    actions.onChange(root);
  };

  const setAlignment = (next: TreeAlignment) => {
    treeAlignment = next;
    try {
      doc.defaultView?.localStorage?.setItem(ALIGNMENT_KEY, next);
    } catch {
      // Storage can be unavailable in restricted windows; the toggle still works.
    }
    for (const blockEl of doc.querySelectorAll<HTMLElement>(".langscape-tree-block")) {
      const candidate = blockEl.querySelector<HTMLElement>(".langscape-tree");
      if (!candidate) continue;
      candidate.classList.toggle("is-align-left", next === "left");
      const button = blockEl.querySelector<HTMLButtonElement>(".langscape-tree-align");
      if (button) setAlignmentIcon(button, next);
      const candidateSvg = candidate.querySelector<SVGSVGElement>(".langscape-tree-edges");
      if (candidateSvg) drawEdges(candidate, candidateSvg);
    }
  };

  alignButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  alignButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setAlignment(alignmentFor(doc) === "left" ? "center" : "left");
  });

  const alignment = alignmentFor(doc);
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
    context.label.style.visibility = "hidden";
    // Keep the input outside CodeMirror. A native input nested in the CM
    // contenteditable leaks keystrokes into the Markdown source.
    doc.body.appendChild(input);

    let finished = false;
    const restoreLabel = () => {
      input.remove();
      context.label.style.visibility = "";
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

  const startDrag = (context: NodeContext, event: PointerEvent): boolean => {
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
    const targetParent = targetNode ? parentByNode.get(targetNode) : null;
    const label = item?.querySelector<HTMLElement>(
      ":scope > .langscape-tree-label-row > .langscape-tree-label"
    );
    const rect = label?.getBoundingClientRect();

    let mode: DropMode = "child";
    if (
      targetNode &&
      targetParent &&
      rect &&
      rect.width > 0 &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    ) {
      const ratio = (event.clientX - rect.left) / rect.width;
      if (ratio < 0.28) mode = "before";
      else if (ratio > 0.72) mode = "after";
    }

    const valid =
      item &&
      targetNode &&
      targetNode !== drag.node &&
      !isDescendant(drag.node, targetNode) &&
      (mode === "child" || Boolean(targetParent));

    if (drag.target?.item !== item || drag.target?.mode !== mode) {
      clearDropClasses(drag.target?.item);
      drag.target = null;
    }
    if (valid && item && targetNode) {
      drag.target = { node: targetNode, item: item as HTMLDivElement, mode };
      item.classList.add("is-drop-target", `is-drop-${mode}`);
    }
  };

  const finishDrag = (dropped: boolean) => {
    const drag = currentDrag;
    if (!drag) return;
    currentDrag = null;
    drag.ghost.remove();
    drag.source.classList.remove("is-dragging");
    clearDropClasses(drag.target?.item);

    if (!dropped || !drag.target) return;
    const target = drag.target;
    const newParent =
      target.mode === "child" ? target.node : parentByNode.get(target.node) ?? null;
    if (!newParent || newParent === drag.node || isDescendant(drag.node, newParent)) {
      return;
    }

    const oldIndex = drag.parent.children.indexOf(drag.node);
    if (oldIndex < 0) return;
    drag.parent.children.splice(oldIndex, 1);

    let index: number;
    if (target.mode === "child") {
      index = newParent.children.length;
    } else {
      index = newParent.children.indexOf(target.node);
      if (index < 0) {
        // Target disappeared mid-drag; put the node back where it was.
        drag.parent.children.splice(oldIndex, 0, drag.node);
        return;
      }
      if (target.mode === "after") index++;
    }
    newParent.children.splice(index, 0, drag.node);
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

    const context: NodeContext = { node, parent, item, row, label };
    byItem.set(item, node);
    parentByNode.set(node, parent);
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

function alignmentFor(doc: Document): TreeAlignment {
  if (treeAlignment) return treeAlignment;
  try {
    treeAlignment =
      doc.defaultView?.localStorage?.getItem(ALIGNMENT_KEY) === "left" ? "left" : "center";
  } catch {
    treeAlignment = "center";
  }
  return treeAlignment;
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

function clearDropClasses(item: HTMLElement | undefined): void {
  item?.classList.remove("is-drop-target", "is-drop-child", "is-drop-before", "is-drop-after");
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
