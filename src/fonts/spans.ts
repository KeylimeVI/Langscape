/**
 * The inline custom-font syntax:
 *
 *   {font:Tengwar|hello}
 *
 * The syntax deliberately avoids characters Obsidian already gives meaning to
 * ([[wikilinks]], %%comments%%, $math$, ==highlight==) so it survives both the
 * Markdown parser and Live Preview. A backslash escapes the opening brace.
 */

export interface FontSpan {
  /** Index of the opening `{`. */
  start: number;
  /** Index just past the closing `}`. */
  end: number;
  /** Index of the first content character. */
  contentStart: number;
  /** Index just past the content (index of `}`). */
  contentEnd: number;
  name: string;
  content: string;
}

export interface FontSpanSegment {
  type: "text" | "span";
  text: string;
  name?: string;
}

const OPEN = "{font:";

/** Find all well-formed font spans in a single line / text node. */
export function findFontSpans(text: string): FontSpan[] {
  const spans: FontSpan[] = [];
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const open = text.indexOf(OPEN, searchFrom);
    if (open < 0) break;
    if (isEscaped(text, open)) {
      searchFrom = open + OPEN.length;
      continue;
    }
    const pipe = text.indexOf("|", open + OPEN.length);
    if (pipe < 0) break;
    const close = text.indexOf("}", pipe + 1);
    if (close < 0) break;
    const name = text.slice(open + OPEN.length, pipe).trim();
    if (!name || /[{}|\r\n]/.test(name)) {
      searchFrom = open + OPEN.length;
      continue;
    }
    const content = text.slice(pipe + 1, close);
    if (/[\r\n]/.test(content)) {
      searchFrom = close + 1;
      continue;
    }
    spans.push({
      start: open,
      end: close + 1,
      contentStart: pipe + 1,
      contentEnd: close,
      name,
      content,
    });
    searchFrom = close + 1;
  }
  return spans;
}

export function parseFontSpanSegments(
  text: string,
  resolve: (name: string) => boolean
): FontSpanSegment[] {
  const spans = findFontSpans(text);
  if (spans.length === 0) return [{ type: "text", text: unescapeOpeners(text) }];
  const segments: FontSpanSegment[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (!resolve(span.name)) {
      // Unknown font: leave the markup visible so the typo is obvious.
      continue;
    }
    if (span.start > cursor) {
      segments.push({ type: "text", text: unescapeOpeners(text.slice(cursor, span.start)) });
    }
    segments.push({ type: "span", text: span.content, name: span.name });
    cursor = span.end;
  }
  if (cursor < text.length) {
    segments.push({ type: "text", text: unescapeOpeners(text.slice(cursor)) });
  }
  return segments;
}

/** Used when inserting a span; braces in content are not supported by the parser. */
export function formatFontSpan(name: string, content: string): string {
  const safeName = name.replace(/[{}|\r\n]/g, "").trim();
  const safeContent = content.replace(/[}\r\n]/g, " ");
  return `{font:${safeName}|${safeContent}}`;
}

export function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) backslashes++;
  return backslashes % 2 === 1;
}

function unescapeOpeners(text: string): string {
  return text.replace(/\\(\{font:)/g, "$1");
}
