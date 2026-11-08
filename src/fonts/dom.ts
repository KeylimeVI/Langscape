import type { App } from "obsidian";
import type { FontManager } from "./manager";
import { decorateFontSpans } from "./render";

const FONT_DOM_SELECTORS = [
  ".bases-view",
  ".bases-embed",
  ".bases-container",
  ".bases-table",
  ".bases-cards-container",
  ".excalidraw-md-host",
].join(",");

/**
 * Bases and Excalidraw's embedded Markdown are rendered outside Obsidian's
 * Markdown post-processor pipeline. Watch for their roots and decorate font
 * spans inside them as they appear.
 */
export class FontDomDecorator {
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly app: App,
    private readonly manager: FontManager
  ) {}

  start(): void {
    const doc = this.app.workspace.containerEl?.ownerDocument ?? document;
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
    const doc = this.app.workspace.containerEl?.ownerDocument ?? document;
    for (const root of doc.querySelectorAll<HTMLElement>(FONT_DOM_SELECTORS)) {
      decorateFontSpans(root, this.manager);
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.scan();
    }, 120);
  }
}
