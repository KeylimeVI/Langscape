import type { FontManager } from "../fonts/manager";
import { decorateFontSpans } from "../fonts/render";
import type { SyntaxTreeNode } from "./model";

export function renderSyntaxTree(
  root: SyntaxTreeNode,
  manager: FontManager,
  doc: Document = document
): HTMLElement {
  const block = doc.createElement("div");
  block.className = "langscape-tree-block";
  const tree = doc.createElement("div");
  tree.className = "langscape-tree";
  tree.setAttribute("role", "img");
  tree.setAttribute("aria-label", "Syntax tree");
  tree.appendChild(renderNode(root, manager, doc));
  block.appendChild(tree);
  return block;
}

function renderNode(
  node: SyntaxTreeNode,
  manager: FontManager,
  doc: Document
): HTMLDivElement {
  const item = doc.createElement("div");
  item.className = "langscape-tree-node";
  const label = doc.createElement("span");
  label.className = "langscape-tree-label";
  label.textContent = node.label;
  // Node labels can contain {nickname: text} font spans. A Live Preview
  // widget lives inside CodeMirror's contenteditable, so include editable
  // nodes here; tree labels themselves are read-only output.
  decorateFontSpans(label, manager, doc, { includeEditable: true });
  item.appendChild(label);

  if (node.children.length > 0) {
    const children = doc.createElement("div");
    children.className = "langscape-tree-children";
    for (const child of node.children) {
      children.appendChild(renderNode(child, manager, doc));
    }
    item.appendChild(children);
  }
  return item;
}
