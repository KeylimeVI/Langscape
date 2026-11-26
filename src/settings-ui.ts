import { fontFamilyValue } from "./fonts/css";
import { Notice, PluginSettingTab, Setting, TFile, setIcon } from "obsidian";
import type { LexurgyService } from "./lexurgy/service";
import type LangscapePlugin from "./main";
import { JAVA_DOWNLOAD_URL } from "./lexurgy/java";
import { LEXURGY_RELEASES_URL, LEXURGY_SETUP_HINT } from "./lexurgy/setup";
import { confirmAction, promptText } from "./ui/modals";

export class LangscapeSettingTab extends PluginSettingTab {
  plugin: LangscapePlugin;
  private fontChangeUnsub: (() => void) | null = null;
  private fontListContainer: HTMLElement | null = null;

  constructor(plugin: LangscapePlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    this.unsubscribeFonts();
    containerEl.empty();
    containerEl.addClass("langscape-settings");

    // Obsidian 1.15+ renders Settings in its own window/Document, which does not
    // fire workspace "window-open". Attach it so FontFaces render in previews.
    this.plugin.fontManager.attachDocument(containerEl.ownerDocument);

    this.renderFonts();
    this.fontChangeUnsub = this.plugin.fontManager.onChange(() => {
      if (!this.fontListContainer?.isConnected) {
        this.unsubscribeFonts();
        return;
      }
      this.plugin.fontManager.attachDocument(this.fontListContainer.ownerDocument);
      this.renderFontList(this.fontListContainer);
    });
    if (this.plugin.lexurgy) this.renderLexurgy(this.plugin.lexurgy);
    else this.containerEl.createEl("p", {
      cls: "langscape-muted",
      text: "Lexurgy and sound-change recipes are available on desktop only.",
    });
    this.renderAbout();
  }

  hide(): void {
    this.unsubscribeFonts();
    this.fontListContainer = null;
  }

  private unsubscribeFonts(): void {
    this.fontChangeUnsub?.();
    this.fontChangeUnsub = null;
  }

  private renderFonts(): void {
    const { containerEl } = this;
    const heading = new Setting(containerEl).setName("Fonts").setHeading();
    heading.addButton((button) =>
      button.setButtonText("Rescan").onClick(async () => {
        await this.plugin.refreshFonts();
        new Notice(`Loaded ${this.plugin.fontManager.list().length} font(s).`);
        if (this.fontListContainer?.isConnected) {
          this.plugin.fontManager.attachDocument(this.fontListContainer.ownerDocument);
          this.renderFontList(this.fontListContainer);
        }
      })
    );
    containerEl.createEl("p", {
      cls: "langscape-muted",
      text: "Fonts are discovered everywhere in the vault. Set a short nickname to use {nickname: text} in notes.",
    });

    this.fontListContainer = containerEl.createDiv({ cls: "langscape-font-settings-host" });
    this.renderFontList(this.fontListContainer);
  }

  private renderFontList(host: HTMLElement): void {
    host.empty();
    const fonts = this.plugin.fontManager.list();
    if (fonts.length === 0) {
      host.createEl("p", {
        cls: "langscape-empty",
        text: "No fonts found. Drop a .ttf/.otf/.woff/.woff2 file anywhere in the vault, then press Rescan.",
      });
      return;
    }

    const list = host.createDiv({ cls: "langscape-font-settings-list" });
    for (const font of fonts) {
      const row = list.createDiv({ cls: "langscape-font-setting" });
      const preview = row.createDiv({
        cls: `langscape-font-setting-preview ${font.className}`,
      });
      preview.setCssProps({ "--langscape-font-family": fontFamilyValue(font) });
      preview.setText(this.plugin.fontManager.sampleFor(font));
      const info = row.createDiv({ cls: "langscape-font-setting-info" });
      info.createDiv({ cls: "langscape-font-setting-name", text: font.displayName });
      const code = font.nickname?.trim() || font.displayName.replace(/\s+/g, "-");
      info.createDiv({
        cls: "langscape-font-setting-nickname",
        text: `{${code}: text}`,
      });
      info.createDiv({
        cls: "langscape-font-setting-source",
        text: font.source === "vault" ? font.path ?? "vault" : font.url ?? "web",
      });
      if (font.loadStatus === "error" && font.loadError) {
        info.createDiv({
          cls: "langscape-font-setting-error",
          text: `Could not load font: ${font.loadError}`,
        });
      }
      const actions = row.createDiv({ cls: "langscape-font-setting-actions" });
      const nickname = actions.createEl("button", {
        cls: "clickable-icon",
        attr: { "aria-label": "Set font nickname" },
      });
      setIcon(nickname, "pencil");
      nickname.addEventListener("click", async () => {
        const value = await promptText(this.app, {
          title: "Font nickname",
          description:
            "A short code for {nickname: text}. Use letters, numbers, underscores, or hyphens; leave blank to use the font name.",
          value: font.nickname ?? "",
          placeholder: "tengwar",
          cta: "Save",
        });
        if (value === null) return;
        const clean = value.trim();
        if (clean && !/^[\p{L}\p{N}_-]+$/u.test(clean)) {
          new Notice("Nicknames can only contain letters, numbers, underscores, and hyphens.");
          return;
        }
        const key = font.path ?? font.customId ?? font.id;
        if (
          clean &&
          Object.entries(this.plugin.settings.fontNicknames).some(
            ([path, existing]) =>
              path !== key && existing.trim().toLowerCase() === clean.toLowerCase()
          )
        ) {
          new Notice("That font nickname is already in use.");
          return;
        }
        if (clean) this.plugin.settings.fontNicknames[key] = clean;
        else delete this.plugin.settings.fontNicknames[key];
        await this.plugin.saveSettings();
        await this.plugin.refreshFonts();
        if (this.fontListContainer?.isConnected) this.renderFontList(this.fontListContainer);
      });

      const customId = font.customId ?? font.id;
      const custom = this.plugin.settings.customFonts.find((entry) => entry.id === customId);
      const isVaultFont = font.source === "vault" && Boolean(font.path);
      if (isVaultFont || custom) {
        const remove = actions.createEl("button", {
          cls: "clickable-icon langscape-font-delete",
          attr: { "aria-label": isVaultFont ? "Delete font" : "Remove font" },
        });
        setIcon(remove, "trash-2");
        remove.addEventListener("click", async () => {
          const confirmed = await confirmAction(this.app, {
            title: isVaultFont
              ? `Delete "${font.displayName}"?`
              : `Remove "${font.displayName}"?`,
            body: isVaultFont
              ? `This moves "${font.path}" to trash.`
              : "This removes the font entry from Langscape settings.",
            confirmText: isVaultFont ? "Delete" : "Remove",
            warning: true,
          });
          if (!confirmed) return;

          try {
            if (isVaultFont && font.path) {
              const file = this.app.vault.getAbstractFileByPath(font.path);
              if (file instanceof TFile) {
                await this.app.fileManager.trashFile(file);
              }
              delete this.plugin.settings.fontNicknames[font.path];
              delete this.plugin.settings.fontAliases[font.path];
              this.plugin.settings.customFonts = this.plugin.settings.customFonts.filter(
                (entry) => entry.path !== font.path && entry.id !== custom?.id
              );
            } else if (custom) {
              this.plugin.settings.customFonts = this.plugin.settings.customFonts.filter(
                (entry) => entry.id !== custom.id
              );
              delete this.plugin.settings.fontNicknames[custom.id];
            }
            await this.plugin.saveSettings();
            await this.plugin.refreshFonts();
            new Notice(
              isVaultFont
                ? `Deleted "${font.displayName}".`
                : `Removed "${font.displayName}".`
            );
            if (this.fontListContainer?.isConnected) this.renderFontList(this.fontListContainer);
          } catch (error) {
            new Notice(
              `Could not delete font: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        });
      }
    }
  }

  private renderLexurgy(lexurgy: LexurgyService): void {
    const { containerEl } = this;
    new Setting(containerEl).setName("Lexurgy").setHeading();
    const status = containerEl.createDiv({ cls: "langscape-lexurgy-setting-status" });
    status.createDiv({ cls: "langscape-muted", text: "Checking…" });
    void this.refreshLexurgyStatus(lexurgy, status);

    containerEl.createEl("p", { cls: "langscape-muted", text: LEXURGY_SETUP_HINT });
    containerEl.createEl("a", {
      text: "Open official Lexurgy releases",
      href: LEXURGY_RELEASES_URL,
      attr: { target: "_blank", rel: "noopener noreferrer" },
    });
    new Setting(containerEl)
      .addButton((button) =>
        button.setButtonText("Test").onClick(async () => {
          try {
            const result = await lexurgy.testConnection();
            new Notice(`Lexurgy works (${result.version}).`);
            await this.refreshLexurgyStatus(lexurgy, status, true);
          } catch (error) {
            new Notice(
              `Lexurgy test failed: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        })
      );

    const advanced = containerEl.createEl("details", { cls: "langscape-settings-details" });
    advanced.createEl("summary", { text: "Advanced" });
    const body = advanced.createDiv({ cls: "langscape-settings-details-body" });

    new Setting(body)
      .setName("Java path")
      .setDesc("Blank uses JAVA_HOME or java on PATH.")
      .addText((text) =>
        text
          .setPlaceholder("/usr/bin/java")
          .setValue(this.plugin.settings.javaPath)
          .onChange(async (value) => {
            this.plugin.settings.javaPath = value.trim();
            await this.plugin.saveSettings();
            await lexurgy.restart();
            void this.refreshLexurgyStatus(lexurgy, status, true);
          })
      );

    new Setting(body)
      .setName("Lexurgy path")
      .setDesc("Install directory, bin script, or .jar.")
      .addText((text) =>
        text
          .setPlaceholder("/home/you/lexurgy")
          .setValue(this.plugin.settings.lexurgyPath)
          .onChange(async (value) => {
            this.plugin.settings.lexurgyPath = value.trim();
            await this.plugin.saveSettings();
            await lexurgy.restart();
            void this.refreshLexurgyStatus(lexurgy, status, true);
          })
      );

    body.createEl("p", {
      cls: "langscape-muted",
      text: "Lexurgy is a separate GPL-3.0 program and is not bundled with Langscape.",
    });
  }

  private async refreshLexurgyStatus(lexurgy: LexurgyService, parent: HTMLElement, force = false): Promise<void> {
    try {
      const env = await lexurgy.getEnvironment(force);
      parent.empty();
      const javaRow = parent.createDiv({ cls: "langscape-status-row" });
      javaRow.createSpan({ cls: "langscape-status-label", text: "Java" });
      if (env.java) {
        javaRow.createSpan({ cls: "langscape-ok", text: env.java.version });
      } else {
        javaRow.createSpan({ cls: "langscape-bad", text: "not found" });
        const java = javaRow.createEl("a", { text: "Get Java", href: JAVA_DOWNLOAD_URL });
        java.setAttr("target", "_blank");
      }

      const lexurgyRow = parent.createDiv({ cls: "langscape-status-row" });
      lexurgyRow.createSpan({ cls: "langscape-status-label", text: "Lexurgy" });
      lexurgyRow.createSpan({
        cls: env.installation ? "langscape-ok" : "langscape-bad",
        text: env.installation ? env.installation.label : "not found",
      });

      if (env.error) {
        parent.createDiv({ cls: "langscape-muted", text: env.error });
      }
    } catch (error) {
      parent.empty();
      parent.createDiv({
        cls: "langscape-error",
        text: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private renderAbout(): void {
    this.containerEl.createEl("p", {
      cls: "langscape-muted langscape-version",
      text: `Langscape ${this.plugin.manifest.version}`,
    });
  }
}
