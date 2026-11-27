import type { FontRecord } from "./css";

export interface FontLookup {
  find(name: string): FontRecord | undefined;
  get?(id: string): FontRecord | undefined;
}

interface Segment {
  text: string;
  font?: FontRecord;
}

const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

const SKIP_SELECTOR = [
  "script",
  "style",
  ".cm-widgetBuffer",
  ".cm-announced",
  ".table-row-drag-handle",
  ".table-col-drag-handle",
  ".langscape-table-covered",
  '.langscape-tree-label[data-editing="true"]',
].join(",");

/** Find the font record that applies to a DOM node. */
export function fontRecordForElement(
  element: Element | null,
  fonts: FontLookup
): FontRecord | undefined {
  for (let node = element; node; node = node.parentElement) {
    const win = node.ownerDocument.defaultView;
    if (win && node.instanceOf(win.HTMLElement)) {
      if (node.hidden || node.style.display === "none" || node.style.visibility === "hidden") {
        return undefined;
      }
    }
    const classes = [...node.classList];
    const fontClass = classes.find((value) => value.startsWith("langscape-font-"));
    if (fontClass) {
      const id = fontClass.slice("langscape-font-".length);
      const record =
        fonts.get?.(id) ?? fonts.find(node.getAttribute("data-langscape-font") ?? "");
      if (record) return record;
    }
    if (classes.includes("langscape-font") || classes.includes("langscape-note-font")) {
      const record = fonts.find(node.getAttribute("data-langscape-font") ?? "");
      if (record) return record;
    }
  }
  return undefined;
}

function endsWithNewline(segments: Segment[]): boolean {
  const last = segments[segments.length - 1];
  return Boolean(last && last.text.endsWith("\n"));
}

function formatWithFont(text: string, record: FontRecord): string {
  const rawName = record.nickname?.trim() || record.displayName.trim();
  const name = rawName
    .replace(/\s+/g, "-")
    .replace(/[{}|'":\r\n]/g, "");
  if (!name || !text) return text;

  // Font spans cannot cross a line break. Wrap each line independently and
  // preserve surrounding whitespace outside the markup.
  return text
    .split("\n")
    .map((line) => {
      if (!line) return "";
      const lead = /^\s*/.exec(line)?.[0] ?? "";
      const trail = /\s*$/.exec(line)?.[0] ?? "";
      const core = line.slice(lead.length, line.length - trail.length);
      if (!core) return line;
      const wrapped = core
        .split("}")
        .map((part) => (part ? `{${name}: ${part}}` : ""))
        .join("}");
      return `${lead}${wrapped}${trail}`;
    })
    .join("\n");
}

/**
 * Build the Markdown that should be copied for the current selection. Font
 * text is wrapped in its inline font syntax so pasting it restores the font;
 * non-font text is left alone. Returns null when the selection has no font.
 */
export function fontMarkupForSelection(
  selection: Selection | null,
  fonts: FontLookup
): string | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const selectedText = selection.toString();
  // Source mode already contains the font syntax (or the user deliberately
  // selected the markup). Do not wrap it a second time.
  if (/\{\s*[^{}:\n]+\s*:/.test(selectedText) || selectedText.includes("'''")) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const segments: Segment[] = [];
  let sawFont = false;

  const pushText = (text: string, font?: FontRecord): void => {
    if (!text) return;
    if (font) sawFont = true;
    segments.push({ text, font });
  };

  const walk = (node: Node, inherited?: FontRecord): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!range.intersectsNode(node)) return;
      const data = node.nodeValue ?? "";
      const start = node === range.startContainer ? Math.max(0, range.startOffset) : 0;
      const end =
        node === range.endContainer ? Math.min(data.length, range.endOffset) : data.length;
      if (end <= start) return;
      const parent = (node as Text).parentElement;
      // Note-level fonts apply to code too; copying code should stay code.
      if (parent?.closest("code, pre, textarea")) {
        pushText(data.slice(start, end));
        return;
      }
      const font = fontRecordForElement(parent, fonts) ?? inherited;
      pushText(data.slice(start, end), font);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (element.matches(SKIP_SELECTOR)) return;
    const win = element.ownerDocument.defaultView;
    if (
      win && element.instanceOf(win.HTMLElement) &&
      (element.hidden || element.style.display === "none" || element.style.visibility === "hidden")
    ) {
      return;
    }
    if (!range.intersectsNode(element)) return;
    const font = fontRecordForElement(element, fonts) ?? inherited;
    if (element.tagName === "BR") {
      segments.push({ text: "\n" });
      return;
    }
    const block = BLOCK_TAGS.has(element.tagName);
    if (block && !endsWithNewline(segments)) segments.push({ text: "\n" });
    for (const child of element.childNodes) walk(child, font);
    if (block && !endsWithNewline(segments)) segments.push({ text: "\n" });
  };

  walk(range.commonAncestorContainer);
  if (!sawFont) return null;

  const result = segments
    .map((segment) => (segment.font ? formatWithFont(segment.text, segment.font) : segment.text))
    .join("")
    .replace(/^\n+|\n+$/g, "");
  return result || null;
}

/** Copying font-rendered text puts the inline font markup on the clipboard. */
export function installFontClipboard(fonts: FontLookup, doc: Document = document): () => void {
  const onCopy = (event: ClipboardEvent): void => {
    const text = fontMarkupForSelection(doc.getSelection(), fonts);
    if (!text) return;
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    clipboard.clearData?.();
    clipboard.setData("text/plain", text);
    event.preventDefault();
  };
  doc.addEventListener("copy", onCopy, true);
  return () => doc.removeEventListener("copy", onCopy, true);
}
