import { TextFileView, type TFile, type WorkspaceLeaf } from "obsidian";
import type LangscapePlugin from "../main";
import type { ValidationResult } from "../lexurgy/service";
import { cleanLexurgyMessage } from "../lexurgy/protocol";
import { SoundChangeEditor } from "./editor";
import { parseOutline, type LexurgyOutline, type LexurgyRule } from "./outline";
import { SoundChangeTestPanel } from "./panel";

export const SOUNDCHANGE_VIEW_TYPE = "langscape-sound-change";

export class SoundChangeView extends TextFileView {
  private editor: SoundChangeEditor | null = null;
  private panel: SoundChangeTestPanel | null = null;
  private outline: LexurgyOutline = parseOutline("");
  private editorHost!: HTMLElement;
  private testHost!: HTMLElement;
  private errorBar!: HTMLElement;
  private lastValidation: ValidationResult | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: LangscapePlugin
  ) {
    super(leaf);
    this.navigation = true;
  }

  getViewType(): string {
    return SOUNDCHANGE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Sound changes";
  }

  getIcon(): string {
    return "languages";
  }

  async onOpen(): Promise<void> {
    this.buildLayout();
    void this.panel?.refreshEnvironment();
  }

  async onClose(): Promise<void> {
    this.editor?.destroy();
    this.editor = null;
    this.panel = null;
    this.contentEl.empty();
  }

  setViewData(data: string, clear: boolean): void {
    this.data = data;
    if (!this.editor) {
      this.editor = new SoundChangeEditor({
        parent: this.editorHost,
        doc: data,
        onChange: (doc) => this.handleChange(doc),
        validate: (doc) => this.plugin.lexurgy.validate(doc),
        onValidationStarted: () => this.panel?.setCompileStatus("checking", "Checking…"),
        onValidation: (result) => this.handleValidation(result),
        onSave: () => {
          void this.save();
          this.editor?.requestValidation();
        },
      });
    } else {
      this.editor.setDoc(data);
    }

    const path = this.file?.path ?? "";
    if (this.panel) {
      this.panel.setWords(this.plugin.getTestWords(path), clear || !this.panel.words);
      this.refreshOutline();
      if (clear) void this.panel.refreshEnvironment();
    }
    this.editor.requestValidation();
  }

  getViewData(): string {
    return this.editor?.getDoc() ?? this.data;
  }

  clear(): void {
    this.data = "";
    this.editor?.setDoc("");
    this.panel?.setWords("", true);
    this.outline = parseOutline("");
    this.clearError();
    this.panel?.setCompileStatus("unknown", "Not checked");
  }

  private buildLayout(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("langscape-lsc-view");

    this.errorBar = root.createDiv({ cls: "langscape-error-bar is-hidden" });
    this.errorBar.addEventListener("click", () => {
      const line = this.lastValidation?.line;
      if (line) this.editor?.scrollToLine(line);
    });

    const main = root.createDiv({ cls: "langscape-lsc-main" });
    const editorPane = main.createDiv({ cls: "langscape-lsc-editor-pane" });
    this.editorHost = editorPane.createDiv({ cls: "langscape-lsc-editor" });
    const resizer = main.createDiv({
      cls: "langscape-lsc-resizer",
      attr: {
        role: "separator",
        "aria-orientation": "vertical",
        "aria-label": "Resize the test bench",
        tabindex: "0",
        title: "Drag to resize the test bench · double-click to reset",
      },
    });

    const side = main.createDiv({ cls: "langscape-lsc-side" });
    this.testHost = side.createDiv({ cls: "langscape-test-host" });
    this.setupSideResize(main, resizer, side);

    // The panel is created here rather than in onOpen so it exists before the
    // first setViewData call.
    this.panel = new SoundChangeTestPanel(this.testHost, {
      getSource: () => this.editor?.getDoc() ?? this.data,
      getOutline: () => this.outline,
      run: (changes, words, options) => this.plugin.lexurgy.apply(changes, words, options),
      getEnvironment: () => this.plugin.lexurgy.getEnvironment(),
      onOpenSettings: () => this.plugin.openSettings(),
      onInstall: () => this.plugin.installLexurgyFromUi(),
      onWordsChange: (words) => {
        const path = this.file?.path;
        if (path) this.plugin.setTestWords(path, words);
      },
      initialWords: "",
      traceDefault: this.plugin.settings.traceByDefault,
    });
    this.panel.refreshOutline(this.outline);
  }

  private setupSideResize(main: HTMLElement, handle: HTMLElement, side: HTMLElement): void {
    const win = main.ownerDocument.defaultView ?? window;
    const body = main.ownerDocument.body;
    const storageKey = "langscape-lsc-side-width";
    const minSide = 280;
    const minEditor = 320;
    const defaultSide = 390;

    const apply = (width: number, save = false): void => {
      const bounded = Math.round(
        Math.max(minSide, Math.min(width, Math.max(minSide, main.clientWidth - minEditor)))
      );
      side.style.flex = `0 0 ${bounded}px`;
      side.style.width = `${bounded}px`;
      handle.setAttribute("aria-valuenow", String(bounded));
      if (save) {
        try {
          win.localStorage.setItem(storageKey, String(bounded));
        } catch {
          // Storage can be unavailable in restricted renderer contexts.
        }
      }
    };

    let saved = defaultSide;
    try {
      const stored = Number(win.localStorage.getItem(storageKey));
      if (Number.isFinite(stored) && stored >= minSide) saved = stored;
    } catch {
      // Use the default width.
    }
    win.requestAnimationFrame(() => apply(saved));

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || main.clientWidth <= 760) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = side.getBoundingClientRect().width;
      const move = (moveEvent: PointerEvent): void => {
        apply(startWidth + (startX - moveEvent.clientX));
      };
      const finish = (): void => {
        win.removeEventListener("pointermove", move);
        win.removeEventListener("pointerup", finish);
        win.removeEventListener("pointercancel", finish);
        body.removeClass("langscape-resizing");
        apply(side.getBoundingClientRect().width, true);
      };
      win.addEventListener("pointermove", move);
      win.addEventListener("pointerup", finish);
      win.addEventListener("pointercancel", finish);
      body.addClass("langscape-resizing");
    });

    handle.addEventListener("dblclick", () => {
      apply(defaultSide, true);
    });

    handle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const current = side.getBoundingClientRect().width;
      apply(current + (event.key === "ArrowLeft" ? 24 : -24), true);
    });
  }

  private handleChange(doc: string): void {
    this.data = doc;
    this.requestSave();
    this.refreshOutline();
  }

  private handleValidation(result: ValidationResult): void {
    this.lastValidation = result;
    if (result.valid) {
      this.panel?.setCompileStatus("valid", "Compiles", "Valid Lexurgy");
      this.clearError();
      return;
    }
    const line = result.line;
    this.panel?.setCompileStatus("error", line ? `Error · line ${line}` : "Error");
    const message = cleanLexurgyMessage(result.error?.message ?? "Invalid Lexurgy file");
    this.errorBar.removeClass("is-hidden");
    this.errorBar.empty();
    this.errorBar.createSpan({ cls: "langscape-error-label", text: line ? `Line ${line}` : "Lexurgy" });
    this.errorBar.createSpan({ text: message });
    this.errorBar.setAttr("title", "Click to jump to the error");
  }

  private clearError(): void {
    this.lastValidation = null;
    this.errorBar?.addClass("is-hidden");
    this.errorBar?.empty();
  }

  private refreshOutline(): void {
    if (!this.editor) return;
    this.outline = parseOutline(this.editor.getDoc());
    this.panel?.refreshOutline(this.outline);
  }

}

export function isSoundChangeFile(file: TFile | null | undefined): boolean {
  return Boolean(file && file.extension.toLowerCase() === "lsc");
}

export type { LexurgyRule };
