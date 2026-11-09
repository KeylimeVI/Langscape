import { syntaxTree } from "@codemirror/language";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { FontManager } from "../fonts/manager";
import { parseSyntaxTreeLine, type SyntaxTreeNode } from "./model";
import { renderSyntaxTree } from "./render";

class SyntaxTreeWidget extends WidgetType {
  constructor(
    private readonly tree: SyntaxTreeNode,
    private readonly manager: FontManager,
    private readonly from: number,
    private readonly revision: number
  ) {
    super();
  }

  eq(other: SyntaxTreeWidget): boolean {
    return (
      other.from === this.from &&
      other.revision === this.revision &&
      JSON.stringify(other.tree) === JSON.stringify(this.tree)
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const el = renderSyntaxTree(this.tree, this.manager, view.dom.ownerDocument);
    el.classList.add("langscape-tree-widget");
    el.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    return el;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export function createSyntaxTreeExtension(manager: FontManager) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = build(view, manager);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = build(update.view, manager);
        }
      }
    },
    {
      decorations: (value) => value.decorations,
    }
  );
}

function build(view: EditorView, manager: FontManager): DecorationSet {
  const decorations: Array<{ from: number; to: number; decoration: Decoration }> = [];
  const { state } = view;
  const selections = state.selection.ranges;

  for (const range of view.visibleRanges) {
    let line = state.doc.lineAt(range.from);
    while (line.from <= range.to) {
      const tree = parseSyntaxTreeLine(line.text);
      const cursorInside = selections.some(
        (selection) => selection.from <= line.to && selection.to >= line.from
      );
      if (tree && !cursorInside && !isInCode(state, line.from)) {
        // Obsidian forbids block decorations from plugins. Use an inline
        // widget at the line start and hide the source text with a mark.
        decorations.push({
          from: line.from,
          to: line.from,
          decoration: Decoration.widget({
            widget: new SyntaxTreeWidget(tree, manager, line.from, manager.version),
            side: 1,
          }),
        });
        if (line.to > line.from) {
          decorations.push({
            from: line.from,
            to: line.to,
            decoration: Decoration.mark({ class: "langscape-tree-source-hidden" }),
          });
        }
      }
      if (line.to >= state.doc.length) break;
      line = state.doc.lineAt(line.to + 1);
    }
  }

  return Decoration.set(
    decorations.map((entry) => entry.decoration.range(entry.from, entry.to)),
    true
  );
}

function isInCode(state: EditorView["state"], position: number): boolean {
  try {
    let node = syntaxTree(state).resolveInner(position, 1);
    while (node) {
      if (/code/i.test(node.name)) return true;
      node = node.parent as typeof node;
    }
  } catch {
    return false;
  }
  return false;
}
