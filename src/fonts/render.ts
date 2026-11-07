import type { App, MarkdownPostProcessorContext } from "obsidian";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type EditorState } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { FontManager } from "./manager";
import { findFontSpans, parseFontSpanSegments } from "./spans";

/**
 * Reading view / exported HTML: rewrite `{font:Name|text}` in text nodes.
 * Markdown already turned everything around it into elements, so walking text
 * nodes is safer than regexing HTML and preserves links, emphasis, etc.
 */
export function decorateFontSpans(
  root: HTMLElement,
  manager: FontManager,
  doc: Document = root.ownerDocument
): void {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("code, pre, script, style, textarea, .langscape-font")) {
        return NodeFilter.FILTER_REJECT;
      }
      return node.nodeValue?.includes("{font:") || node.nodeValue?.includes("\\{font:")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  for (const node of nodes) {
    const text = node.nodeValue ?? "";
    if (!text.includes("{font:")) continue;
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
        fragment.appendChild(doc.createTextNode(`{font:${segment.name}|${segment.text}}`));
        continue;
      }
      const span = doc.createElement("span");
      span.className = `langscape-font ${record.className}`;
      span.dataset.langscapeFont = record.displayName;
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
  el.dataset.langscapeFont = record.displayName;
}

/** Live Preview / source mode font decoration. */
/**
 * Live Preview does not run markdown post-processors for ordinary text, so a
 * note-level `langscape-font` frontmatter value needs an editor extension.
 */
export function createNoteFontExtension(manager: FontManager) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;

      constructor(view: EditorView) {
        this.refresh(view);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged) this.refresh(update.view);
      }

      private refresh(view: EditorView): void {
        const head = view.state.doc.sliceString(0, 4096);
        const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head)?.[1];
        let requested: string | undefined;
        if (frontmatter) {
          for (const line of frontmatter.split(/\r?\n/)) {
            const match = /^langscape-font:\s*(.+?)\s*$/.exec(line);
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
        this.decorations = Decoration.set([
          Decoration.mark({ class: record.className }).range(0, view.state.doc.length),
        ]);
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

function isInCode(state: EditorState, position: number): boolean {
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

function build(view: EditorView, manager: FontManager): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const selection = state.selection.ranges;

  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to);
    for (const span of findFontSpans(text)) {
      const record = manager.find(span.name);
      if (!record) continue;
      const start = from + span.start;
      if (isInCode(state, start)) continue;
      const contentStart = from + span.contentStart;
      const contentEnd = from + span.contentEnd;
      const end = from + span.end;

      const cursorInside = selection.some(
        (range) => range.from <= end && range.to >= start
      );

      if (!cursorInside && contentStart > start) {
        builder.add(start, contentStart, Decoration.replace({}));
      }
      if (contentEnd > contentStart) {
        builder.add(
          contentStart,
          contentEnd,
          Decoration.mark({
            class: `langscape-font ${record.className}`,
            attributes: { "data-langscape-font": record.displayName },
          })
        );
      }
      if (!cursorInside && end > contentEnd) {
        builder.add(contentEnd, end, Decoration.replace({}));
      }
    }
  }

  return builder.finish();
}

/** Register the post-processor; returns a function for easy testing. */
export function createFontPostProcessor(manager: FontManager, app: App) {
  return (el: HTMLElement, context: MarkdownPostProcessorContext): void => {
    applyFrontmatterFont(el, context.frontmatter, manager);
    decorateFontSpans(el, manager);
    // Avoid an unused parameter warning while keeping the app dependency
    // explicit for future per-source resolution (e.g. embedded notes).
    void app;
  };
}
