import type { MarkdownPostProcessorContext } from "obsidian";
import { StateEffect } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { FontManager } from "./manager";
import { fontFamilyAttribute, fontFamilyValue } from "./css";
import { isInCode } from "../utils/codemirror";
import { findFontSpans, formatFontSpan, parseFontSpanSegments } from "./spans";

/** Dispatched when vault fonts or nicknames change so open editors re-decorate. */
export const refreshFontViews = StateEffect.define<null>();

function hasFontRefreshEffect(update: ViewUpdate): boolean {
  return update.transactions.some((tr) =>
    tr.effects.some((effect) => effect.is(refreshFontViews))
  );
}

/**
 * Reading view / exported HTML: rewrite inline font spans in text nodes.
 * Markdown already turned everything around it into elements, so walking text
 * nodes is safer than regexing HTML and preserves links, emphasis, etc.
 */
function hasFontMarkup(text: string): boolean {
  return (
    text.includes("{font:") ||
    /\{\s*[^{}:\n]+\s*:/.test(text) ||
    text.includes("'''") ||
    text.includes("\\'''")
  );
}

export interface FontDecorateOptions {
  /** Bases metadata cells are contenteditable even when not actively edited. */
  includeEditable?: boolean;
}

export function decorateFontSpans(
  root: HTMLElement,
  manager: FontManager,
  doc: Document = root.ownerDocument,
  options: FontDecorateOptions = {}
): void {
  manager.attachDocument?.(doc);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("code, pre, script, style, textarea, .langscape-font")) {
        return NodeFilter.FILTER_REJECT;
      }
      if (!options.includeEditable && isEditable(parent)) {
        return NodeFilter.FILTER_REJECT;
      }
      return hasFontMarkup(node.nodeValue ?? "")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  for (const node of nodes) {
    const text = node.nodeValue ?? "";
    if (!hasFontMarkup(text)) continue;
    const segments = parseFontSpanSegments(text, (name) => Boolean(manager.find(name)));
    if (segments.length === 1 && segments[0].type === "text") {
      if (segments[0].text !== text) node.nodeValue = segments[0].text;
      continue;
    }
    const fragment = doc.createDocumentFragment();
    for (const segment of segments) {
      if (segment.type === "text") {
        fragment.appendChild(doc.createTextNode(segment.text));
        continue;
      }
      const record = segment.name ? manager.find(segment.name) : undefined;
      if (!record) {
        fragment.appendChild(doc.createTextNode(formatFontSpan(segment.name ?? "", segment.text)));
        continue;
      }
      const span = doc.createElement("span");
      span.className = `langscape-font ${record.className}`;
      span.setAttribute("style", fontFamilyAttribute(record));
      span.dataset.langscapeFont = record.displayName;
      span.setAttribute("spellcheck", "false");
      span.textContent = segment.text;
      fragment.appendChild(span);
    }
    node.replaceWith(fragment);
  }
}

/** Apply a note-level font declared in frontmatter. */
export function applyFrontmatterFont(
  el: HTMLElement,
  frontmatter: Record<string, unknown> | undefined,
  manager: FontManager
): void {
  if (!frontmatter) return;
  const requested = frontmatter["langscape-font"] ?? frontmatter["langscape_font"];
  if (typeof requested !== "string" || !requested.trim()) return;
  const record = manager.find(requested);
  if (!record) return;
  el.classList.add("langscape-note-font", record.className);
  el.setCssProps({ "--langscape-font-family": fontFamilyValue(record) });
  el.dataset.langscapeFont = record.displayName;
}

/**
 * Live Preview does not run markdown post-processors for ordinary text, so a
 * note-level `langscape-font` frontmatter value needs an editor extension.
 */
export function createNoteFontExtension(manager: FontManager) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;

      constructor(view: EditorView) {
        manager.attachDocument?.(view.dom.ownerDocument);
        this.refresh(view);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || hasFontRefreshEffect(update)) {
          manager.attachDocument?.(update.view.dom.ownerDocument);
          this.refresh(update.view);
        }
      }

      private refresh(view: EditorView): void {
        const head = view.state.doc.sliceString(0, 4096);
        const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head)?.[1];
        let requested: string | undefined;
        if (frontmatter) {
          for (const line of frontmatter.split(/\r?\n/)) {
            const match = /^(?:langscape-font|langscape_font):\s*(.+?)\s*$/.exec(line);
            if (match) {
              requested = match[1].replace(/^["']|["']$/g, "").trim();
              break;
            }
          }
        }
        const record = requested ? manager.find(requested) : undefined;
        if (!record || view.state.doc.length === 0) {
          this.decorations = Decoration.none;
          return;
        }
        const decorations = [
          Decoration.mark({
            class: `langscape-note-font ${record.className}`,
            attributes: { style: fontFamilyAttribute(record) },
          }).range(0, view.state.doc.length),
        ];
        for (let line = 1; line <= view.state.doc.lines; line++) {
          decorations.push(
            Decoration.line({ attributes: { spellcheck: "false" } }).range(
              view.state.doc.line(line).from
            )
          );
        }
        this.decorations = Decoration.set(decorations, true);
      }
    },
    {
      decorations: (value) => value.decorations,
    }
  );
}

export function createFontLivePreviewExtension(manager: FontManager) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        manager.attachDocument?.(view.dom.ownerDocument);
        this.decorations = build(view, manager);
      }

      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          hasFontRefreshEffect(update)
        ) {
          manager.attachDocument?.(update.view.dom.ownerDocument);
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
  const fontLines = new Set<number>();
  const { state } = view;
  const selection = state.selection.ranges;
  // Table cells are edited in their own CodeMirror views. Obsidian includes
  // this extension there, but the cursor is necessarily on the cell line while
  // typing. Always show the rendered font in a table cell instead of dropping
  // back to raw {font: ...} markup.
  const inTableCell = view.dom.closest(".cm-table-widget, .table-cell-wrapper") !== null;

  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to);
    for (const span of findFontSpans(text)) {
      const record = manager.find(span.name);
      if (!record) continue;
      const start = from + span.start;
      if (isInCode(state, start)) continue;
      // A complete syntax-tree line is rendered by the tree widget. Do not
      // decorate its font markup in the source line as well.
      if (state.doc.lineAt(start).text.trim().startsWith("{tree:")) continue;
      const contentStart = from + span.contentStart;
      const contentEnd = from + span.contentEnd;
      const end = from + span.end;
      const lineStart = state.doc.lineAt(start).from;
      fontLines.add(lineStart);

      const cursorInside = inTableCell
        ? false
        : selection.some((range) => range.from <= end && range.to >= start);

      if (!cursorInside && contentStart > start) {
        decorations.push({
          from: start,
          to: contentStart,
          decoration: Decoration.replace({}),
        });
      }
      if (contentEnd > contentStart) {
        decorations.push({
          from: contentStart,
          to: contentEnd,
          decoration: Decoration.mark({
            class: `langscape-font ${record.className}`,
            attributes: {
              "data-langscape-font": record.displayName,
              style: fontFamilyAttribute(record),
              spellcheck: "false",
            },
          }),
        });
      }
      if (!cursorInside && end > contentEnd) {
        decorations.push({
          from: contentEnd,
          to: end,
          decoration: Decoration.replace({}),
        });
      }
    }
  }

  for (const from of fontLines) {
    decorations.push({
      from,
      to: from,
      decoration: Decoration.line({ attributes: { spellcheck: "false" } }),
    });
  }
  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(
    decorations.map((entry) => entry.decoration.range(entry.from, entry.to)),
    true
  );
}

function isEditable(element: HTMLElement): boolean {
  const editable = element.closest<HTMLElement>(
    '[contenteditable], input, textarea, [role="textbox"]'
  );
  if (!editable) return false;
  const win = editable.ownerDocument.defaultView;
  if (win && (editable instanceof win.HTMLInputElement || editable instanceof win.HTMLTextAreaElement)) {
    return true;
  }
  return editable.getAttribute("contenteditable") !== "false";
}

/** Register the post-processor; returns a function for easy testing. */
export function createFontPostProcessor(manager: FontManager) {
  return (el: HTMLElement, context: MarkdownPostProcessorContext): void => {
    manager.attachDocument?.(el.ownerDocument);
    applyFrontmatterFont(el, context.frontmatter, manager);
    decorateFontSpans(el, manager);
  };
}
