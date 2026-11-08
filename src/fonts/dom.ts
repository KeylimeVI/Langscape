import type { App } from "obsidian";
import type { FontManager } from "./manager";
import { decorateFontSpans } from "./render";

const FONT_DOM_SELECTORS = [
  ".bases-view",
  ".bases-embed",
  ".bases-container",
  ".bases-table",
  ".bases-cards-container",
].join(",");

const EDITABLE_SELECTOR = '[contenteditable="true"]';

/**
 * Bases renders table/card values outside Obsidian's Markdown post-processor
 * pipeline. Watches Bases roots and decorates font spans there.
 *
 * Bases metadata cells are always contenteditable. Decoration is safe while
 * the cell is idle, but it strips the markup from the DOM. If Bases starts an
 * edit from that DOM it would save "abc" instead of "{font: abc}". To prevent
 * that, the original text is restored on pointerdown/focus and the cell is
 * re-decorated after blur.
 */
export class FontDomDecorator {
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly prepared = new WeakSet<HTMLElement>();

  constructor(
    private readonly app: App,
    private readonly manager: FontManager
  ) {}

  start(): void {
    const doc = this.doc();
    if (!doc?.body) return;
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(doc.body, { childList: true, subtree: true });
    this.schedule();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Exposed for tests and for a manual refresh after a font rescan. */
  scan(): void {
    const doc = this.doc();
    for (const root of doc.querySelectorAll<HTMLElement>(FONT_DOM_SELECTORS)) {
      // Non-editable Bases content, such as card labels and rendered values.
      decorateFontSpans(root, this.manager);

      // Metadata cells are contenteditable even while idle.
      for (const editor of root.querySelectorAll<HTMLElement>(EDITABLE_SELECTOR)) {
        if (this.containsActive(editor, doc)) continue;
        if (editor.dataset.langscapeSource !== undefined) continue;
        const source = editor.textContent ?? "";
        if (!source.includes("{") && !source.includes("'''")) continue;
        editor.dataset.langscapeSource = source;
        decorateFontSpans(editor, this.manager, doc, { includeEditable: true });
        this.prepare(editor);
      }
    }
  }

  private prepare(editor: HTMLElement): void {
    if (this.prepared.has(editor)) return;
    this.prepared.add(editor);
    editor.addEventListener(
      "pointerdown",
      () => this.restore(editor),
      true
    );
    editor.addEventListener(
      "focus",
      () => this.restore(editor),
      true
    );
    editor.addEventListener(
      "blur",
      () => this.schedule(),
      true
    );
  }

  private restore(editor: HTMLElement): void {
    const source = editor.dataset.langscapeSource;
    if (source === undefined) return;
    editor.textContent = source;
    delete editor.dataset.langscapeSource;
  }

  private containsActive(editor: HTMLElement, doc: Document): boolean {
    const active = doc.activeElement;
    return Boolean(active && (active === editor || editor.contains(active)));
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.scan();
    }, 120);
  }

  private doc(): Document {
    return this.app.workspace.containerEl?.ownerDocument ?? document;
  }
}
