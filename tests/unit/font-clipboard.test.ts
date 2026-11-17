// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FontRecord } from "../../src/fonts/css";
import {
  fontMarkupForSelection,
  fontRecordForElement,
  installFontClipboard,
} from "../../src/fonts/clipboard";

const gothic: FontRecord = {
  id: "gothic",
  family: "Noto Sans Gothic",
  displayName: "Noto Sans Gothic",
  nickname: "gothic",
  className: "langscape-font-gothic",
  source: "vault",
};

const palatal: FontRecord = {
  id: "palatal",
  family: "Palatal Test",
  displayName: "Palatal Test",
  nickname: "palatal",
  className: "langscape-font-palatal",
  source: "vault",
};

const manager = {
  get(id: string): FontRecord | undefined {
    return [gothic, palatal].find((record) => record.id === id);
  },
  find(name: string): FontRecord | undefined {
    const needle = name.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
    return [gothic, palatal].find(
      (record) =>
        record.displayName.toLowerCase() === needle ||
        (record.nickname ?? "").toLowerCase() === needle
    );
  },
};

function selectRange(range: Range): void {
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectContents(node: Node): void {
  const range = document.createRange();
  range.selectNodeContents(node);
  selectRange(range);
}

function rootHtml(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("font-aware clipboard text", () => {
  it("wraps a fully selected inline font span", () => {
    const root = rootHtml(
      '<p>Say <span class="langscape-font langscape-font-gothic" data-langscape-font="Noto Sans Gothic">𐌰𐍆𐌰</span> now.</p>'
    );
    selectContents(root.querySelector("span.langscape-font")!);
    expect(fontMarkupForSelection(window.getSelection(), manager)).toBe(
      "{gothic: 𐌰𐍆𐌰}"
    );
  });

  it("wraps only the selected part of a font span", () => {
    const root = rootHtml(
      '<p><span class="langscape-font langscape-font-gothic" data-langscape-font="Noto Sans Gothic">𐌰𐍆𐌰</span></p>'
    );
    const textNode = root.querySelector("span.langscape-font")!.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 2);
    selectRange(range);
    expect(fontMarkupForSelection(window.getSelection(), manager)).toBe("{gothic: 𐌰}");
  });

  it("keeps surrounding plain text and wraps multiple fonts", () => {
    const root = rootHtml(
      '<p>Say <span class="langscape-font langscape-font-gothic" data-langscape-font="Noto Sans Gothic">𐌰</span> and <span class="langscape-font langscape-font-palatal" data-langscape-font="Palatal Test">𐌱</span>.</p>'
    );
    selectContents(root.querySelector("p")!);
    expect(fontMarkupForSelection(window.getSelection(), manager)).toBe(
      "Say {gothic: 𐌰} and {palatal: 𐌱}."
    );
  });

  it("wraps text under a note-level font", () => {
    const root = rootHtml(
      '<div class="langscape-note-font langscape-font-gothic" data-langscape-font="Noto Sans Gothic"><p>𐌰𐍆𐌰</p></div>'
    );
    selectContents(root.querySelector("p")!);
    expect(fontMarkupForSelection(window.getSelection(), manager)).toBe(
      "{gothic: 𐌰𐍆𐌰}"
    );
  });

  it("returns null when the selection has no font", () => {
    const root = rootHtml("<p>plain text</p>");
    selectContents(root.querySelector("p")!);
    expect(fontMarkupForSelection(window.getSelection(), manager)).toBeNull();
  });

  it("does not wrap code inside a note-level font", () => {
    const root = rootHtml(
      '<div class="langscape-note-font langscape-font-gothic" data-langscape-font="Noto Sans Gothic"><pre><code>x</code></pre></div>'
    );
    selectContents(root.querySelector("code")!);
    expect(fontMarkupForSelection(window.getSelection(), manager)).toBeNull();
  });

  it("resolves the font from an element", () => {
    const root = rootHtml(
      '<span class="langscape-font langscape-font-gothic" data-langscape-font="Noto Sans Gothic">x</span>'
    );
    expect(fontRecordForElement(root.querySelector("span"), manager)).toBe(gothic);
  });

  it("does not wrap a selection that already contains markup", () => {
    const root = rootHtml(
      '<p><span class="langscape-font langscape-font-gothic" data-langscape-font="Noto Sans Gothic">x</span> {gothic: y}</p>'
    );
    selectContents(root.querySelector("p")!);
    expect(fontMarkupForSelection(window.getSelection(), manager)).toBeNull();
  });

  it("writes the markup to the clipboard on copy", () => {
    const root = rootHtml(
      '<p><span class="langscape-font langscape-font-gothic" data-langscape-font="Noto Sans Gothic">𐌰</span></p>'
    );
    selectContents(root.querySelector("span.langscape-font")!);
    const remove = installFontClipboard(manager, document);
    const setData = vi.fn();
    const event = new Event("copy", { bubbles: true, cancelable: true }) as any;
    event.clipboardData = { clearData: vi.fn(), setData };
    document.dispatchEvent(event);
    remove();
    expect(setData).toHaveBeenCalledWith("text/plain", "{gothic: 𐌰}");
    expect(event.defaultPrevented).toBe(true);
  });
});
