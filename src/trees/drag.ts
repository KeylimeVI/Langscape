import type { SyntaxTreeNode } from "./model";

interface TreeDragNode {
  node: SyntaxTreeNode;
  parent: SyntaxTreeNode | null;
  item: HTMLElement;
  row: HTMLElement;
  label: HTMLElement;
}

type DropKind = "child" | "before" | "after";
interface DropZone {
  element: HTMLElement;
  anchor: TreeDragNode;
  kind: DropKind;
}
interface Destination {
  parent: SyntaxTreeNode;
  // Index after the source has been removed from its old parent.
  index: number;
}

const activeGestures = new WeakMap<HTMLElement, () => void>();
const dropDescriptions: Record<DropKind, string> = {
  child: "Add as last child",
  before: "Insert before",
  after: "Insert after",
};

export function cancelTreeDrag(block: HTMLElement): void {
  activeGestures.get(block)?.();
}

export function createTreeDrag(block: HTMLElement, onChange: () => void) {
  const doc = block.ownerDocument;
  const win = doc.defaultView;
  const zones: DropZone[] = [];

  const addNode = (anchor: TreeDragNode, edit: () => void): void => {
    zones.push({ element: anchor.label, anchor, kind: "child" });
    if (anchor.parent) {
      for (const kind of ["before", "after"] as const) {
        const element = anchor.row.createSpan({
          cls: `langscape-tree-drop-side is-${kind}`,
          attr: { "aria-hidden": "true" },
        });
        zones.push({ element, anchor, kind });
      }
    }

    anchor.label.addEventListener("pointerdown", (event) => {
      if (!win || event.button !== 0 || activeGestures.has(block)) return;
      event.preventDefault();
      event.stopPropagation();

      const { label, item, node, parent } = anchor;
      const { clientX: startX, clientY: startY, pointerId } = event;
      const distance = (pointer: PointerEvent) =>
        Math.hypot(pointer.clientX - startX, pointer.clientY - startY);
      const targets = new Map<Element, { zone: DropZone; destination: Destination }>();
      let preview: HTMLElement | null = null;
      let hint: HTMLElement | null = null;
      let highlighted: DropZone | null = null;
      const start = () => {
        if (!parent) return;
        const oldIndex = parent.children.indexOf(node);
        if (oldIndex === -1) return;
        for (const zone of zones) {
          const target = zone.anchor.node;
          // Don't activate anything in the moved branch, including its side slots.
          if (item.contains(zone.anchor.item)) continue;
          const newParent = zone.kind === "child" ? target : zone.anchor.parent;
          if (!newParent) continue;
          const siblingIndex = newParent.children.indexOf(target);
          if (zone.kind !== "child" && siblingIndex < 0) continue;
          let index = zone.kind === "child" ? newParent.children.length
            : siblingIndex + (zone.kind === "after" ? 1 : 0);
          if (newParent === parent && index > oldIndex) index--;
          if (newParent === parent && index === oldIndex) continue;
          targets.set(zone.element, { zone, destination: { parent: newParent, index } });
          zone.element.classList.add("is-tree-drop-zone");
        }
        block.classList.add("is-tree-dragging");
        item.classList.add("is-dragging-source");
        preview = doc.body.createDiv({
          cls: "langscape-tree-drag-preview",
          attr: { "aria-hidden": "true" },
        });
        const replica = label.cloneNode(true) as HTMLElement;
        replica.removeAttribute("tabindex");
        replica.removeAttribute("role");
        preview.appendChild(replica);
        hint = preview.createEl("small", { text: "Drop on a label or a side mark" });
      };

      const hit = (pointer: PointerEvent) => {
        const element = doc.elementFromPoint(pointer.clientX, pointer.clientY)
          ?.closest(".is-tree-drop-zone");
        return element ? targets.get(element) : undefined;
      };

      const move = (pointer: PointerEvent) => {
        if (pointer.pointerId !== pointerId) return;
        if (!preview && distance(pointer) >= 5) start();
        if (!preview || !hint) return;
        pointer.preventDefault();
        pointer.stopPropagation();
        const next = hit(pointer)?.zone ?? null;
        if (next !== highlighted) {
          highlighted?.element.classList.remove("is-tree-drop-active");
          next?.element.classList.add("is-tree-drop-active");
          highlighted = next;
          hint.textContent = next ? dropDescriptions[next.kind] : "Drop on a label or a side mark";
        }
        preview.style.left = `${Math.max(4, Math.min(pointer.clientX + 14, win.innerWidth - preview.offsetWidth - 4))}px`;
        preview.style.top = `${Math.max(4, pointer.clientY - preview.offsetHeight - 12)}px`;
      };

      const cancel = () => {
        activeGestures.delete(block);
        win.removeEventListener("pointermove", move, true);
        win.removeEventListener("pointerup", end, true);
        win.removeEventListener("pointercancel", pointerCancel, true);
        win.removeEventListener("keydown", key, true);
        win.removeEventListener("blur", cancel);
        label.removeEventListener("lostpointercapture", pointerCancel);
        if (label.hasPointerCapture?.(pointerId)) label.releasePointerCapture(pointerId);
        for (const element of targets.keys()) {
          element.classList.remove("is-tree-drop-zone", "is-tree-drop-active");
        }
        block.classList.remove("is-tree-dragging");
        item.classList.remove("is-dragging-source");
        preview?.remove();
      };

      const end = (pointer: PointerEvent) => {
        if (pointer.pointerId !== pointerId) return;
        pointer.preventDefault();
        pointer.stopPropagation();
        // Hit-test the final position against the same visible elements as hover.
        const destination = preview && hit(pointer)?.destination;
        const clicked = !preview && distance(pointer) < 5;
        cancel();
        if (clicked) edit();
        if (!destination || !parent) return;
        const index = parent.children.indexOf(node);
        if (index === -1) return;
        parent.children.splice(index, 1);
        destination.parent.children.splice(destination.index, 0, node);
        onChange();
      };

      const pointerCancel = (pointer: PointerEvent) => {
        if (pointer.pointerId === pointerId) cancel();
      };
      const key = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key !== "Escape") return;
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        cancel();
      };

      activeGestures.set(block, cancel);
      win.addEventListener("pointermove", move, true);
      win.addEventListener("pointerup", end, true);
      win.addEventListener("pointercancel", pointerCancel, true);
      win.addEventListener("keydown", key, true);
      win.addEventListener("blur", cancel);
      label.addEventListener("lostpointercapture", pointerCancel);
      try {
        label.setPointerCapture?.(pointerId);
      } catch {
        // The window listeners still track pointer events when capture is unavailable.
      }
    });
  };

  return { addNode };
}
