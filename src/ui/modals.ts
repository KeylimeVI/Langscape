import { App, Modal } from "obsidian";

export interface PromptOptions {
  title: string;
  description?: string;
  value?: string;
  placeholder?: string;
  cta?: string;
}

export function promptText(app: App, options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = new PromptModal(app, options, resolve);
    modal.open();
  });
}

class PromptModal extends Modal {
  private settled = false;
  private value: string;

  constructor(
    app: App,
    private readonly options: PromptOptions,
    private readonly resolve: (value: string | null) => void
  ) {
    super(app);
    this.value = options.value ?? "";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: this.options.title });
    if (this.options.description) {
      contentEl.createEl("p", { text: this.options.description });
    }
    const input = contentEl.createEl("input", {
      attr: { type: "text", placeholder: this.options.placeholder ?? "" },
    });
    input.value = this.value;
    input.addClass("langscape-prompt-input");
    input.addEventListener("input", () => {
      this.value = input.value;
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.submit();
      }
    });
    const actions = contentEl.createDiv({ cls: "langscape-modal-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const submit = actions.createEl("button", { cls: "mod-cta", text: this.options.cta ?? "OK" });
    submit.addEventListener("click", () => this.submit());
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.resolve(null);
    }
  }

  private submit(): void {
    this.settled = true;
    this.resolve(this.value.trim());
    this.close();
  }
}

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmText?: string;
  cancelText?: string;
  warning?: boolean;
}

export function confirmAction(app: App, options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new ConfirmModal(app, options, resolve);
    modal.open();
  });
}

class ConfirmModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly options: ConfirmOptions,
    private readonly resolve: (value: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: this.options.title });
    for (const paragraph of this.options.body.split(/\n{2,}/)) {
      contentEl.createEl("p", { text: paragraph });
    }
    const actions = contentEl.createDiv({ cls: "langscape-modal-actions" });
    const cancel = actions.createEl("button", {
      text: this.options.cancelText ?? "Cancel",
    });
    cancel.addEventListener("click", () => this.close());
    const confirm = actions.createEl("button", {
      cls: this.options.warning ? "mod-warning" : "mod-cta",
      text: this.options.confirmText ?? "Continue",
    });
    confirm.addEventListener("click", () => {
      this.settled = true;
      this.resolve(true);
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.resolve(false);
    }
  }
}

/** A small modal with arbitrary content and a right-aligned close button. */
export class InfoModal extends Modal {
  constructor(
    app: App,
    private readonly title: string,
    private readonly build: (el: HTMLElement) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: this.title });
    this.build(this.contentEl);
    const actions = this.contentEl.createDiv({ cls: "langscape-modal-actions" });
    const close = actions.createEl("button", { cls: "mod-cta", text: "Close" });
    close.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
