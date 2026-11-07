import { Notice, setIcon } from "obsidian";
import type { LexurgyEnvironment } from "../lexurgy/locator";
import { LexurgyError, type LexurgyApplyResult } from "../lexurgy/server";
import { cleanLexurgyMessage } from "../lexurgy/protocol";
import { openJavaDownload } from "../lexurgy/java";
import type { LexurgyOutline } from "./outline";

export interface TestPanelOptions {
  getSource: () => string;
  getOutline: () => LexurgyOutline;
  run: (
    changes: string,
    words: string[],
    options: { startAt?: string; stopBefore?: string; traceWords?: string[] }
  ) => Promise<LexurgyApplyResult>;
  getEnvironment: () => Promise<LexurgyEnvironment>;
  onOpenSettings: () => void;
  onInstall: () => Promise<void>;
  onWordsChange: (words: string) => void;
  initialWords: string;
  traceDefault: boolean;
}

const MAX_WORDS = 2_000;
const MAX_TRACED_WORDS = 80;

export class SoundChangeTestPanel {
  private readonly root: HTMLElement;
  private readonly wordsEl: HTMLTextAreaElement;
  private readonly fromEl: HTMLSelectElement;
  private readonly stopEl: HTMLSelectElement;
  private readonly traceEl: HTMLInputElement;
  private readonly runButton: HTMLButtonElement;
  private readonly compileEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly errorEl: HTMLElement;
  private readonly resultsEl: HTMLElement;
  private readonly traceOutEl: HTMLElement;
  private readonly setupEl: HTMLElement;
  private lastResult: LexurgyApplyResult | null = null;
  private lastWords: string[] = [];
  private lastTraceWords = new Set<string>();
  private busy = false;
  private dirty = false;

  constructor(
    parent: HTMLElement,
    private readonly options: TestPanelOptions
  ) {
    this.root = parent.createDiv({ cls: "langscape-test-panel" });

    const header = this.root.createDiv({ cls: "langscape-test-header" });
    const title = header.createDiv({ cls: "langscape-test-title" });
    title.createSpan({ text: "Test bench" });
    this.compileEl = title.createSpan({
      cls: "langscape-validation-status is-unknown",
      text: "Not checked",
    });
    this.statusEl = title.createSpan({ cls: "langscape-lexurgy-status is-unknown", text: "Lexurgy" });
    this.runButton = header.createEl("button", {
      cls: "mod-cta langscape-run-button",
      attr: { "aria-label": "Apply sound changes to the test words" },
    });
    setIcon(this.runButton, "play");
    this.runButton.createSpan({ text: "Run" });
    this.runButton.addEventListener("click", () => void this.run());

    this.setupEl = this.root.createDiv({ cls: "langscape-setup-banner is-hidden" });

    const wordsSetting = this.root.createDiv({ cls: "langscape-panel-field" });
    wordsSetting.createEl("label", { text: "Words", cls: "langscape-field-label" });
    this.wordsEl = wordsSetting.createEl("textarea", {
      cls: "langscape-words-input",
      attr: {
        rows: "4",
        spellcheck: "false",
        placeholder: "apa\neke\npataka",
      },
    });
    this.wordsEl.value = options.initialWords;
    this.wordsEl.addEventListener("input", () => {
      this.dirty = true;
      this.options.onWordsChange(this.wordsEl.value);
    });
    this.wordsEl.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void this.run();
      }
    });

    const rangeRow = this.root.createDiv({ cls: "langscape-range-row" });
    this.fromEl = this.selectField(rangeRow, "From rule", "All rules");
    this.stopEl = this.selectField(rangeRow, "Stop before", "End of file");

    const optionsRow = this.root.createDiv({ cls: "langscape-options-row" });
    const traceLabel = optionsRow.createEl("label", { cls: "langscape-checkbox-label" });
    this.traceEl = traceLabel.createEl("input", { type: "checkbox" });
    this.traceEl.checked = options.traceDefault;
    traceLabel.createSpan({ text: "Trace applied rules" });
    this.traceEl.addEventListener("change", () => {
      if (this.lastResult) {
        this.renderResults(this.lastResult, this.lastWords);
      }
    });

    this.errorEl = this.root.createDiv({ cls: "langscape-error is-hidden" });
    this.resultsEl = this.root.createDiv({ cls: "langscape-results" });
    this.traceOutEl = this.root.createDiv({ cls: "langscape-trace is-hidden" });
  }

  get words(): string {
    return this.wordsEl.value;
  }

  setCompileStatus(
    kind: "unknown" | "checking" | "valid" | "error",
    text: string,
    title?: string
  ): void {
    this.compileEl.className = `langscape-validation-status is-${kind}`;
    this.compileEl.setText(text);
    this.compileEl.title = title ?? "";
  }

  setWords(words: string, force = false): void {
    if (!force && this.dirty) return;
    this.wordsEl.value = words;
    this.dirty = false;
  }

  refreshOutline(outline: LexurgyOutline): void {
    this.fillRuleSelect(this.fromEl, outline, "All rules");
    this.fillRuleSelect(this.stopEl, outline, "End of file");
  }

  async refreshEnvironment(): Promise<LexurgyEnvironment> {
    this.statusEl.className = "langscape-lexurgy-status is-checking";
    this.statusEl.textContent = "Checking Lexurgy…";
    try {
      const env = await this.options.getEnvironment();
      if (env.installation) {
        this.statusEl.className = "langscape-lexurgy-status is-ready";
        this.statusEl.textContent = `Lexurgy ready${env.installation.version ? ` · ${env.installation.version}` : ""}`;
        this.statusEl.title = env.installation.label;
        this.setupEl.addClass("is-hidden");
      } else {
        this.statusEl.className = "langscape-lexurgy-status is-missing";
        this.statusEl.textContent = "Lexurgy not found";
        this.statusEl.title = env.error ?? "";
        this.renderSetup(env);
      }
      return env;
    } catch (error) {
      this.statusEl.className = "langscape-lexurgy-status is-missing";
      this.statusEl.textContent = "Lexurgy unavailable";
      this.setupEl.removeClass("is-hidden");
      this.setupEl.empty();
      this.setupEl.createDiv({
        text: error instanceof Error ? error.message : String(error),
      });
      return { notes: [], error: String(error) };
    }
  }

  async run(): Promise<void> {
    if (this.busy) return;
    const words = parseWords(this.wordsEl.value);
    if (words.length === 0) {
      this.showError("Enter at least one word to test.");
      return;
    }
    if (words.length > MAX_WORDS) {
      this.showError(`Too many words (${words.length}); the test bench is limited to ${MAX_WORDS}.`);
      return;
    }
    const changes = this.options.getSource();
    if (!changes.trim()) {
      this.showError("The sound-change file is empty.");
      return;
    }

    const traced = this.traceEl.checked ? words.slice(0, MAX_TRACED_WORDS) : [];
    this.setBusy(true);
    this.hideError();
    try {
      const result = await this.options.run(changes, words, {
        startAt: this.fromEl.value || undefined,
        stopBefore: this.stopEl.value || undefined,
        traceWords: traced,
      });
      this.lastResult = result;
      this.lastWords = words;
      this.lastTraceWords.clear();
      if (traced.length) this.lastTraceWords.add(words[0]);
      this.renderResults(result, words);
    } catch (error) {
      const message =
        error instanceof LexurgyError
          ? cleanLexurgyMessage(error.message)
          : error instanceof Error
            ? error.message
            : String(error);
      this.showError(message, error instanceof LexurgyError ? error.line : undefined);
      this.resultsEl.empty();
      this.traceOutEl.empty();
      this.lastResult = null;
      if (/java|install|not found|not installed/i.test(message)) {
        void this.refreshEnvironment();
      }
    } finally {
      this.setBusy(false);
    }
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.runButton.disabled = busy;
    this.runButton.toggleClass("is-loading", busy);
    const label = this.runButton.querySelector("span");
    if (label) label.setText(busy ? "Running…" : "Run");
  }

  private renderSetup(env: LexurgyEnvironment): void {
    this.setupEl.removeClass("is-hidden");
    this.setupEl.empty();
    this.setupEl.createDiv({ cls: "langscape-setup-title", text: "Lexurgy is required" });
    this.setupEl.createDiv({
      cls: "langscape-setup-text",
      text:
        env.error ??
        "Langscape uses the official Lexurgy CLI to apply sound changes. Install it below or configure an existing installation.",
    });
    const row = this.setupEl.createDiv({ cls: "langscape-setup-actions" });
    if (!env.java) {
      const java = row.createEl("button", { cls: "mod-cta", text: "Get Java" });
      java.addEventListener("click", () => openJavaDownload());
    }
    const install = row.createEl("button", {
      cls: env.java ? "mod-cta" : "",
      text: "Install Lexurgy",
    });
    install.addEventListener("click", async () => {
      install.disabled = true;
      install.setText("Installing…");
      try {
        await this.options.onInstall();
        await this.refreshEnvironment();
      } catch (error) {
        new Notice(
          `Lexurgy install failed: ${error instanceof Error ? error.message : String(error)}`
        );
      } finally {
        install.disabled = false;
        install.setText("Install Lexurgy");
      }
    });
    const settings = row.createEl("button", { text: "Settings" });
    settings.addEventListener("click", () => this.options.onOpenSettings());
    const link = row.createEl("a", {
      text: "What is Lexurgy?",
      href: "https://www.lexurgy.com/sc",
    });
    link.setAttr("target", "_blank");
    link.setAttr("rel", "noopener");
  }

  private selectedTraceWords(): string[] {
    return this.lastWords.filter((word) => this.lastTraceWords.has(word));
  }

  private renderResults(result: LexurgyApplyResult, inputs: string[]): void {
    this.lastResult = result;
    this.lastWords = inputs;
    this.resultsEl.empty();
    this.traceOutEl.empty();

    const traceEnabled = this.traceEl.checked && result.traceLines.length > 0;
    for (const word of [...this.lastTraceWords]) {
      if (!inputs.includes(word)) this.lastTraceWords.delete(word);
    }
    if (traceEnabled && this.selectedTraceWords().length === 0) {
      const first = inputs.find((word) => traceStagesForWord(result.traceLines, word));
      if (first) this.lastTraceWords.add(first);
    }

    const table = this.resultsEl.createEl("table", { cls: "langscape-results-table" });
    const head = table.createTHead().insertRow();
    head.createEl("th", { text: "#" });
    head.createEl("th", { text: "Input" });
    head.createEl("th", { text: "Output" });
    if (traceEnabled) head.createEl("th", { text: "Trace" });
    const body = table.createTBody();

    const selectedWords = (): string[] =>
      inputs.filter((word) => this.lastTraceWords.has(word));

    const syncSelection = (): void => {
      body.querySelectorAll<HTMLInputElement>(".langscape-trace-check").forEach((box, index) => {
        box.checked = this.lastTraceWords.has(inputs[index]);
      });
      body.querySelectorAll("tr").forEach((row, index) => {
        row.toggleClass("is-selected", this.lastTraceWords.has(inputs[index]));
      });
    };

    result.words.forEach((output, index) => {
      const row = body.insertRow();
      if (output !== inputs[index]) row.addClass("is-changed");
      row.insertCell().textContent = String(index + 1);
      row.insertCell().textContent = inputs[index];
      row.insertCell().textContent = output;
      if (traceEnabled) {
        const traceCell = row.insertCell();
        traceCell.addClass("langscape-trace-cell");
        const box = traceCell.createEl("input", {
          type: "checkbox",
          cls: "langscape-trace-check",
          attr: { "aria-label": `Show trace for ${inputs[index]}` },
        });
        box.checked = this.lastTraceWords.has(inputs[index]);
        box.addEventListener("click", (event) => event.stopPropagation());
        box.addEventListener("change", () => {
          if (box.checked) this.lastTraceWords.add(inputs[index]);
          else this.lastTraceWords.delete(inputs[index]);
          syncSelection();
          this.renderTrace(selectedWords());
        });
        row.addClass("is-clickable");
        row.addEventListener("click", () => {
          if (this.lastTraceWords.has(inputs[index])) this.lastTraceWords.delete(inputs[index]);
          else this.lastTraceWords.add(inputs[index]);
          syncSelection();
          this.renderTrace(selectedWords());
        });
        if (this.lastTraceWords.has(inputs[index])) row.addClass("is-selected");
      }
    });

    this.renderTrace(this.traceEl.checked ? selectedWords() : []);
  }

  private renderTrace(words: string[]): void {
    this.traceOutEl.empty();
    if (!this.traceEl.checked) {
      this.traceOutEl.addClass("is-hidden");
      return;
    }
    this.traceOutEl.removeClass("is-hidden");
    if (!this.lastResult) {
      this.traceOutEl.addClass("is-hidden");
      return;
    }
    if (!this.lastResult.traceLines.length) {
      this.traceOutEl.createDiv({
        cls: "langscape-muted",
        text: "No trace was collected for this run. Run again with “Trace applied rules” enabled.",
      });
      return;
    }
    if (words.length === 0) {
      this.traceOutEl.addClass("is-hidden");
      return;
    }

    const traces = words.map((word) => ({
      word,
      trace: traceStagesForWord(this.lastResult!.traceLines, word),
    }));
    if (!traces.some((entry) => entry.trace && entry.trace.stages.length > 0)) {
      this.traceOutEl.createDiv({
        cls: "langscape-muted",
        text: "No rules changed the selected words.",
      });
      return;
    }

    const rules: string[] = [];
    for (const entry of traces) {
      for (const stage of entry.trace?.stages ?? []) {
        if (!rules.includes(stage.rule)) rules.push(stage.rule);
      }
    }

    const card = this.traceOutEl.createDiv({ cls: "langscape-trace-card" });
    const header = card.createDiv({ cls: "langscape-trace-head" });
    header.createSpan({ cls: "langscape-trace-title", text: "Trace" });
    const nav = header.createDiv({ cls: "langscape-trace-nav" });
    const scrollLeft = nav.createEl("button", {
      cls: "langscape-trace-nav-button",
      attr: { "aria-label": "Scroll trace left", type: "button" },
    });
    setIcon(scrollLeft, "chevron-left");
    const scrollRight = nav.createEl("button", {
      cls: "langscape-trace-nav-button",
      attr: { "aria-label": "Scroll trace right", type: "button" },
    });
    setIcon(scrollRight, "chevron-right");

    const scroll = card.createDiv({
      cls: "langscape-trace-scroll",
      attr: {
        tabindex: "0",
        "aria-label": "Trace table; scroll sideways to see more words",
        title: "Scroll sideways to see more words",
      },
    });
    const table = scroll.createEl("table", { cls: "langscape-trace-table" });
    const head = table.createTHead().insertRow();
    head.createEl("th", { text: "Iteration" });
    for (const entry of traces) {
      head.createEl("th", { text: entry.word, cls: "langscape-trace-word" });
    }

    const body = table.createTBody();
    const inputRow = body.insertRow();
    inputRow.addClass("is-input");
    inputRow.insertCell().textContent = "Input";
    const current = traces.map((entry) => entry.trace?.input || entry.word);
    traces.forEach((entry, index) => {
      inputRow.insertCell().textContent = current[index];
    });

    for (const rule of rules) {
      const row = body.insertRow();
      row.insertCell().textContent = rule;
      traces.forEach((entry, index) => {
        const stage = entry.trace?.stages.find((candidate) => candidate.rule === rule);
        if (stage) current[index] = stage.form;
        row.insertCell().textContent = current[index];
      });
    }

    const updateScrollButtons = (): void => {
      const max = scroll.scrollWidth - scroll.clientWidth;
      scrollLeft.disabled = max <= 1 || scroll.scrollLeft <= 0;
      scrollRight.disabled = max <= 1 || scroll.scrollLeft >= max - 1;
      nav.toggleClass("is-hidden", max <= 1);
      scroll.toggleClass("has-overflow", max > 1);
    };
    const scrollStep = (): number => Math.max(120, Math.round(scroll.clientWidth * 0.7));
    scrollLeft.addEventListener("click", () => {
      scroll.scrollBy({ left: -scrollStep(), behavior: "smooth" });
    });
    scrollRight.addEventListener("click", () => {
      scroll.scrollBy({ left: scrollStep(), behavior: "smooth" });
    });
    scroll.addEventListener("scroll", updateScrollButtons, { passive: true });
    scroll.addEventListener(
      "wheel",
      (event) => {
        if (scroll.scrollWidth <= scroll.clientWidth) return;
        if (!event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
        const delta = event.deltaX || event.deltaY;
        if (!delta) return;
        event.preventDefault();
        scroll.scrollLeft += delta;
      },
      { passive: false }
    );
    requestAnimationFrame(updateScrollButtons);
  }

  private showError(message: string, line?: number): void {
    this.errorEl.removeClass("is-hidden");
    this.errorEl.setText(line ? `Line ${line}: ${message}` : message);
  }

  private hideError(): void {
    this.errorEl.addClass("is-hidden");
    this.errorEl.empty();
  }

  private selectField(parent: HTMLElement, label: string, first: string): HTMLSelectElement {
    const wrapper = parent.createDiv({ cls: "langscape-select-field" });
    wrapper.createEl("label", { text: label, cls: "langscape-field-label" });
    const select = wrapper.createEl("select", { cls: "dropdown" });
    addOption(select, "", first);
    return select;
  }

  private fillRuleSelect(select: HTMLSelectElement, outline: LexurgyOutline, first: string): void {
    const previous = select.value;
    select.empty();
    addOption(select, "", first);
    for (const rule of outline.rules) {
      addOption(select, rule.name, rule.name);
    }
    if ([...select.options].some((option) => option.value === previous)) {
      select.value = previous;
    }
  }
}

function addOption(select: HTMLSelectElement, value: string, label: string): void {
  const option = select.ownerDocument.createElement("option");
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

export function parseWords(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
}

/**
 * Lexurgy emits one `Tracing a, b, c` header followed by every applied rule
 * for every traced word. Split that back out so clicking a result row shows
 * the history for that word.
 */
export interface TraceStage {
  rule: string;
  form: string;
}

export interface WordTrace {
  input: string;
  stages: TraceStage[];
}

/** Turn Lexurgy's applied-rule lines into a vertical list of iterations. */
export function traceStagesForWord(lines: string[], word: string): WordTrace | null {
  const applied = lines.filter(
    (line) => /^Applied\b/.test(line) && line.includes(`to ${word}:`)
  );
  const stages: TraceStage[] = [];
  let input: string | undefined;
  for (const line of applied) {
    const match = /^Applied\s+(.+?)\s+to\s+(.+?):\s*(.*?)\s*->\s*(.*)$/.exec(line);
    if (!match) continue;
    input ??= match[3].trim();
    stages.push({ rule: match[1].trim(), form: match[4].trim() });
  }
  if (stages.length === 0) return null;
  return { input: input ?? word, stages };
}

export function traceLinesForWord(lines: string[], word?: string): string[] {
  const applied = lines.filter((line) => /^Applied\b/i.test(line));
  if (!word) return lines;
  const matching = applied.filter((line) => line.includes(`to ${word}:`));
  if (matching.length > 0) return [`Tracing ${word}`, ...matching];
  const header = lines.find((line) => /^Tracing\b/i.test(line));
  return header ? [header, ...applied] : applied;
}

export function groupTraceLines(lines: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  const header = lines.find((line) => /^Tracing\b/i.test(line));
  const words = header
    ? header.replace(/^Tracing\s+/i, "").split(/,\s*/).map((word) => word.trim()).filter(Boolean)
    : [];
  for (const word of words) groups.set(word, traceLinesForWord(lines, word));
  return groups;
}
