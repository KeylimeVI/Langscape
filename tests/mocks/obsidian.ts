/* Minimal Obsidian API stand-in for unit tests. */
import { vi } from "vitest";

export class Component {
  load(): void {}
  onload(): void {}
  unload(): void {}
  onunload(): void {}
  addChild<T>(child: T): T {
    return child;
  }
  register(): void {}
  registerEvent(): void {}
  registerDomEvent(): void {}
  registerInterval(): number {
    return 0;
  }
}

export class Notice {
  constructor(public message: string, public timeout?: number) {}
}

export class TFile {
  path: string;
  extension: string;
  basename: string;
  stat = { mtime: 0, ctime: 0, size: 0 };
  constructor(path: string) {
    this.path = path;
    const name = path.split("/").pop() ?? path;
    this.extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
    this.basename = name.replace(/\.[^.]+$/, "");
  }
}

export class TFolder {
  children: Array<TFile | TFolder> = [];
  constructor(public path: string) {}
  isRoot(): boolean {
    return this.path === "/";
  }
}

export class FileSystemAdapter {
  constructor(private readonly base = "/vault") {}
  getBasePath(): string {
    return this.base;
  }
  getResourcePath(path: string): string {
    return `app://local/${path}`;
  }
  async exists(): Promise<boolean> {
    return false;
  }
  async read(): Promise<string> {
    throw new Error("not implemented");
  }
  async write(): Promise<void> {
    throw new Error("not implemented");
  }
}

export class Plugin extends Component {
  app: any;
  manifest: any;
  constructor(app: any, manifest: any) {
    super();
    this.app = app;
    this.manifest = manifest;
  }
  async loadData(): Promise<any> {
    return {};
  }
  async saveData(): Promise<void> {}
  addRibbonIcon(): HTMLElement {
    return document.createElement("div");
  }
  addCommand(): void {}
  addSettingTab(): void {}
  registerView(): void {}
  registerExtensions(): void {}
  registerMarkdownPostProcessor(): void {}
  registerMarkdownCodeBlockProcessor(): void {}
  registerEditorExtension(): void {}
  registerEvent(): void {}
  registerDomEvent(): void {}
  registerInterval(): number {
    return 0;
  }
}

export class PluginSettingTab {
  containerEl: HTMLElement;
  constructor(public app: any, public plugin: any) {
    this.containerEl = document.createElement("div");
  }
  display(): void {}
  hide(): void {}
}

export class Modal {
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  constructor(public app: any) {
    this.containerEl = document.createElement("div");
    this.contentEl = document.createElement("div");
  }
  open(): void {
    this.onOpen();
  }
  close(): void {
    this.onClose();
  }
  onOpen(): void {}
  onClose(): void {}
}

export class ItemView extends Component {
  contentEl: HTMLElement;
  containerEl: HTMLElement;
  constructor(public leaf: any) {
    super();
    this.containerEl = document.createElement("div");
    this.contentEl = document.createElement("div");
  }
  getViewType(): string {
    return "test";
  }
  getDisplayText(): string {
    return "Test";
  }
  getIcon(): string {
    return "file";
  }
  addAction(): HTMLElement {
    return document.createElement("div");
  }
  onOpen(): void {}
  onClose(): void {}
}

export class TextFileView extends ItemView {
  data = "";
  file: TFile | null = null;
  requestSave = vi.fn();
  getViewData(): string {
    return this.data;
  }
  setViewData(data: string): void {
    this.data = data;
  }
  clear(): void {
    this.data = "";
  }
  async save(): Promise<void> {}
}

export class Setting {
  constructor(public containerEl: HTMLElement) {}
  setName(): this {
    return this;
  }
  setDesc(): this {
    return this;
  }
  setHeading(): this {
    return this;
  }
  setClass(): this {
    return this;
  }
  setDisabled(): this {
    return this;
  }
  addText(cb: (text: any) => any): this {
    cb(chainableText());
    return this;
  }
  addTextArea(cb: (text: any) => any): this {
    cb(chainableText());
    return this;
  }
  addToggle(cb: (toggle: any) => any): this {
    cb(chainable());
    return this;
  }
  addButton(cb: (button: any) => any): this {
    cb(chainable());
    return this;
  }
  addDropdown(cb: (dropdown: any) => any): this {
    cb(chainable());
    return this;
  }
  addExtraButton(cb: (button: any) => any): this {
    cb(chainable());
    return this;
  }
}

function chainable(): any {
  const value: any = {
    setValue: () => value,
    getValue: () => "",
    onChange: () => value,
    setButtonText: () => value,
    setCta: () => value,
    removeCta: () => value,
    setWarning: () => value,
    setDestructive: () => value,
    setIcon: () => value,
    setTooltip: () => value,
    setPlaceholder: () => value,
    setDisabled: () => value,
    setLimits: () => value,
    setDynamicTooltip: () => value,
    setInstant: () => value,
    onClick: () => value,
    addOption: () => value,
    addOptions: () => value,
  };
  return value;
}

function chainableText(): any {
  const value = chainable();
  value.inputEl = document.createElement("input");
  value.setPlaceholder = () => value;
  value.setValue = () => value;
  value.onChange = () => value;
  return value;
}

export class MarkdownView {
  editor: any;
  file: TFile | null = null;
}

export async function requestUrl(): Promise<any> {
  throw new Error("requestUrl is not available in unit tests");
}

export function setIcon(): void {}

export const MarkdownRenderer = {
  async render(): Promise<void> {},
};

export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
}

/**
 * Tiny YAML subset parser used by tests: nested maps, lists of scalars,
 * quoted strings, booleans, numbers and inline arrays.
 */
export function parseYaml(source: string): unknown {
  const lines = source.replace(/\r/g, "").split("\n");
  const meaningful = lines.filter((line) => line.trim() && !line.trim().startsWith("#"));
  if (meaningful.length === 0) return null;

  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; value: any }> = [{ indent: -1, value: root }];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;

    if (trimmed.startsWith("- ")) {
      if (!Array.isArray(parent)) continue;
      parent.push(parseScalar(trimmed.slice(2)));
      continue;
    }

    const colon = trimmed.indexOf(":");
    if (colon < 0) continue;
    const key = trimmed.slice(0, colon).trim();
    const rest = trimmed.slice(colon + 1).trim();
    if (!rest) {
      const nextLine = lines.slice(i + 1).find((candidate) => candidate.trim());
      const isList = nextLine?.trim().startsWith("- ");
      const value: any = isList ? [] : {};
      parent[key] = value;
      stack.push({ indent, value });
    } else {
      parent[key] = parseScalar(rest);
    }
  }

  return root;
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => parseScalar(item))
      .filter((item) => item !== "");
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    if (trimmed.startsWith('"')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed.slice(1, -1);
      }
    }
    return trimmed.slice(1, -1);
  }
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === "null" || trimmed === "~") return null;
  return trimmed;
}

export function stringifyYaml(value: unknown): string {
  return Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => `${key}: ${JSON.stringify(entry)}`)
    .join("\n");
}
