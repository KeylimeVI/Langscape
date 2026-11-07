import { Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import type LangscapePlugin from "./main";
import { isFontFile } from "./fonts/css";
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
    this.renderTestBench();
    this.renderAbout();
  }

  private renderFonts(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "Fonts" });

    new Setting(containerEl)
      .setName("Discover fonts automatically")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoDiscoverFonts).onChange(async (value) => {
          this.plugin.settings.autoDiscoverFonts = value;
          await this.plugin.saveSettings();
          await this.plugin.refreshFonts();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName("Font folder")
      .setDesc("Blank scans the whole vault.")
      .addText((text) =>
        text
          .setPlaceholder("Fonts")
          .setValue(this.plugin.settings.fontFolder)
          .onChange(async (value) => {
            this.plugin.settings.fontFolder = value.trim();
            await this.plugin.saveSettings();
            await this.plugin.refreshFonts();
          })
      );

    const fonts = this.plugin.fontManager.list();
    if (fonts.length === 0) {
      containerEl.createEl("p", {
        cls: "langscape-empty",
        text: "No fonts loaded yet.",
      });
    } else {
      const list = containerEl.createDiv({ cls: "langscape-font-settings-list" });
      for (const font of fonts) {
        const row = list.createDiv({ cls: "langscape-font-setting" });
        const preview = row.createDiv({
          cls: `langscape-font-setting-preview ${font.className}`,
        });
        preview.setText(this.plugin.fontManager.sampleFor(font));
        const info = row.createDiv({ cls: "langscape-font-setting-info" });
        info.createDiv({ cls: "langscape-font-setting-name", text: font.displayName });
        info.createDiv({
          cls: "langscape-font-setting-source",
          text: font.source === "vault" ? font.path ?? "vault" : font.url ?? "web",
        });
        const actions = row.createDiv({ cls: "langscape-font-setting-actions" });
        const rename = actions.createEl("button", {
          cls: "clickable-icon",
          attr: { "aria-label": "Rename font" },
        });
        setIcon(rename, "pencil");
        rename.addEventListener("click", async () => {
          const name = await promptText(this.app, {
            title: "Rename font",
            value: font.displayName,
            cta: "Rename",
          });
          if (!name) return;
          if (font.source === "vault" && font.path) {
            this.plugin.settings.fontAliases[font.path] = name;
          } else {
            const custom = this.plugin.settings.customFonts.find((entry) => entry.id === font.id);
            if (custom) custom.name = name;
          }
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

    new Setting(containerEl)
      .setName("Font library")
      .addButton((button) =>
        button.setButtonText("Rescan").onClick(async () => {
          await this.plugin.refreshFonts();
          new Notice(`Loaded ${this.plugin.fontManager.list().length} font(s).`);
          this.display();
        })
      );

    this.renderAddFont();
  }

  private renderAddFont(): void {
    const { containerEl } = this;
    const details = containerEl.createEl("details", { cls: "langscape-settings-details" });
    details.createEl("summary", { text: "Add a font" });
    const body = details.createDiv({ cls: "langscape-settings-details-body" });
    const fontFiles = this.app.vault
      .getFiles()
      .filter((file) => isFontFile(file.path))
      .sort((a, b) => a.path.localeCompare(b.path));

    if (fontFiles.length > 0) {
      let selected = fontFiles[0].path;
      new Setting(body)
        .setName("Vault font file")
        .addDropdown((dropdown) => {
          for (const file of fontFiles) dropdown.addOption(file.path, file.path);
          dropdown.setValue(selected).onChange((value) => {
            selected = value;
          });
        })
        .addButton((button) =>
          button.setButtonText("Add").onClick(async () => {
            if (!selected) return;
            if (this.plugin.settings.customFonts.some((font) => font.path === selected)) {
              new Notice("That font is already in the library.");
              return;
            }
            this.plugin.settings.customFonts.push({
              id: `vault-${Date.now()}`,
              name: "",
              path: selected,
              enabled: true,
            });
            await this.plugin.saveSettings();
            await this.plugin.refreshFonts();
            this.display();
          })
        );
    }

    let webName = "";
    let webUrl = "";
    new Setting(body)
      .setName("Web font")
      .addText((text) =>
        text.setPlaceholder("Name").onChange((value) => {
          webName = value;
        })
      )
      .addText((text) =>
        text.setPlaceholder("https://…/font.woff2").onChange((value) => {
          webUrl = value;
        })
      )
      .addButton((button) =>
        button.setButtonText("Add").onClick(async () => {
          if (!webName.trim() || !/^https?:\/\//i.test(webUrl.trim())) {
            new Notice("Provide a name and an http(s) font URL.");
            return;
          }
          this.plugin.settings.customFonts.push({
            id: `web-${Date.now()}`,
            name: webName.trim(),
            url: webUrl.trim(),
            enabled: true,
          });
          await this.plugin.saveSettings();
          await this.plugin.refreshFonts();
          this.display();
        })
      );
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

  private renderTestBench(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "Test bench" });
    new Setting(containerEl)
      .setName("Trace applied rules by default")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.traceByDefault).onChange(async (value) => {
          this.plugin.settings.traceByDefault = value;
          await this.plugin.saveSettings();
        })
      );
  }

  private renderAbout(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "Demo" });
    new Setting(containerEl)
      .setName("Starter vault")
      .setDesc("A demo canvas, words, sound changes, and an OFL font.")
      .addButton((button) =>
        button.setButtonText("Create").onClick(async () => {
          try {
            await this.plugin.createStarterVault();
          } catch (error) {
            new Notice(
              `Could not create the starter vault: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        })
      );
    containerEl.createEl("p", {
      cls: "langscape-muted langscape-version",
      text: `Langscape ${this.plugin.manifest.version}`,
    });
  }
}
