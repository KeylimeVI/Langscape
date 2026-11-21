import {
  Editor,
  MarkdownView,
  Notice,
  Plugin,
  TFolder,
  normalizePath,
} from "obsidian";
import { createStarterVault } from "./demo";
import { installFontClipboard } from "./fonts/clipboard";
import { isFontFile } from "./fonts/css";
import { findFontSpans } from "./fonts/spans";
import { FontManager } from "./fonts/manager";
import { FontDomDecorator } from "./fonts/dom";
import { FontPickerModal } from "./fonts/modal";
import {
  createFontLivePreviewExtension,
  createFontPostProcessor,
  createNoteFontExtension,
} from "./fonts/render";
import { LEXURGY_DOCS_VIEW_TYPE, LexurgyDocsView } from "./lexurgy/docs-view";
import { LexurgyService } from "./lexurgy/service";
import { EMPTY_RECIPE, serializeRecipe } from "./recipes/model";
import { RECIPE_VIEW_TYPE, RecipeView } from "./recipes/view";
import { DEFAULT_SETTINGS, mergeSettings, type LangscapeSettings } from "./settings";
import { LangscapeSettingTab } from "./settings-ui";
import { SOUNDCHANGE_VIEW_TYPE, SoundChangeView } from "./soundchange/view";
import { NEW_LSC_TEMPLATE } from "./soundchange/template";
import {
  addTableMenuItems,
  hasTableAtCursor,
  insertTable,
  mergeTableCells,
  splitTableCell,
} from "./tables/actions";
import {
  createMergedTableExtension,
  installTableMenuPatch,
} from "./tables/live-preview";
import { createMergedTablePostProcessor } from "./tables/postprocess";
import {
  createSyntaxTreeExtension,
  refreshSyntaxTrees,
} from "./trees/editor";
import { createSyntaxTreePostProcessor } from "./trees/postprocess";
import { confirmAction } from "./ui/modals";

export default class LangscapePlugin extends Plugin {
  settings: LangscapeSettings = { ...DEFAULT_SETTINGS };
  fontManager!: FontManager;
  private fontDomDecorator: FontDomDecorator | null = null;
  lexurgy!: LexurgyService;
  private testWordsSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private fontRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private lexurgyProbeTimer: ReturnType<typeof setTimeout> | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.fontManager = new FontManager(this.app, () => this.settings);
    this.register(installFontClipboard(this.fontManager));
    this.fontDomDecorator = new FontDomDecorator(this.app, this.fontManager);
    this.lexurgy = new LexurgyService(this);

    this.registerView(SOUNDCHANGE_VIEW_TYPE, (leaf) => new SoundChangeView(leaf, this));
    this.registerView(LEXURGY_DOCS_VIEW_TYPE, (leaf) => new LexurgyDocsView(leaf));
    this.registerExtensions(["lsc"], SOUNDCHANGE_VIEW_TYPE);
    this.registerView(RECIPE_VIEW_TYPE, (leaf) => new RecipeView(leaf, this));
    this.registerExtensions(["recipe"], RECIPE_VIEW_TYPE);
    this.addSettingTab(new LangscapeSettingTab(this));

    // Trees must be processed before fonts: tree labels can contain font spans,
    // and the tree parser needs to see the raw braces. The tree renderer applies
    // fonts inside each label itself.
    this.registerMarkdownPostProcessor(createSyntaxTreePostProcessor(this.fontManager));
    this.registerMarkdownPostProcessor(createMergedTablePostProcessor(this.app));
    this.registerMarkdownPostProcessor(createFontPostProcessor(this.fontManager));
    this.registerEditorExtension(createSyntaxTreeExtension(this.fontManager, this.app));
    this.registerEditorExtension(createMergedTableExtension(this.fontManager));
    this.register(installTableMenuPatch());
    this.registerEditorExtension(createFontLivePreviewExtension(this.fontManager));
    this.registerEditorExtension(createNoteFontExtension(this.fontManager));

    await this.fontManager.refresh();
    this.refreshTreeViews();
    this.fontDomDecorator.start();
    this.register(() => this.fontDomDecorator?.stop());
    this.registerFontEvents();
    this.addCommands();
    // Obsidian passes the vault root for a right-click on blank explorer space.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, source) => {
        if (source !== "file-explorer-context-menu" || !(file instanceof TFolder)) return;
        menu.addItem((item) => {
          item
            .setTitle("New Lexurgy file")
            .setIcon("languages")
            .setSection("action-primary")
            .onClick(() => void this.createSoundChangeFile(file));
        });
        menu.addItem((item) => {
          item
            .setTitle("New recipe")
            .setIcon("book-open")
            .setSection("action-primary")
            .onClick(() => void this.createRecipeFile(file));
        });
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        if (!this.app.workspace.getActiveViewOfType(MarkdownView)) return;
        menu.addItem((item) => {
          item
            .setTitle("Syntax tree")
            .setIcon("lucide-network")
            .setSection("selection.insert.basic")
            .onClick(() => this.insertSyntaxTree(editor));
        });
        menu.addItem((item) => {
          item
            .setTitle("Table")
            .setIcon("table-2")
            .setSection("selection.insert.basic")
            .onClick(() => insertTable(editor));
        });
      })
    );

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        if (!this.app.workspace.getActiveViewOfType(MarkdownView)) return;
        addTableMenuItems(menu, editor);
      })
    );

    this.lexurgyProbeTimer = setTimeout(() => {
      this.lexurgyProbeTimer = null;
      void this.lexurgy.getEnvironment().catch(() => undefined);
    }, 1500);
  }

  onunload(): void {
    if (this.testWordsSaveTimer) clearTimeout(this.testWordsSaveTimer);
    if (this.fontRefreshTimer) clearTimeout(this.fontRefreshTimer);
    if (this.lexurgyProbeTimer) clearTimeout(this.lexurgyProbeTimer);
    void this.lexurgy?.dispose();
    this.fontManager?.unload();
    this.app.workspace.detachLeavesOfType(SOUNDCHANGE_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LEXURGY_DOCS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(RECIPE_VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  getTestWords(path: string): string {
    return this.settings.testWords[path] ?? "";
  }

  setTestWords(path: string, words: string): void {
    this.settings.testWords[path] = words;
    if (this.testWordsSaveTimer) clearTimeout(this.testWordsSaveTimer);
    this.testWordsSaveTimer = setTimeout(() => {
      this.testWordsSaveTimer = null;
      void this.saveSettings();
    }, 800);
  }

  async refreshFonts(): Promise<void> {
    await this.fontManager.refresh();
    this.refreshTreeViews();
  }

  /** Rebuild tree widgets and Reading-view trees after fonts finish loading. */
  private refreshTreeViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view as MarkdownView;
      const editor = view.editor as unknown as {
        cm?: {
          dispatch: (spec: unknown) => void;
        };
      };
      try {
        const cm = editor?.cm;
        if (cm) {
          cm.dispatch({ effects: refreshSyntaxTrees.of(null) });
        }
        view.previewMode?.rerender(true);
      } catch {
        // The leaf may be closing while fonts finish loading.
      }
    }
  }

  openSettings(): void {
    const setting = (this.app as unknown as {
      setting?: { open?: () => void; openTabById?: (id: string) => void };
    }).setting;
    setting?.open?.();
    setting?.openTabById?.(this.manifest.id);
  }

  async insertFontSpan(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Open a Markdown note to insert custom-font text.");
      return;
    }
    if (this.fontManager.list().length === 0) {
      new Notice("No fonts are loaded. Drop a font file anywhere in the vault.");
      this.openSettings();
      return;
    }
    const editor = view.editor;
    const selection = editor.getSelection();
    new FontPickerModal(this.app, {
      manager: this.fontManager,
      initialText: selection,
      onChoose: (markup) => {
        const from = editor.getCursor("from");
        editor.replaceSelection(markup);
        const contentOffset = findFontSpans(markup)[0]?.contentStart ?? 0;
        const offset = editor.posToOffset(from) + contentOffset;
        editor.setCursor(editor.offsetToPos(offset));
        editor.focus();
      },
    }).open();
  }

  insertSyntaxTree(editor?: Editor): void {
    const target = editor ?? this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
    if (!target) {
      new Notice("Open a Markdown note to insert a syntax tree.");
      return;
    }
    const template = '{tree: ""}';
    const cursor = target.getCursor();
    const currentLine = target.getLine(cursor.line);
    target.replaceSelection(currentLine.trim() ? `\n${template}` : template);
    target.focus();
  }

  private createSoundChangeFile(folder = this.app.workspace.getActiveFile()?.parent): Promise<void> {
    return this.createEditableFile(folder, "Sound Changes", "lsc", NEW_LSC_TEMPLATE);
  }

  private createRecipeFile(folder = this.app.workspace.getActiveFile()?.parent): Promise<void> {
    return this.createEditableFile(folder, "Recipe", "recipe", serializeRecipe(EMPTY_RECIPE));
  }

  private async createEditableFile(
    folder: TFolder | null | undefined,
    name: string,
    extension: string,
    content: string
  ): Promise<void> {
    const base = folder && !folder.isRoot() ? `${folder.path}/${name}` : name;
    try {
      const file = await this.app.vault.create(this.availablePath(base, extension), content);
      await this.app.workspace.getLeaf("tab").openFile(file);
    } catch (error) {
      new Notice(`Could not create .${extension} file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async createStarterVault(): Promise<void> {
    await createStarterVault(this.app);
  }

  async installLexurgyFromUi(): Promise<void> {
    const confirmed = await confirmAction(this.app, {
      title: "Install Lexurgy?",
      body:
        "Langscape will download the official Lexurgy CLI from its GitHub releases page and store it in this plugin's folder.\n\n" +
        "Lexurgy is a separate program licensed under GPL-3.0. Java 17 or newer is recommended.",
      confirmText: "Download Lexurgy",
    });
    if (!confirmed) return;
    const notice = new Notice("Downloading the official Lexurgy CLI…", 60_000);
    try {
      const result = await this.lexurgy.installLexurgy();
      notice.hide();
      new Notice(`Lexurgy ${result.version} installed.`);
      this.openSettings();
    } catch (error) {
      notice.hide();
      new Notice(
        `Lexurgy install failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private registerFontEvents(): void {
    const refresh = () => {
      if (this.fontRefreshTimer) clearTimeout(this.fontRefreshTimer);
      this.fontRefreshTimer = setTimeout(() => {
        this.fontRefreshTimer = null;
        void this.refreshFonts();
      }, 400);
    };
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (isFontFile(file.path)) refresh();
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (isFontFile(file.path)) refresh();
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (isFontFile(file.path) || isFontFile(oldPath)) refresh();
      })
    );
  }

  private addCommands(): void {
    this.addCommand({
      id: "create-sound-change-file",
      name: "Create sound-change file",
      callback: () => void this.createSoundChangeFile(),
    });

    this.addCommand({
      id: "create-recipe",
      name: "Create recipe",
      callback: () => void this.createRecipeFile(),
    });

    this.addCommand({
      id: "insert-font-span",
      name: "Insert custom-font text",
      checkCallback: (checking) => {
        if (!this.app.workspace.getActiveViewOfType(MarkdownView)) return false;
        if (checking) return true;
        void this.insertFontSpan();
        return true;
      },
    });

    this.addCommand({
      id: "insert-syntax-tree",
      name: "Insert syntax tree",
      checkCallback: (checking) => {
        if (!this.app.workspace.getActiveViewOfType(MarkdownView)) return false;
        if (checking) return true;
        this.insertSyntaxTree();
        return true;
      },
    });

    this.addCommand({
      id: "insert-table",
      name: "Insert table",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || view.getMode() === "preview") return false;
        if (checking) return true;
        insertTable(view.editor);
        return true;
      },
    });

    this.addCommand({
      id: "merge-table-cells",
      name: "Merge table cells",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || view.getMode() === "preview" || !hasTableAtCursor(view.editor)) {
          return false;
        }
        if (checking) return true;
        mergeTableCells(view.editor);
        return true;
      },
    });

    this.addCommand({
      id: "split-table-cell",
      name: "Split merged table cell",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || view.getMode() === "preview" || !hasTableAtCursor(view.editor)) {
          return false;
        }
        if (checking) return true;
        splitTableCell(view.editor);
        return true;
      },
    });

    this.addCommand({
      id: "rescan-fonts",
      name: "Rescan vault fonts",
      callback: async () => {
        await this.refreshFonts();
        new Notice(`Langscape loaded ${this.fontManager.list().length} font(s).`);
      },
    });

    this.addCommand({
      id: "create-starter-vault",
      name: "Create starter vault",
      callback: () =>
        void this.createStarterVault().catch((error) => {
          new Notice(
            `Could not create the starter vault: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }),
    });

    this.addCommand({
      id: "open-settings",
      name: "Open settings",
      callback: () => this.openSettings(),
    });
  }

  private availablePath(base: string, extension: string): string {
    const clean = normalizePath(base);
    let candidate = `${clean}.${extension}`;
    let index = 2;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${clean} ${index}.${extension}`;
      index++;
    }
    return candidate;
  }
}
