/* Add the small DOM helpers Obsidian injects at runtime to jsdom tests. */
if (typeof Element !== "undefined") {
  const proto = Element.prototype as any;
  proto.createEl = function (tag: string, options?: any, callback?: (el: any) => void) {
    const el = document.createElement(tag);
    applyOptions(el, options);
    this.appendChild(el);
    callback?.(el);
    return el;
  };
  proto.createDiv = function (options?: any, callback?: (el: any) => void) {
    return this.createEl("div", options, callback);
  };
  proto.createSpan = function (options?: any, callback?: (el: any) => void) {
    return this.createEl("span", options, callback);
  };
  proto.empty = function () {
    while (this.firstChild) this.removeChild(this.firstChild);
    return this;
  };
  proto.addClass = function (...classes: string[]) {
    for (const value of classes.flatMap((entry) => entry.split(/\s+/))) {
      if (value) this.classList.add(value);
    }
    return this;
  };
  proto.removeClass = function (...classes: string[]) {
    for (const value of classes.flatMap((entry) => entry.split(/\s+/))) {
      if (value) this.classList.remove(value);
    }
    return this;
  };
  proto.toggleClass = function (classes: string, value: boolean) {
    for (const entry of classes.split(/\s+/)) {
      if (entry) this.classList.toggle(entry, value);
    }
    return this;
  };
  proto.setText = function (text: string) {
    this.textContent = text;
    return this;
  };
  proto.setAttr = function (name: string, value: string) {
    this.setAttribute(name, value);
    return this;
  };
  proto.detach = function () {
    this.remove();
  };
  proto.hasClass = function (name: string) {
    return this.classList.contains(name);
  };
}

function applyOptions(el: HTMLElement, options?: any): void {
  if (!options) return;
  if (typeof options === "string") {
    el.className = options;
    return;
  }
  if (options.cls) {
    el.className = Array.isArray(options.cls) ? options.cls.join(" ") : options.cls;
  }
  if (options.text !== undefined) el.textContent = String(options.text);
  if (options.title) el.title = options.title;
  if (options.attr) {
    for (const [key, value] of Object.entries(options.attr)) {
      if (value !== null && value !== undefined) el.setAttribute(key, String(value));
    }
  }
}
