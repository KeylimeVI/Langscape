import { App, Modal, Setting } from "obsidian";
import type { FontRecord } from "./css";
import type { FontManager } from "./manager";
import { formatFontSpan } from "./spans";

export interface FontPickerOptions {
  manager: FontManager;
  initialText?: string;
  onChoose: (markup: string, record: FontRecord) => void;
}

export class FontPickerModal extends Modal {
  private query = "";
  private listEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly options: FontPickerOptions
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("langscape-font-picker");
    contentEl.createEl("h2", { text: "Insert custom-font text" });
    contentEl.createEl("p", {
      cls: "langscape-muted",
      text: "Pick a font from your vault. The inserted markup works in Live Preview, Reading view, and exported HTML.",
    });

    new Setting(contentEl)
      .setName("Search")
      .addText((text) =>
        text.setPlaceholder("Filter fonts…").onChange((value) => {
          this.query = value.toLowerCase().trim();
          this.renderList();
        })
      );

    this.listEl = contentEl.createDiv({ cls: "langscape-font-list" });
    this.renderList();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderList(): void {
    const list = this.listEl;
    if (!list) return;
    list.empty();
    const fonts = this.options.manager
      .list()
      .filter((font) => {
        if (!this.query) return true;
        return (
          font.displayName.toLowerCase().includes(this.query) ||
          font.family.toLowerCase().includes(this.query)
        );
      });

    if (fonts.length === 0) {
      list.createDiv({
        cls: "langscape-empty",
        text: this.options.manager.list().length
          ? "No fonts match that search."
          : "No fonts found yet. Drop a .ttf/.otf/.woff/.woff2 file anywhere in the vault.",
      });
      return;
    }

    for (const font of fonts) {
      const row = list.createDiv({ cls: "langscape-font-row" });
      const preview = row.createDiv({ cls: `langscape-font-preview ${font.className}` });
      preview.textContent = this.options.manager.sampleFor(font);
      const meta = row.createDiv({ cls: "langscape-font-meta" });
      meta.createDiv({ cls: "langscape-font-name", text: font.displayName });
      if (font.nickname) {
        meta.createDiv({
          cls: "langscape-font-nickname",
          text: `{${font.nickname}: text}`,
        });
      }
      meta.createDiv({
        cls: "langscape-font-source",
        text: font.source === "vault" ? font.path ?? "vault font" : font.url ?? "web font",
      });
      const button = row.createEl("button", {
        cls: "mod-cta",
        text: "Insert",
      });
      button.addEventListener("click", () => this.choose(font));
      row.addEventListener("dblclick", () => this.choose(font));
    }
  }

  private choose(font: FontRecord): void {
    const content = this.options.initialText?.trim() || "text";
    this.options.onChoose(formatFontSpan(font.nickname || font.displayName, content), font);
    this.close();
  }
}
