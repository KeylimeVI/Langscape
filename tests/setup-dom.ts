/* Add the small DOM helpers Obsidian injects at runtime to jsdom tests. */
if (typeof window === "undefined") {
  (globalThis as any).window = globalThis;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function createElementWithOptions(
  doc: Document,
  tag: string,
  options?: any,
  callback?: (el: any) => void
): HTMLElement {
  const el = doc.createElement(tag);
  applyOptions(el, options);
  callback?.(el);
  return el;
}

function createSvgWithOptions(
  doc: Document,
  tag: string,
  options?: any,
  callback?: (el: any) => void
): SVGElement {
  const el = doc.createElementNS(SVG_NS, tag);
  applySvgOptions(el, options);
  callback?.(el);
  return el;
}

if (typeof Node !== "undefined") {
  const nodeProto = Node.prototype as any;
  nodeProto.appendText = function (text: string) {
    const doc = this.ownerDocument ?? document;
    this.appendChild(doc.createTextNode(text));
  };
  nodeProto.instanceOf = function (type: { new (...args: any[]): any; name?: string }) {
    if (typeof type !== "function") return false;
    if (this instanceof type) return true;
    const win = (this.ownerDocument ?? document)?.defaultView as Record<string, any> | null;
    const winCtor = type.name ? win?.[type.name] : undefined;
    return typeof winCtor === "function" && this instanceof winCtor;
  };
}

if (typeof Element !== "undefined") {
  const proto = Element.prototype as any;
  proto.createEl = function (tag: string, options?: any, callback?: (el: any) => void) {
    const doc = this.ownerDocument ?? document;
    const el = createElementWithOptions(doc, tag, options);
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
  proto.createSvg = function (tag: string, options?: any, callback?: (el: any) => void) {
    const doc = this.ownerDocument ?? document;
    const el = createSvgWithOptions(doc, tag, options);
    this.appendChild(el);
    callback?.(el);
    return el;
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
  proto.setCssProps = function (props: Record<string, string>) {
    for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value);
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

if (typeof DocumentFragment !== "undefined") {
  const fragProto = DocumentFragment.prototype as any;
  fragProto.createEl = function (tag: string, options?: any, callback?: (el: any) => void) {
    const doc = this.ownerDocument ?? document;
    const el = createElementWithOptions(doc, tag, options);
    this.appendChild(el);
    callback?.(el);
    return el;
  };
  fragProto.createDiv = function (options?: any, callback?: (el: any) => void) {
    return this.createEl("div", options, callback);
  };
  fragProto.createSpan = function (options?: any, callback?: (el: any) => void) {
    return this.createEl("span", options, callback);
  };
  fragProto.createSvg = function (tag: string, options?: any, callback?: (el: any) => void) {
    const doc = this.ownerDocument ?? document;
    const el = createSvgWithOptions(doc, tag, options);
    this.appendChild(el);
    callback?.(el);
    return el;
  };
}

if (typeof document !== "undefined") {
  const g = globalThis as any;
  g.createEl = (tag: string, options?: any, callback?: (el: any) => void) =>
    createElementWithOptions(document, tag, options, callback);
  g.createDiv = (options?: any, callback?: (el: any) => void) =>
    createElementWithOptions(document, "div", options, callback);
  g.createSpan = (options?: any, callback?: (el: any) => void) =>
    createElementWithOptions(document, "span", options, callback);
  g.createSvg = (tag: string, options?: any, callback?: (el: any) => void) =>
    createSvgWithOptions(document, tag, options, callback);
  g.createFragment = (callback?: (el: DocumentFragment) => void) => {
    const fragment = document.createDocumentFragment();
    callback?.(fragment);
    return fragment;
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
  if (options.text !== undefined) {
    if (typeof DocumentFragment !== "undefined" && options.text instanceof DocumentFragment) {
      el.replaceChildren(options.text);
    } else {
      el.textContent = String(options.text);
    }
  }
  if (options.title) el.title = options.title;
  if (options.type !== undefined) (el as HTMLInputElement | HTMLButtonElement).type = String(options.type);
  if (options.value !== undefined) (el as HTMLInputElement | HTMLOptionElement).value = String(options.value);
  if (options.href !== undefined) (el as HTMLAnchorElement).href = String(options.href);
  if (options.placeholder !== undefined) (el as HTMLInputElement).placeholder = String(options.placeholder);
  if (options.attr) {
    for (const [key, value] of Object.entries(options.attr)) {
      if (value !== null && value !== undefined) el.setAttribute(key, String(value));
    }
  }
}

function applySvgOptions(el: SVGElement, options?: any): void {
  if (!options) return;
  if (typeof options === "string") {
    el.setAttribute("class", options);
    return;
  }
  if (options.cls) {
    el.setAttribute("class", Array.isArray(options.cls) ? options.cls.join(" ") : options.cls);
  }
  if (options.attr) {
    for (const [key, value] of Object.entries(options.attr)) {
      if (value !== null && value !== undefined) el.setAttribute(key, String(value));
    }
  }
}
