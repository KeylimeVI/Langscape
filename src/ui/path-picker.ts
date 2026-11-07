import { App, setIcon } from "obsidian";

export interface PathOption {
  path: string;
  kind: "folder" | "file";
}

interface CreateOption {
  path: string;
  kind: "create";
}

type PickerItem = PathOption | CreateOption;

export interface PathPickerOptions {
  title: string;
  placeholder: string;
  options: PathOption[];
  /** Allow a path that is not in the list (for a new output folder). */
  allowCustom?: boolean;
  initialValue?: string;
}

export function pickPath(
  app: App,
  options: PathPickerOptions,
  anchor?: HTMLElement
): Promise<string | null> {
  return new Promise((resolve) => {
    new PathPickerPopover(app, options, anchor, resolve).open();
  });
}

/**
 * A compact, anchored picker modelled on Obsidian's Bases "in folder" value
 * menu: a search field above a scrollable list, rather than an OS dialog or a
 * large centre-screen modal.
 */
export class PathPickerPopover {
  private el!: HTMLElement;
  private input!: HTMLInputElement;
  private listEl!: HTMLElement;
  private readonly doc: Document;
  private readonly win: Window & typeof globalThis;
  private items: PickerItem[] = [];
  private active = 0;
  private settled = false;
  private closed = false;
  private readonly onOutside = (event: MouseEvent) => {
    if (!this.el?.contains(event.target as Node)) this.close();
  };
  private readonly onResize = () => this.position();

  constructor(
    private readonly app: App,
    private readonly settings: PathPickerOptions,
    private readonly anchor: HTMLElement | undefined,
    private readonly resolve: (value: string | null) => void
  ) {
    this.doc = anchor?.ownerDocument ?? document;
    this.win = (this.doc.defaultView ?? window) as Window & typeof globalThis;
  }

  open(): void {
    this.el = this.doc.body.createDiv({ cls: "langscape-path-popover" });
    const searchRow = this.el.createDiv({ cls: "langscape-path-search-row" });
    this.input = searchRow.createEl("input", {
      cls: "langscape-path-search",
      attr: {
        type: "text",
        placeholder: this.settings.placeholder,
        "aria-label": this.settings.title,
      },
    });
    this.input.value = this.settings.initialValue ?? "";
    this.listEl = this.el.createDiv({ cls: "langscape-path-results" });

    this.input.addEventListener("input", () => {
      this.active = 0;
      this.render();
      this.position();
    });
    this.input.addEventListener("keydown", (event) => this.onKeyDown(event));

    this.render();
    this.position();
    setTimeout(() => {
      if (this.closed) return;
      this.input.focus();
      this.input.select();
      this.doc.addEventListener("mousedown", this.onOutside, true);
      this.win.addEventListener("resize", this.onResize);
    }, 0);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (this.items.length === 0) return;
      this.active =
        (this.active + (event.key === "ArrowDown" ? 1 : -1) + this.items.length) %
        this.items.length;
      this.render();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = this.items[this.active];
      if (item) this.choose(item.path);
      else if (this.settings.allowCustom) this.choose(this.input.value.trim());
    }
  }

  private filtered(): PathOption[] {
    const query = this.input.value.trim().toLowerCase();
    if (!query) return this.settings.options;
    return this.settings.options.filter((option) =>
      option.path.toLowerCase().includes(query)
    );
  }

  private render(): void {
    const options = this.filtered();
    const query = this.input.value.trim();
    this.items = [...options];
    if (
      this.settings.allowCustom &&
      query &&
      !this.settings.options.some((option) => option.path === query)
    ) {
      this.items.push({ path: query, kind: "create" });
    }
    if (this.active >= this.items.length) this.active = Math.max(0, this.items.length - 1);

    this.listEl.empty();
    if (this.items.length === 0) {
      this.listEl.createDiv({
        cls: "langscape-path-empty",
        text: "No matches",
      });
      return;
    }
    this.items.forEach((item, index) => {
      const classes = ["langscape-path-item"];
      if (index === this.active) classes.push("is-active");
      if (item.kind === "create") classes.push("is-create");
      const row = this.listEl.createEl("button", { cls: classes.join(" ") });
      const icon = row.createSpan({ cls: "langscape-path-icon" });
      setIcon(
        icon,
        item.kind === "folder" ? "folder" : item.kind === "file" ? "file-code" : "plus"
      );
      row.createSpan({
        cls: "langscape-path-label",
        text: item.kind === "create" ? `Create “${item.path}”` : item.path,
      });
      row.addEventListener("click", () => this.choose(item.path));
    });
  }

  private position(): void {
    if (!this.el) return;
    const width = 340;
    const margin = 10;
    const rawRect = this.anchor?.getBoundingClientRect();
    const rect = rawRect && rawRect.width > 0 && rawRect.height > 0 ? rawRect : undefined;
    const viewportWidth = this.win.innerWidth;
    const viewportHeight = this.win.innerHeight;
    let left = rect ? rect.left : (viewportWidth - width) / 2;
    left = Math.max(margin, Math.min(left, viewportWidth - width - margin));
    const height = Math.min(this.el.offsetHeight || 320, 380);
    let top = rect ? rect.bottom + 6 : (viewportHeight - height) / 2;
    if (rect && top + height > viewportHeight - margin) {
      top = Math.max(margin, rect.top - height - 6);
    }
    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
  }

  private choose(path: string): void {
    if (!path) return;
    this.settled = true;
    this.resolve(path);
    this.close();
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.doc.removeEventListener("mousedown", this.onOutside, true);
    this.win.removeEventListener("resize", this.onResize);
    this.el?.remove();
    if (!this.settled) {
      this.settled = true;
      this.resolve(null);
    }
  }
}
