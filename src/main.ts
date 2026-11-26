import {
  Editor,
  MarkdownView,
  Notice,
  Platform,
  Plugin,
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
import type { LexurgyService } from "./lexurgy/service";
import { DEFAULT_SETTINGS, mergeSettings, type LangscapeSettings } from "./settings";
import { LangscapeSettingTab } from "./settings-ui";
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
import type { TreeAlignmentPreference } from "./trees/render";
import { createSyntaxTreePostProcessor } from "./trees/postprocess";

export default class LangscapePlugin extends Plugin {
  settings: LangscapeSettings = { ...DEFAULT_SETTINGS };
  fontManager!: FontManager;
  private fontDomDecorator: FontDomDecorator | null = null;
  lexurgy?: LexurgyService;
  private testWordsSaveTimer: number | null = null;
  private fontRefreshTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.fontManager = new FontManager(this.app, () => this.settings);
    this.fontManager.attachDocument(document);
    this.registerEvent(this.app.workspace.on("window-open", (_workspace, win) => this.fontManager.attachDocument(win.document)));
    this.registerEvent(this.app.workspace.on("window-close", (_workspace, win) => this.fontManager.detachDocument(win.document)));
    this.app.workspace.onLayoutReady(() => {
      this.app.workspace.iterateAllLeaves((leaf) => this.fontManager.attachDocument(leaf.view.containerEl.ownerDocument));
    });
    this.register(installFontClipboard(this.fontManager));
    this.fontDomDecorator = new FontDomDecorator(this.app, this.fontManager);

    if (Platform.isDesktopApp) {
      const { registerDesktopFeatures } = await import("./desktop");
      this.lexurgy = registerDesktopFeatures(this);
    }
    this.addSettingTab(new LangscapeSettingTab(this));

    const treeAlignment: TreeAlignmentPreference = {
      get: () => this.settings.treeAlignment,
      set: (value) => {
        this.settings.treeAlignment = value;
        void this.saveSettings();
      },
    };
    // Trees must be processed before fonts: tree labels can contain font spans,
    // and the tree parser needs to see the raw braces. The tree renderer applies
    // fonts inside each label itself.
    this.registerMarkdownPostProcessor(createSyntaxTreePostProcessor(this.fontManager, treeAlignment));
    this.registerMarkdownPostProcessor(createMergedTablePostProcessor(this.app));
    this.registerMarkdownPostProcessor(createFontPostProcessor(this.fontManager));
    this.registerEditorExtension(createSyntaxTreeExtension(this.fontManager, this.app, treeAlignment));
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
  }

  onunload(): void {
    if (this.testWordsSaveTimer) window.clearTimeout(this.testWordsSaveTimer);
    if (this.fontRefreshTimer) window.clearTimeout(this.fontRefreshTimer);
    this.fontManager?.unload();
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
    if (this.testWordsSaveTimer) window.clearTimeout(this.testWordsSaveTimer);
    this.testWordsSaveTimer = window.setTimeout(() => {
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

  async createStarterVault(): Promise<void> {
    await createStarterVault(this.app);
  }

  private registerFontEvents(): void {
    const refresh = () => {
      if (this.fontRefreshTimer) window.clearTimeout(this.fontRefreshTimer);
      this.fontRefreshTimer = window.setTimeout(() => {
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

}
