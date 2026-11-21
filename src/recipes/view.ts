import { setIcon, TextFileView, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import type LangscapePlugin from "../main";
import { pickPath, type PathOption } from "../ui/path-picker";
import { readRecipe, serializeRecipe, type Recipe } from "./model";
import { listRecipeRules } from "./rules";
import { listRecipeProperties, runRecipe } from "./runner";

export const RECIPE_VIEW_TYPE = "langscape-recipe";

type Change = Recipe["changes"][number];
type Result = { state: "success" | "error"; message: string };
type PropertyQuery =
  | { state: "loading" }
  | { state: "ready"; names: string[] }
  | { state: "error"; message: string };

interface Card {
  fields: HTMLFieldSetElement;
  property: HTMLSelectElement;
  propertyHint: HTMLElement;
  changes: HTMLOListElement;
  changeHint: HTMLElement;
  run: HTMLButtonElement;
  result: HTMLElement;
}

interface ChangeRow {
  details: HTMLDetailsElement;
  up: HTMLButtonElement;
  down: HTMLButtonElement;
  remove: HTMLButtonElement;
}

let nextPropertyId = 0;

export class RecipeView extends TextFileView {
  private readonly propertyId = `langscape-recipe-property-${++nextPropertyId}`;
  private isOpen = false;
  private revision = 0;
  // TextFileView uses `data` as its last saved snapshot, not as editable state.
  private source = "";
  private recipe: Recipe | null = null;
  private parseError: string | null = null;
  private propertyQuery: PropertyQuery | null = null;
  private runningFor: number | null = null;
  private result: Result | null = null;
  private card: Card | null = null;
  private rows: ChangeRow[] = [];

  constructor(leaf: WorkspaceLeaf, private readonly plugin: LangscapePlugin) {
    super(leaf);
    this.navigation = true;
  }

  getViewType(): string {
    return RECIPE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Sound change recipe";
  }

  getIcon(): string {
    return "list-ordered";
  }

  async onOpen(): Promise<void> {
    this.isOpen = true;
    this.contentEl.addClass("langscape-recipe-view");
    this.render();
    void this.refreshProperties();
  }

  async onClose(): Promise<void> {
    this.isOpen = false;
    this.revision++;
    this.propertyQuery = null;
    this.card = null;
    this.rows = [];
    this.contentEl.empty();
  }

  getViewData(): string {
    return this.source;
  }

  setViewData(data: string, clear: boolean): void {
    if (!clear && data === this.source && (this.recipe || this.parseError !== null)) return;
    this.source = data;
    this.revision++;
    this.result = null;
    this.propertyQuery = null;
    this.parseError = null;
    this.recipe = null;
    try {
      this.recipe = readRecipe(data);
    } catch (error) {
      this.parseError = describeError(error);
    }
    if (this.isOpen) {
      this.render();
      void this.refreshProperties();
    }
  }

  clear(): void {
    this.source = "";
    this.revision++;
    this.recipe = null;
    this.parseError = null;
    this.propertyQuery = null;
    this.result = null;
    if (this.isOpen) this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.card = null;
    this.rows = [];
    if (!this.recipe && this.parseError === null) return;

    const card = this.contentEl.createDiv({ cls: "langscape-recipe-card" });
    const header = card.createEl("header", { cls: "langscape-recipe-header" });
    setIcon(header.createSpan({ cls: "langscape-recipe-icon", attr: { "aria-hidden": "true" } }), this.getIcon());
    const heading = header.createDiv();
    heading.createEl("h2", { text: "Sound change recipe" });
    heading.createEl("p", { text: "Apply an ordered set of sound changes to a property on your word notes." });

    const recipe = this.recipe;
    if (!recipe) {
      this.renderRecovery(card);
      return;
    }

    const fields = card.createEl("fieldset", {
      cls: "langscape-recipe-fields",
      attr: { "aria-label": "Recipe settings" },
    });
    const input = section(fields, "1", "Input", "Choose the folder of notes and the text property to transform.");
    const inputs = input.createDiv({ cls: "langscape-recipe-inputs" });
    this.renderFolder(inputs, "inputFolder", "Input folder", "input-folder");
    const propertyField = inputs.createDiv({ cls: "langscape-recipe-field" });
    propertyField.createEl("label", { text: "Property", attr: { for: this.propertyId } });
    const property = propertyField.createEl("select", {
      cls: "dropdown langscape-recipe-property",
      attr: { id: this.propertyId, "aria-describedby": `${this.propertyId}-hint` },
    });
    const propertyHint = propertyField.createDiv({
      cls: "langscape-recipe-hint",
      attr: { id: `${this.propertyId}-hint` },
    });
    property.addEventListener("change", () => {
      if (!this.recipe || this.card?.property !== property || this.runningFor === this.revision) return;
      if (this.propertyQuery?.state !== "ready" || !this.propertyQuery.names.includes(property.value)) return;
      this.commit({ ...this.recipe, property: property.value });
      propertyHint.textContent = "";
    });

    const changesSection = section(fields, "2", "Sound changes", "Files run from top to bottom. Each step can skip individual rules.");
    const changes = changesSection.createEl("ol", { cls: "langscape-recipe-changes" });
    const changeHint = changesSection.createEl("p", { cls: "langscape-recipe-hint" });
    const add = button(changesSection, "Add sound changes…", "add-change", "plus");
    add.addEventListener("click", () => void this.addChange(add));

    const output = section(fields, "3", "Output", "Writes copies of matching notes to a separate folder without overwriting existing notes.");
    this.renderFolder(output, "outputFolder", "Output folder", "output-folder");

    const footer = card.createEl("footer", { cls: "langscape-recipe-footer" });
    const run = button(footer, "Run recipe", "run", "play");
    run.addClass("mod-cta");
    run.addEventListener("click", () => void this.run());
    const result = footer.createDiv({
      cls: "langscape-recipe-result",
      attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
    });
    this.card = { fields, property, propertyHint, changes, changeHint, run, result };
    this.renderChanges();
    this.renderProperty();
  }

  private renderRecovery(card: HTMLElement): void {
    const recovery = card.createDiv({ cls: "langscape-recipe-recovery" });
    recovery.createEl("h3", { text: "This recipe couldn’t be read" });
    recovery.createEl("p", {
      text: "Recipe files use JSON, not YAML. Correct the source below, or clear it to start over. Nothing is saved until you apply readable source.",
    });
    const source = recovery.createEl("textarea", {
      cls: "langscape-recipe-source", attr: { "aria-label": "Recipe source", rows: "9", spellcheck: "false" },
    });
    source.value = this.getViewData();
    const error = recovery.createDiv({ cls: "langscape-recipe-source-error", attr: { role: "status" } });
    error.textContent = this.parseError;
    const apply = button(recovery, "Apply source", "apply-source");
    apply.addClass("mod-cta");
    apply.addEventListener("click", () => {
      if (!this.contentEl.contains(source)) return;
      const data = source.value;
      try {
        readRecipe(data);
      } catch (problem) {
        error.textContent = describeError(problem);
        return;
      }
      this.setViewData(data, true);
      this.requestSave();
      this.card?.fields.querySelector<HTMLButtonElement>(".langscape-recipe-input-folder")?.focus();
    });
  }

  private renderFolder(
    parent: HTMLElement,
    key: "inputFolder" | "outputFolder",
    label: string,
    part: string
  ): void {
    const field = parent.createDiv({ cls: "langscape-recipe-field" });
    field.createSpan({ text: label });
    const control = button(field, "", part, "folder");
    const value = control.createSpan();
    const showValue = () => {
      const path = this.recipe?.[key] ?? null;
      const name = path === "/" ? "Vault root (/)" : path;
      value.textContent = name ?? "Choose folder…";
      control.setAttribute("aria-label", name === null ? `Choose ${label.toLowerCase()}` : `${label}: ${name}`);
      control.title = name ?? "";
    };
    showValue();
    control.addEventListener("click", () => {
      const allowCustom = key === "outputFolder";
      void this.choose(control, {
        title: `Choose ${label.toLowerCase()}`,
        placeholder: allowCustom ? "Search folders or type a new path…" : "Search folders…",
        options: folderOptions(this.app.vault.getAllLoadedFiles()),
        allowCustom,
      }, (path, recipe) => {
        if (path !== recipe[key]) this.commit({ ...recipe, [key]: path });
        showValue();
        if (key === "inputFolder") void this.refreshProperties();
      });
    });
  }

  private async choose(
    anchor: HTMLButtonElement,
    options: Parameters<typeof pickPath>[0],
    selected: (path: string, recipe: Recipe) => void
  ): Promise<void> {
    const revision = this.revision;
    const current = () => this.revision === revision && this.runningFor !== revision && this.contentEl.contains(anchor);
    try {
      const path = await pickPath(options, anchor);
      if (path !== null && current() && this.recipe) {
        selected(path, this.recipe);
        anchor.focus();
      }
    } catch (error) {
      if (current()) {
        this.result = { state: "error", message: describeError(error) };
        this.renderResult();
      }
    }
  }

  private async refreshProperties(): Promise<void> {
    const folder = this.recipe?.inputFolder ?? null;
    const query: PropertyQuery | null = folder === null ? null : { state: "loading" };
    this.propertyQuery = query;
    this.renderProperty();
    if (folder === null) return;

    try {
      const names = await listRecipeProperties(this.app, folder);
      if (this.propertyQuery !== query) return;
      this.propertyQuery = { state: "ready", names };
    } catch (error) {
      if (this.propertyQuery !== query) return;
      this.propertyQuery = { state: "error", message: describeError(error) };
    }
    this.renderProperty();
  }

  private renderProperty(): void {
    const card = this.card;
    if (!card || !this.recipe) return;
    const { property, propertyHint } = card;
    const query = this.propertyQuery;
    const names = query?.state === "ready" ? query.names : [];
    const placeholder = query?.state === "loading" ? "Finding properties…"
      : names.length ? "Choose property…" : "No properties available";
    property.empty();
    const empty = property.createEl("option", { text: placeholder, value: "" });
    empty.disabled = true;
    for (const name of names) property.createEl("option", { text: name, value: name });
    const current = this.recipe.property;
    property.value = names.includes(current) ? current : "";
    property.disabled = !names.length;
    propertyHint.textContent = query?.state === "error" ? query.message
      : query?.state === "ready" && current && !names.includes(current) ? `“${current}” is not available in this folder.`
      : query?.state === "ready" && !names.length ? "No nonblank text properties found in this folder’s notes."
      : !query ? "Choose an input folder first." : "";
    this.renderResult();
  }

  private addChange(anchor: HTMLButtonElement): Promise<void> {
    const options = this.app.vault.getFiles()
      .filter((file) => file.extension.toLowerCase() === "lsc")
      .map((file) => ({ path: file.path, kind: "file" as const }))
      .sort((a, b) => a.path.localeCompare(b.path));
    if (options.length === 0) {
      this.result = { state: "error", message: "No .lsc files found in the vault." };
      this.renderResult();
      return Promise.resolve();
    }
    return this.choose(anchor, {
      title: "Add sound changes", placeholder: "Search .lsc files…", options,
    }, (path, recipe) => {
      const open = this.rows.map((row) => row.details.open);
      this.commit({ ...recipe, changes: [...recipe.changes, { path, disabledRules: [] }] });
      this.renderChanges(open);
    });
  }

  private renderChanges(open: boolean[] = []): void {
    if (!this.card || !this.recipe) return;
    const { changes } = this.recipe;
    this.card.changes.empty();
    this.card.changes.hidden = changes.length === 0;
    this.card.changeHint.textContent = changes.length ? "" : "Add at least one .lsc file to run the recipe.";
    const list = this.card.changes;
    this.rows = changes.map((change, index) => this.renderChange(list, change, index, changes.length, !!open[index]));
  }

  private renderChange(list: HTMLOListElement, change: Change, index: number, count: number, open: boolean): ChangeRow {
    const row = list.createEl("li", { cls: "langscape-recipe-change", attr: { "data-path": change.path } });
    const currentChange = () => this.card?.changes === list && list.contains(row) ? this.recipe?.changes[index] : undefined;
    const top = row.createDiv({ cls: "langscape-recipe-change-top" });
    top.createSpan({ cls: "langscape-recipe-step-number", text: String(index + 1), attr: { "aria-hidden": "true" } });
    const path = top.createSpan({ cls: "langscape-recipe-change-path", text: change.path });
    path.title = change.path;
    const actions = top.createDiv({ cls: "langscape-recipe-change-actions" });
    const itemLabel = `${change.path} (step ${index + 1})`;
    const up = iconButton(actions, `Move ${itemLabel} up`, "move-up", "arrow-up");
    const down = iconButton(actions, `Move ${itemLabel} down`, "move-down", "arrow-down");
    const remove = iconButton(actions, `Remove ${itemLabel}`, "remove-change", "x");
    up.disabled = index === 0;
    down.disabled = index === count - 1;
    up.addEventListener("click", () => { if (currentChange()) this.moveChange(index, -1); });
    down.addEventListener("click", () => { if (currentChange()) this.moveChange(index, 1); });
    remove.addEventListener("click", () => {
      if (!this.recipe || !currentChange() || this.runningFor === this.revision) return;
      const opened = this.rows.map((entry) => entry.details.open);
      opened.splice(index, 1);
      this.commit({ ...this.recipe, changes: this.recipe.changes.filter((_, position) => position !== index) });
      this.renderChanges(opened);
      const next = this.rows[Math.min(index, this.rows.length - 1)];
      (next?.remove ?? this.contentEl.querySelector<HTMLButtonElement>(".langscape-recipe-add-change"))?.focus();
    });

    const details = row.createEl("details", { cls: "langscape-recipe-advanced" });
    const summary = details.createEl("summary", { text: "Advanced" });
    const summaryCount = summary.createSpan({ cls: "langscape-recipe-rule-count" });
    const updateCount = (disabled: number) => {
      summaryCount.textContent = disabled ? ` · ${disabled} skipped` : "";
    };
    updateCount(change.disabledRules.length);
    const body = details.createDiv({ cls: "langscape-recipe-rules" });
    let loading = false;
    const setDisabledRules = (disabledRules: string[]) => {
      const entry = currentChange();
      const recipe = this.recipe;
      if (!entry || !recipe || this.runningFor === this.revision) return;
      this.commit({
        ...recipe,
        changes: recipe.changes.map((previous, position) => position === index ? { ...entry, disabledRules } : previous),
      });
      updateCount(disabledRules.length);
    };
    const showRules = async (): Promise<void> => {
      if (loading || !currentChange()) return;
      loading = true;
      body.textContent = "Reading rules…";
      try {
        const file = this.app.vault.getAbstractFileByPath(change.path);
        if (!(file instanceof TFile) || file.extension.toLowerCase() !== "lsc") {
          throw new Error("This sound-change file could not be found.");
        }
        const rules = listRecipeRules(await this.app.vault.cachedRead(file));
        const current = currentChange();
        if (!current) return;
        body.empty();
        if (rules.length) {
          body.createDiv({ cls: "langscape-recipe-hint", text: "Uncheck a rule to skip it for this step." });
          const ruleList = body.createDiv({ cls: "langscape-recipe-rule-list" });
          for (const name of rules) {
            const label = ruleList.createEl("label", { cls: "langscape-recipe-rule" });
            const checkbox = label.createEl("input", { type: "checkbox", attr: { "data-rule": name } });
            label.createSpan({ text: name });
            checkbox.checked = !current.disabledRules.includes(name);
            checkbox.addEventListener("change", () => {
              const entry = currentChange();
              if (!entry) return;
              const disabled = new Set(entry.disabledRules);
              if (checkbox.checked) disabled.delete(name);
              else disabled.add(name);
              setDisabledRules([...disabled]);
            });
          }
        } else {
          body.createDiv({ cls: "langscape-recipe-hint", text: "No named rules found in this file." });
        }
        const unmatched = current.disabledRules.filter((name) => !rules.includes(name));
        if (unmatched.length) {
          body.createDiv({ cls: "langscape-recipe-hint", text: `Saved rules no longer found: ${unmatched.join(", ")}.` });
          const clear = button(body, "Clear missing rules", "clear-missing-rules");
          clear.addEventListener("click", () => {
            const entry = currentChange();
            if (!entry) return;
            setDisabledRules(entry.disabledRules.filter((name) => rules.includes(name)));
            void showRules();
            summary.focus();
          });
        }
      } catch (error) {
        if (currentChange()) body.textContent = describeError(error);
      } finally {
        loading = false;
      }
    };
    details.addEventListener("toggle", () => {
      if (details.open) void showRules();
    });
    details.open = open;
    return { details, up, down, remove };
  }

  private moveChange(index: number, direction: -1 | 1): void {
    if (!this.recipe || this.runningFor === this.revision) return;
    const changes = [...this.recipe.changes];
    const next = index + direction;
    if (next < 0 || next >= changes.length) return;
    const opened = this.rows.map((row) => row.details.open);
    [changes[index], changes[next]] = [changes[next], changes[index]];
    [opened[index], opened[next]] = [opened[next], opened[index]];
    this.commit({ ...this.recipe, changes });
    this.renderChanges(opened);
    const row = this.rows[next];
    const preferred = direction < 0 ? row.up : row.down;
    (preferred.disabled ? (direction < 0 ? row.down : row.up) : preferred).focus();
  }

  private commit(recipe: Recipe): void {
    this.source = serializeRecipe(recipe);
    this.recipe = recipe;
    this.result = null;
    this.requestSave();
    this.renderResult();
  }

  private runBlocker(): string {
    const recipe = this.recipe;
    if (!recipe || recipe.inputFolder === null) return "Choose an input folder.";
    if (this.propertyQuery?.state === "loading") return "Finding properties…";
    if (this.propertyQuery?.state === "error") return "Couldn’t read properties from the input folder.";
    if (this.propertyQuery?.state !== "ready" || !this.propertyQuery.names.includes(recipe.property)) return "Choose a text property.";
    if (recipe.changes.length === 0) return "Add a sound-change file.";
    if (recipe.outputFolder === null) return "Choose an output folder.";
    if (recipe.inputFolder === recipe.outputFolder) return "Choose an output folder different from the input folder.";
    return "";
  }

  private renderResult(): void {
    if (!this.card) return;
    const { fields, run, result } = this.card;
    const blocker = this.runBlocker();
    const running = this.runningFor !== null;
    fields.disabled = this.runningFor === this.revision;
    run.disabled = running || !!blocker;
    const status = running ? { state: "running", message: fields.disabled ? "Running recipe…" : "Waiting for the previous run…" }
      : this.result ?? { state: "idle", message: blocker || "Ready to run." };
    result.dataset.state = status.state;
    result.textContent = status.message;
  }

  private async run(): Promise<void> {
    const recipe = this.recipe;
    if (!recipe || this.runningFor !== null || this.runBlocker()) return;
    const revision = this.revision;
    this.runningFor = revision;
    this.result = null;
    this.renderResult();
    let result: Result;
    try {
      await this.save();
      const { written, skipped } = await runRecipe({
        app: this.app,
        recipe,
        apply: (changes, words) => this.plugin.lexurgy.apply(changes, words),
      });
      result = {
        state: "success",
        message: `Wrote ${written} ${written === 1 ? "note" : "notes"}${skipped ? ` · ${skipped} skipped` : ""}.`,
      };
    } catch (error) {
      result = { state: "error", message: describeError(error) };
    } finally {
      this.runningFor = null;
    }
    if (this.revision === revision) this.result = result;
    this.renderResult();
  }
}

function folderOptions(files: ReturnType<LangscapePlugin["app"]["vault"]["getAllLoadedFiles"]>): PathOption[] {
  return [
    { path: "/", kind: "folder" },
    ...files.filter((file): file is TFolder => file instanceof TFolder && file.path !== "/")
      .map((folder) => ({ path: folder.path, kind: "folder" as const }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  ];
}

function section(parent: HTMLElement, number: string, title: string, hint: string): HTMLElement {
  const region = parent.createEl("section", { cls: "langscape-recipe-section" });
  const header = region.createDiv({ cls: "langscape-recipe-section-heading" });
  header.createSpan({ cls: "langscape-recipe-section-number", text: number, attr: { "aria-hidden": "true" } });
  header.createEl("h3", { text: title });
  region.createEl("p", { cls: "langscape-recipe-hint", text: hint });
  return region;
}

function button(parent: HTMLElement, text: string, part: string, icon?: string): HTMLButtonElement {
  const el = parent.createEl("button", {
    cls: `langscape-recipe-button langscape-recipe-${part}`,
    attr: { type: "button" },
  });
  if (icon) setIcon(el.createSpan({ attr: { "aria-hidden": "true" } }), icon);
  if (text) el.createSpan({ text });
  return el;
}

function iconButton(parent: HTMLElement, label: string, part: string, icon: string): HTMLButtonElement {
  const el = button(parent, "", part, icon);
  el.addClass("langscape-recipe-icon-button");
  el.setAttribute("aria-label", label);
  el.title = label;
  return el;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
