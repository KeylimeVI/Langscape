import { Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import type LangscapePlugin from "./main";
import { JAVA_DOWNLOAD_URL } from "./lexurgy/java";
import { promptText } from "./ui/modals";

export class LangscapeSettingTab extends PluginSettingTab {
  plugin: LangscapePlugin;

  constructor(plugin: LangscapePlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("langscape-settings");
    containerEl.createEl("h2", { text: "Langscape" });

    this.renderFonts();
    this.renderLexurgy();
    this.renderAbout();
  }

  private renderFonts(): void {
    const { containerEl } = this;
    const heading = new Setting(containerEl).setName("Fonts").setHeading();
    heading.addButton((button) =>
      button.setButtonText("Rescan").onClick(async () => {
        await this.plugin.refreshFonts();
        new Notice(`Loaded ${this.plugin.fontManager.list().length} font(s).`);
        this.display();
      })
    );
    containerEl.createEl("p", {
      cls: "langscape-muted",
      text: "Fonts are discovered everywhere in the vault. Set a short nickname to use '''nickname text''' in notes.",
    });

    const fonts = this.plugin.fontManager.list();
    if (fonts.length === 0) {
      containerEl.createEl("p", {
        cls: "langscape-empty",
        text: "No fonts found. Drop a .ttf/.otf/.woff/.woff2 file anywhere in the vault, then press Rescan.",
      });
      return;
    }

    const list = containerEl.createDiv({ cls: "langscape-font-settings-list" });
    for (const font of fonts) {
      const row = list.createDiv({ cls: "langscape-font-setting" });
      const preview = row.createDiv({
        cls: `langscape-font-setting-preview ${font.className}`,
      });
      preview.setText(this.plugin.fontManager.sampleFor(font));
      const info = row.createDiv({ cls: "langscape-font-setting-info" });
      info.createDiv({ cls: "langscape-font-setting-name", text: font.displayName });
      const code = font.nickname?.trim() || font.displayName.replace(/\s+/g, "-");
      info.createDiv({
        cls: "langscape-font-setting-nickname",
        text: `'''${code} text'''`,
      });
      info.createDiv({
        cls: "langscape-font-setting-source",
        text: font.source === "vault" ? font.path ?? "vault" : font.url ?? "web",
      });
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
            "A short code for '''nickname text'''. Use letters, numbers, underscores, or hyphens; leave blank to use the font name.",
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
        const key = font.path ?? font.id;
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
        this.display();
      });

      const custom = this.plugin.settings.customFonts.find((entry) => entry.id === font.id);
      if (custom) {
        const remove = actions.createEl("button", {
          cls: "clickable-icon",
          attr: { "aria-label": "Remove font" },
        });
        setIcon(remove, "trash-2");
        remove.addEventListener("click", async () => {
          this.plugin.settings.customFonts = this.plugin.settings.customFonts.filter(
            (entry) => entry.id !== custom.id
          );
          await this.plugin.saveSettings();
          await this.plugin.refreshFonts();
          this.display();
        });
      }
    }
  }

  private renderLexurgy(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "Lexurgy" });
    const status = containerEl.createDiv({ cls: "langscape-lexurgy-setting-status" });
    status.createDiv({ cls: "langscape-muted", text: "Checking…" });
    void this.refreshLexurgyStatus(status);

    new Setting(containerEl)
      .addButton((button) =>
        button
          .setButtonText("Install Lexurgy")
          .setCta()
          .onClick(() => void this.plugin.installLexurgyFromUi())
      )
      .addButton((button) =>
        button.setButtonText("Test").onClick(async () => {
          try {
            const result = await this.plugin.lexurgy.testConnection();
            new Notice(`Lexurgy works (${result.version}).`);
            await this.refreshLexurgyStatus(status, true);
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
            await this.plugin.lexurgy.restart();
            void this.refreshLexurgyStatus(status, true);
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
            await this.plugin.lexurgy.restart();
            void this.refreshLexurgyStatus(status, true);
          })
      );

    body.createEl("p", {
      cls: "langscape-muted",
      text: "Lexurgy is a separate GPL-3.0 program and is not bundled with Langscape.",
    });
  }

  private async refreshLexurgyStatus(parent: HTMLElement, force = false): Promise<void> {
    try {
      const env = await this.plugin.lexurgy.getEnvironment(force);
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
