import { ItemView, requestUrl, type Workspace, type WorkspaceLeaf } from "obsidian";
import { docsLocation, LEXURGY_DOCS_URL, loadDocsArticle, type DocsLocation, type DocsPage } from "./docs-content";

export const LEXURGY_DOCS_VIEW_TYPE = "langscape-lexurgy-docs";

export async function openLexurgyDocs(workspace: Workspace): Promise<void> {
  const existing = workspace.getLeavesOfType(LEXURGY_DOCS_VIEW_TYPE)[0];
  const leaf = existing ?? workspace.getLeaf("tab");
  if (!existing) await leaf.setViewState({ type: LEXURGY_DOCS_VIEW_TYPE, active: true });
  await workspace.revealLeaf(leaf);
}

const home: DocsLocation = { page: "", anchor: "" };

export class LexurgyDocsView extends ItemView {
  private readonly articles = new Map<DocsPage, DocumentFragment>();
  private articleEl!: HTMLElement;
  private sourceEl!: HTMLAnchorElement;
  private backButton!: HTMLButtonElement;
  private jumpEl!: HTMLSelectElement;
  private renderedPage: DocsPage | null = null;
  private current: DocsLocation = home;
  private readonly history: DocsLocation[] = [];
  private requestId = 0;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string { return LEXURGY_DOCS_VIEW_TYPE; }
  getDisplayText(): string { return "Lexurgy Docs"; }
  getIcon(): string { return "book-open"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("langscape-docs-view");
    const bar = root.createDiv({ cls: "langscape-docs-toolbar" });
    this.backButton = bar.createEl("button", { text: "Back" });
    this.backButton.addEventListener("click", () => {
      const previous = this.history.pop();
      if (previous) void this.show(previous);
    });
    const homeButton = bar.createEl("button", { text: "Contents" });
    homeButton.addEventListener("click", () => this.navigate(home));
    this.jumpEl = bar.createEl("select", {
      cls: "dropdown",
      attr: { "aria-label": "Jump to section" },
    });
    this.jumpEl.addEventListener("change", () => {
      if (this.jumpEl.value) this.navigate({ page: this.current.page, anchor: this.jumpEl.value });
    });
    this.sourceEl = bar.createEl("a", {
      text: "View online",
      attr: { target: "_blank", rel: "noopener noreferrer" },
    });
    this.articleEl = root.createDiv({ cls: "markdown-rendered langscape-docs-article" });
    this.articleEl.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
      if (!link || link.dataset.lexurgyExternal) return;
      const next = docsLocation(link.href, this.current.page);
      if (!next) return;
      event.preventDefault();
      this.navigate(next);
    });
    void this.show(home);
  }

  async onClose(): Promise<void> {
    this.requestId++;
    this.articles.clear();
    this.contentEl.empty();
  }

  private navigate(next: DocsLocation): void {
    if (next.page !== this.current.page || next.anchor !== this.current.anchor) {
      this.history.push(this.current);
    }
    void this.show(next);
  }

  private async show(location: DocsLocation): Promise<void> {
    const { page, anchor } = location;
    const requestId = ++this.requestId;
    this.current = location;
    this.backButton.disabled = this.history.length === 0;
    this.sourceEl.href = LEXURGY_DOCS_URL + page + (anchor ? `#${encodeURIComponent(anchor)}` : "");
    if (page !== this.renderedPage) {
      this.renderedPage = null;
      this.jumpEl.hidden = true;
      this.articleEl.empty();
      this.articleEl.createEl("p", { text: "Loading Lexurgy documentation…", attr: { role: "status" } });
      try {
        let article = this.articles.get(page);
        if (!article) {
          article = await loadDocsArticle(this.articleEl.ownerDocument, page, async (url) => {
            const response = await requestUrl({ url });
            return response.text;
          });
        }
        if (requestId !== this.requestId) return;
        this.articles.set(page, article);
        this.articleEl.replaceChildren(article.cloneNode(true));
        this.renderedPage = page;
        this.updateSections();
      } catch {
        if (requestId !== this.requestId) return;
        this.articleEl.empty();
        this.articleEl.createEl("p", {
          text: "Could not load the Lexurgy documentation. Check your connection, try again, or use View online.",
          attr: { role: "status" },
        });
        this.articleEl.createEl("button", { text: "Retry" })
          .addEventListener("click", () => void this.show(location));
        return;
      }
    }
    this.jumpEl.value = anchor;
    const heading = Array.from(this.articleEl.querySelectorAll<HTMLElement>("[data-lexurgy-anchor]"))
      .find((el) => el.dataset.lexurgyAnchor === anchor);
    if (heading) heading.scrollIntoView({ block: "start" });
    else this.articleEl.scrollTop = 0;
  }

  private updateSections(): void {
    const sections = Array.from(this.articleEl.querySelectorAll<HTMLElement>("[data-lexurgy-anchor]"));
    this.jumpEl.empty();
    const placeholder = this.jumpEl.createEl("option", { text: "Jump to section", value: "" });
    placeholder.disabled = true;
    for (const heading of sections) {
      this.jumpEl.createEl("option", { value: heading.dataset.lexurgyAnchor, text: heading.textContent ?? "" });
    }
    this.jumpEl.hidden = sections.length === 0;
  }
}
