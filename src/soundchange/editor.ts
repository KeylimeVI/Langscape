import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
} from "@codemirror/language";
import { forceLinting, linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { cleanLexurgyMessage } from "../lexurgy/protocol";
import { LexurgyError } from "../lexurgy/server";
import type { ValidationResult } from "../lexurgy/service";
import { createLexurgyHighlightExtension } from "./language";
import { lineRange } from "./outline";

export interface SoundChangeEditorOptions {
  parent: HTMLElement;
  doc: string;
  onChange: (doc: string) => void;
  onCursorLine?: (line: number) => void;
  validate: (doc: string) => Promise<ValidationResult>;
  onValidationStarted?: () => void;
  onValidation?: (result: ValidationResult) => void;
  onSave?: () => void;
}

export class SoundChangeEditor {
  readonly view: EditorView;
  private validationCache: { doc: string; promise: Promise<ValidationResult> } | null = null;
  private disposed = false;
  private suppressChange = false;

  constructor(private readonly options: SoundChangeEditorOptions) {
    const theme = EditorView.theme({
      "&": {
        height: "100%",
        backgroundColor: "transparent",
        color: "var(--text-normal)",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--text-normal)",
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor:
          "color-mix(in srgb, var(--text-normal) 16%, var(--background-primary))",
      },
      ".cm-scroller": {
        fontFamily: "var(--font-monospace)",
        lineHeight: "1.55",
        overflow: "auto",
      },
      ".cm-content": {
        padding: "10px 0 40px",
        caretColor: "var(--text-normal)",
        color: "var(--text-normal)",
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        border: "none",
        color: "var(--text-faint)",
      },
      ".cm-activeLine": {
        backgroundColor: "var(--background-modifier-hover)",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent",
        color: "var(--text-muted)",
      },
      "&.cm-focused": {
        outline: "none",
      },
      ".cm-lintRange-error": {
        textDecorationColor: "var(--text-error)",
      },
    });

    const lintExtension = linter(
      async (view) => {
        const doc = view.state.doc.toString();
        this.options.onValidationStarted?.();
        const result = await this.validateDoc(doc);
        if (this.disposed || doc !== view.state.doc.toString()) return [];
        this.options.onValidation?.(result);
        if (result.valid) return [];
        const lineNumber = Math.max(1, result.line ?? 1);
        const line = view.state.doc.line(Math.min(lineNumber, view.state.doc.lines));
        const diagnostic: Diagnostic = {
          from: line.from,
          to: line.to,
          severity: "error",
          message: cleanLexurgyMessage(result.error?.message ?? "Invalid Lexurgy file"),
        };
        return [diagnostic];
      },
      { delay: 600 }
    );

    const state = EditorState.create({
      doc: options.doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        foldGutter(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        rectangularSelection(),
        EditorState.tabSize.of(2),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...foldKeymap,
          indentWithTab,
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              this.options.onSave?.();
              return true;
            },
          },
        ]),
        createLexurgyHighlightExtension(),
        lintGutter(),
        lintExtension,
        EditorView.lineWrapping,
        theme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            this.validationCache = null;
            if (!this.suppressChange) this.options.onChange(update.state.doc.toString());
          }
          if (update.selectionSet || update.docChanged) {
            const line = update.state.doc.lineAt(update.state.selection.main.head).number;
            this.options.onCursorLine?.(line);
          }
        }),
      ],
    });

    this.view = new EditorView({ state, parent: options.parent });
  }

  getDoc(): string {
    return this.view.state.doc.toString();
  }

  setDoc(doc: string): void {
    if (doc === this.getDoc()) return;
    this.suppressChange = true;
    try {
      this.view.dispatch({
        changes: { from: 0, to: this.view.state.doc.length, insert: doc },
        selection: { anchor: 0 },
      });
    } finally {
      this.suppressChange = false;
    }
    this.validationCache = null;
  }

  focus(): void {
    this.view.focus();
  }

  /** Run validation immediately (used when a file is opened or saved). */
  requestValidation(): void {
    forceLinting(this.view);
  }

  scrollToLine(line: number): void {
    const doc = this.view.state.doc;
    const clamped = Math.max(1, Math.min(line, doc.lines));
    const info = doc.line(clamped);
    this.view.dispatch({
      selection: { anchor: info.from },
      effects: EditorView.scrollIntoView(info.from, { y: "center" }),
    });
    this.view.focus();
  }

  /** Highlight an erroneous line even if the linter has not caught up yet. */
  markLine(line: number): void {
    this.scrollToLine(line);
  }

  destroy(): void {
    this.disposed = true;
    this.view.destroy();
  }

  private validateDoc(doc: string): Promise<ValidationResult> {
    if (this.validationCache?.doc === doc) return this.validationCache.promise;
    const promise = this.options.validate(doc).catch(
      (error): ValidationResult => ({
        valid: false,
        error:
          error instanceof LexurgyError
            ? error
            : new LexurgyError(error instanceof Error ? error.message : String(error)),
      })
    );
    this.validationCache = { doc, promise };
    return promise;
  }
}

/** Used by the view to render a compact error banner from a diagnostic. */
export function diagnosticLine(result: ValidationResult, doc: string): number {
  if (result.line) return result.line;
  const match = /\(line\s+(\d+)\)/i.exec(result.error?.message ?? "");
  if (!match) return 1;
  const line = Number.parseInt(match[1], 10);
  return Number.isFinite(line) ? Math.max(1, Math.min(line, doc.split("\n").length)) : 1;
}

export { lineRange };
