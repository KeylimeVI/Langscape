import {
  Editor,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  TFile,
  TFolder,
  normalizePath,
} from "obsidian";
import { createStarterVault } from "./demo";
import { isFontFile } from "./fonts/css";
import { FontManager } from "./fonts/manager";
import { FontDomDecorator } from "./fonts/dom";
import { FontPickerModal } from "./fonts/modal";
import {
  createFontLivePreviewExtension,
  createFontPostProcessor,
  createNoteFontExtension,
} from "./fonts/render";
import { LexurgyService } from "./lexurgy/service";
import {
  PipelineError,
  extractStepBlocks,
  parseCanvasPipeline,
  stepConfigFromObject,
  type PipelineGraph,
} from "./pipeline/model";
import { runPipeline, type PipelineRunReport } from "./pipeline/runner";
import { createPipelineCodeBlockProcessor } from "./pipeline/code-block";
import { updatePipelineBlock } from "./pipeline/block-edit";
import { extractSourceWords } from "./pipeline/words";
import { writePipelineOutput } from "./pipeline/writer";
import { DEFAULT_SETTINGS, mergeSettings, type LangscapeSettings } from "./settings";
import { LangscapeSettingTab } from "./settings-ui";
import { SOUNDCHANGE_VIEW_TYPE, SoundChangeView } from "./soundchange/view";
import { NEW_LSC_TEMPLATE } from "./soundchange/template";
import {
  createSyntaxTreeExtension,
  refreshSyntaxTrees,
} from "./trees/editor";
import { createSyntaxTreePostProcessor } from "./trees/postprocess";
import { confirmAction, promptText } from "./ui/modals";
import { pickPath, type PathOption } from "./ui/path-picker";

type CanvasHost = {
  addAction?: (icon: string, title: string, callback: (event: MouseEvent) => void) => unknown;
  canvas?: any;
  containerEl?: HTMLElement;
  file?: TFile | null;
  getViewType?: () => string;
  save?: () => Promise<void> | void;
};

type CanvasStepKind = "source" | "sound-change" | "output";

export default class LangscapePlugin extends Plugin {
  settings: LangscapeSettings = { ...DEFAULT_SETTINGS };
  fontManager!: FontManager;
  private fontDomDecorator: FontDomDecorator | null = null;
  lexurgy!: LexurgyService;
  private testWordsSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private pipelineRun: Promise<PipelineRunReport | null> | null = null;
  private fontRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private canvasViews = new WeakSet<object>();
  private canvasActionEls = new Set<HTMLElement>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.fontManager = new FontManager(this.app, () => this.settings);
    this.fontDomDecorator = new FontDomDecorator(this.app, this.fontManager);
    this.lexurgy = new LexurgyService(this);

    this.registerView(SOUNDCHANGE_VIEW_TYPE, (leaf) => new SoundChangeView(leaf, this));
    this.registerExtensions(["lsc"], SOUNDCHANGE_VIEW_TYPE);
    this.addSettingTab(new LangscapeSettingTab(this));

    // Trees must be processed before fonts: tree labels can contain font spans,
    // and the tree parser needs to see the raw braces. The tree renderer applies
    // fonts inside each label itself.
    this.registerMarkdownPostProcessor(createSyntaxTreePostProcessor(this.fontManager));
    this.registerMarkdownPostProcessor(createFontPostProcessor(this.fontManager, this.app));
    this.registerEditorExtension(createSyntaxTreeExtension(this.fontManager, this.app));
    this.registerEditorExtension(createFontLivePreviewExtension(this.fontManager));
    this.registerEditorExtension(createNoteFontExtension(this.fontManager));
    this.registerMarkdownCodeBlockProcessor("langscape", createPipelineCodeBlockProcessor(this));

    await this.fontManager.refresh();
    this.refreshTreeViews();
    this.fontDomDecorator.start();
    this.register(() => this.fontDomDecorator?.stop());
    this.registerFontEvents();
    this.addCommands();
    this.addRibbonIcons();
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        menu.addItem((item) => {
          item
            .setTitle("Syntax tree")
            .setIcon("lucide-network")
            .setSection("selection.insert.basic")
            .onClick(() => this.insertSyntaxTree(editor));
        });
      })
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.ensureCanvasAction())
    );
    this.registerEvent(this.app.workspace.on("file-open", () => this.ensureCanvasAction()));
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension.toLowerCase() === "canvas") {
          this.app.workspace.trigger("langscape:canvas-modified", file.path);
        }
      })
    );
    this.app.workspace.onLayoutReady(() => this.ensureCanvasAction());

    setTimeout(() => {
      void this.lexurgy.getEnvironment().catch(() => undefined);
    }, 1500);
  }

  onunload(): void {
    if (this.testWordsSaveTimer) clearTimeout(this.testWordsSaveTimer);
    if (this.fontRefreshTimer) clearTimeout(this.fontRefreshTimer);
    void this.lexurgy?.dispose();
    this.fontManager?.unload();
    for (const action of this.canvasActionEls) action.remove();
    this.canvasActionEls.clear();
    this.app.workspace.detachLeavesOfType(SOUNDCHANGE_VIEW_TYPE);
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
        const brace = /^\{[^:{}]+:\s*/.exec(markup);
        const triple = /^'''\S+\s+/.exec(markup);
        const pipe = markup.indexOf("|");
        const contentOffset = brace
          ? brace[0].length
          : triple
            ? triple[0].length
            : pipe >= 0
              ? pipe + 1
              : 0;
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

  async createSoundChangeFile(): Promise<void> {
    const active = this.app.workspace.getActiveFile();
    const folder = active?.parent?.path && active.parent.path !== "/" ? active.parent.path : "";
    const base = folder ? `${folder}/Sound Changes` : "Sound Changes";
    const path = await this.availablePath(base, "lsc");
    const file = await this.app.vault.create(path, NEW_LSC_TEMPLATE);
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  getActiveCanvasFile(): TFile | null {
    const file = this.app.workspace.getActiveFile();
    if (file && file.extension.toLowerCase() === "canvas") return file;
    return null;
  }

  /** Parse the live canvas (including unsaved edits) when it is open. */
  async getLiveCanvasGraph(path: string): Promise<PipelineGraph> {
    const leaves = this.app.workspace.getLeavesOfType("canvas");
    const normalized = normalizePath(path);
    for (const leaf of leaves) {
      const view = leaf.view as CanvasHost & { file?: TFile | null };
      if (view.file?.path !== normalized || !view.canvas?.getData) continue;
      try {
        return parseCanvasPipeline(JSON.stringify(view.canvas.getData()), normalized);
      } catch {
        break;
      }
    }
    return this.getPipelineGraph(normalized);
  }

  async getPipelineGraph(path: string): Promise<PipelineGraph> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!file || !("extension" in file)) {
      throw new Error(`Canvas not found: ${path}`);
    }
    const text = await this.app.vault.cachedRead(file as TFile);
    return parseCanvasPipeline(text, (file as TFile).path);
  }

  async updateCanvasStep(
    canvasPath: string,
    stepId: string,
    patch: Record<string, string | undefined>
  ): Promise<void> {
    const view = this.canvasViewForPath(canvasPath);
    const node = view?.canvas?.nodes?.get(stepId);
    const data = node?.getData?.();
    if (!node || !data?.text) return;
    const next = updatePipelineBlock(data.text, patch);
    if (next === data.text) return;
    if (typeof node.setText === "function") node.setText(next);
    else node.setData?.({ ...data, text: next });
    view?.canvas?.requestSave?.();
    this.app.workspace.trigger("langscape:canvas-modified", normalizePath(canvasPath));
    await view?.save?.();
  }

  async openVaultPath(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!file || !("extension" in file)) {
      new Notice(`File not found: ${path}`);
      return;
    }
    await this.app.workspace.getLeaf("tab").openFile(file as TFile);
  }

  async pickStepPath(
    kind: CanvasStepKind,
    anchor?: HTMLElement,
    current?: string
  ): Promise<string | null> {
    return this.chooseStepPath(kind, anchor, current);
  }

  private canvasViewForPath(path: string): CanvasHost | undefined {
    const normalized = normalizePath(path);
    const active = this.app.workspace.activeLeaf?.view as CanvasHost | undefined;
    if (active?.canvas && active.file?.path === normalized) return active;
    for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
      const view = leaf.view as CanvasHost;
      if (view.canvas && view.file?.path === normalized) return view;
    }
    return undefined;
  }

  async runCanvasByPath(
    path: string,
    options: { targetNodeId?: string } = {}
  ): Promise<PipelineRunReport | null> {
    if (this.pipelineRun) {
      new Notice("A Langscape pipeline is already running.");
      return this.pipelineRun;
    }
    this.pipelineRun = this.executeCanvasPipeline(path, options.targetNodeId);
    try {
      return await this.pipelineRun;
    } finally {
      this.pipelineRun = null;
    }
  }

  private async executeCanvasPipeline(
    path: string,
    targetNodeId?: string
  ): Promise<PipelineRunReport | null> {
    let graph: PipelineGraph;
    try {
      graph = await this.getLiveCanvasGraph(path);
    } catch (error) {
      new Notice(
        `Langscape pipeline failed: ${error instanceof Error ? error.message : String(error)}`,
        10_000
      );
      return null;
    }

    try {
      const report = await runPipeline(
        graph,
        {
          extractSource: (step) => extractSourceWords(this.app, step),
          readFile: (filePath) => this.readVaultText(filePath),
          apply: (changes, words, options) => this.lexurgy.apply(changes, words, options),
          writeOutput: (step, words, changes) =>
            writePipelineOutput({
              app: this.app,
              step,
              words,
              changes,
              pipelinePath: path,
            }),
        },
        { targetOutputId: targetNodeId }
      );
      const files = report.outputs.reduce((sum, output) => sum + output.paths.length, 0);
      new Notice(
        `Pipeline finished: ${report.wordsOut} ${report.wordsOut === 1 ? "word" : "words"} → ${files} ${
          files === 1 ? "file" : "files"
        }.`
      );
      return report;
    } catch (error) {
      if (error instanceof PipelineError) {
        const first = error.issues.find((issue) => issue.severity === "error");
        new Notice(`Pipeline failed: ${first?.message ?? error.message}`, 10_000);
      } else {
        new Notice(
          `Pipeline failed: ${error instanceof Error ? error.message : String(error)}`,
          10_000
        );
      }
      return null;
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

  private async readVaultText(path: string): Promise<string> {
    const normalized = normalizePath(path);
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (file && "extension" in file) {
      return this.app.vault.cachedRead(file as TFile);
    }
    return this.app.vault.adapter.read(normalized);
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

  private ensureCanvasAction(): void {
    const view = this.app.workspace.activeLeaf?.view as CanvasHost | undefined;
    if (!view || view.getViewType?.() !== "canvas" || !view.addAction) return;
    if (this.canvasViews.has(view)) return;
    this.canvasViews.add(view);
    const action = view.addAction("workflow", "Langscape", (event) =>
      this.showCanvasMenu(view, event)
    );
    if (action instanceof HTMLElement) this.canvasActionEls.add(action);
  }

  private showCanvasMenu(view: CanvasHost, event: MouseEvent): void {
    const file = this.getActiveCanvasFile() ?? view.file ?? null;
    if (!file) return;
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("Add source words…")
        .setIcon("folder")
        .onClick((event) => void this.addCanvasStep("source", file, view, event.target as HTMLElement))
    );
    menu.addItem((item) =>
      item
        .setTitle("Add sound changes…")
        .setIcon("music")
        .onClick((event) => void this.addCanvasStep("sound-change", file, view, event.target as HTMLElement))
    );
    menu.addItem((item) =>
      item
        .setTitle("Add output…")
        .setIcon("save")
        .onClick((event) => void this.addCanvasStep("output", file, view, event.target as HTMLElement))
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Run all pipelines")
        .setIcon("play")
        .onClick(() => void this.runCanvasByPath(file.path))
    );
    menu.showAtMouseEvent(event);
  }

  private async chooseStepPath(
    kind: CanvasStepKind,
    anchor?: HTMLElement,
    current?: string
  ): Promise<string | null> {
    if (kind === "source") {
      const options = this.folderOptions();
      const wli = this.app.vault
        .getFiles()
        .filter((candidate) => candidate.extension.toLowerCase() === "wli")
        .map((candidate) => ({ path: candidate.path, kind: "file" as const }));
      if (options.length === 0 && wli.length === 0) {
        new Notice("No folders found. Create a folder of word notes first.");
        return null;
      }
      return pickPath(this.app, {
        title: "Add source words",
        placeholder: "Search folders or .wli files…",
        options: [...options, ...wli],
      }, anchor);
    }

    if (kind === "sound-change") {
      const options: PathOption[] = this.app.vault
        .getFiles()
        .filter((candidate) => candidate.extension.toLowerCase() === "lsc")
        .map((candidate) => ({ path: candidate.path, kind: "file" as const }))
        .sort((a, b) => a.path.localeCompare(b.path));
      if (options.length === 0) {
        new Notice("No .lsc files found. Create a sound-change file first.");
        return null;
      }
      return pickPath(this.app, {
        title: "Add sound changes",
        placeholder: "Search sound-change files…",
        options,
      }, anchor);
    }

    return pickPath(this.app, {
      title: "Add output",
      placeholder: "Search folders or type a new path…",
      options: this.folderOptions(),
      allowCustom: true,
      initialValue: current || "Words/Modern",
    }, anchor);
  }

  private folderOptions(): PathOption[] {
    return this.app.vault
      .getAllLoadedFiles()
      .filter((candidate): candidate is TFolder => candidate instanceof TFolder && candidate.path !== "/")
      .map((folder) => ({ path: folder.path, kind: "folder" as const }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  private async addCanvasStep(
    kind: CanvasStepKind,
    file: TFile,
    view: CanvasHost,
    anchor?: HTMLElement
  ): Promise<void> {
    const path = await this.chooseStepPath(kind, anchor);
    if (!path) return;

    const canvas = view.canvas;
    if (!canvas) return;
    const selected = [...((canvas.selection ?? []) as any[])].find(
      (node: any) => node?.getData?.().type === "text"
    );
    const selectedData = selected?.getData?.();
    const selectedStep = selectedData?.text
      ? stepConfigFromObject(
          extractStepBlocks(selectedData.text)[0]?.config ?? {},
          "preview"
        ).step
      : undefined;

    const text =
      kind === "source"
        ? ["```langscape", "type: source", `path: ${path}`, "field: word", "```"].join("\n")
        : kind === "sound-change"
          ? ["```langscape", "type: sound-change", `file: ${path}`, "```"].join("\n")
          : [
              "```langscape",
              "type: output",
              `path: ${path}`,
              /\.wli$/i.test(path) ? "format: wli" : "format: markdown",
              "field: word",
              "```",
            ].join("\n");

    const pos = selectedData
      ? { x: selectedData.x + selectedData.width + 60, y: selectedData.y }
      : (() => {
          const center = canvas.posCenter();
          return { x: center.x - 165, y: center.y - 92 };
        })();

    const node = canvas.createTextNode({
      pos,
      size: { width: 330, height: 185 },
      text,
      focus: false,
      save: false,
    });

    if (selected && selectedStep) {
      let from: string | undefined;
      let to: string | undefined;
      if (kind === "source" && selectedStep.kind !== "source") {
        from = node.id;
        to = selected.id;
      } else if (kind !== "source" && selectedStep.kind !== "output") {
        from = selected.id;
        to = node.id;
      }
      if (from && to) {
        const data = canvas.getData();
        data.edges = [
          ...(data.edges ?? []),
          {
            id: `langscape-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            fromNode: from,
            toNode: to,
            fromSide: "right",
            toSide: "left",
          },
        ];
        canvas.importData(data, true);
      }
    }
    canvas.requestSave();
    this.app.workspace.trigger("langscape:canvas-modified", file.path);
    canvas.selectOnly(node);
    try {
      canvas.panIntoView(node.getBBox());
      canvas.virtualize();
    } catch {
      // Older Canvas builds may not expose these helpers.
    }
    await (view as { save?: () => Promise<void> }).save?.();
  }

  private addCommands(): void {
    this.addCommand({
      id: "run-canvas-pipeline",
      name: "Run all pipelines in the active canvas",
      checkCallback: (checking) => {
        const file = this.getActiveCanvasFile();
        if (!file) return false;
        if (checking) return true;
        void this.runCanvasByPath(file.path);
        return true;
      },
    });

    this.addCommand({
      id: "create-sound-change-file",
      name: "Create sound-change file",
      callback: () => void this.createSoundChangeFile(),
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

  private addRibbonIcons(): void {
    this.addRibbonIcon("type", "Langscape: insert custom-font text", () => {
      void this.insertFontSpan();
    });
    this.addRibbonIcon("languages", "Langscape: new sound-change file", () => {
      void this.createSoundChangeFile();
    });
  }

  private async availablePath(base: string, extension: string): Promise<string> {
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
