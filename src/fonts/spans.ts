/**
 * Inline custom-font syntax:
 *
 *   {tengwar: elen síla}
 *
 * The nickname is the token before the colon. The legacy `{font:Name|text}`
 * syntax and the earlier `'''nickname text'''` form are still accepted so
 * existing notes keep working.
 *
 * All forms stay inline and cannot span a line break.
 */

export interface FontSpan {
  /** Index of the opening delimiter. */
  start: number;
  /** Index just past the closing delimiter. */
  end: number;
  /** Index of the first content character. */
  contentStart: number;
  /** Index just past the content. */
  contentEnd: number;
  name: string;
  content: string;
}

export interface FontSpanSegment {
  type: "text" | "span";
  text: string;
  name?: string;
}

const BRACE_OPEN = "{font:";
const TRIPLE_OPEN = "'''";

/** Find all well-formed font spans in a single line / text node. */
export function findFontSpans(text: string): FontSpan[] {
  const spans: FontSpan[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const brace = text.indexOf("{", cursor);
    const triple = text.indexOf(TRIPLE_OPEN, cursor);
    if (brace < 0 && triple < 0) break;

    let parsed: FontSpan | undefined;
    let next: number;
    if (brace >= 0 && (triple < 0 || brace < triple)) {
      next = brace + 1;
      if (!isEscaped(text, brace)) {
        parsed = text.startsWith(BRACE_OPEN, brace)
          ? parseBraceSpan(text, brace)
          : parseNamedBraceSpan(text, brace);
      }
    } else {
      next = triple + TRIPLE_OPEN.length;
      if (!isEscaped(text, triple)) parsed = parseTripleSpan(text, triple);
    }

    if (parsed) {
      spans.push(parsed);
      cursor = parsed.end;
    } else {
      cursor = next;
    }
  }
  return spans;
}

function parseNamedBraceSpan(text: string, open: number): FontSpan | undefined {
  const colon = text.indexOf(":", open + 1);
  if (colon < 0) return undefined;
  const close = text.indexOf("}", colon + 1);
  if (close < 0) return undefined;
  const name = text.slice(open + 1, colon).trim();
  if (!name || /[{}|\r\n"']/.test(name)) return undefined;
  let contentStart = colon + 1;
  while (contentStart < close && /\s/.test(text[contentStart])) contentStart++;
  const content = text.slice(contentStart, close);
  if (!content || /[\r\n]/.test(content)) return undefined;
  return {
    start: open,
    end: close + 1,
    contentStart,
    contentEnd: close,
    name,
    content,
  };
}

/** Legacy `{font:Name|text}` span. */
function parseBraceSpan(text: string, open: number): FontSpan | undefined {
  const pipe = text.indexOf("|", open + BRACE_OPEN.length);
  if (pipe < 0) return undefined;
  const close = text.indexOf("}", pipe + 1);
  if (close < 0) return undefined;
  const name = text.slice(open + BRACE_OPEN.length, pipe).trim();
  if (!name || /[{}|\r\n]/.test(name)) return undefined;
  const content = text.slice(pipe + 1, close);
  if (/[\r\n]/.test(content)) return undefined;
  return {
    start: open,
    end: close + 1,
    contentStart: pipe + 1,
    contentEnd: close,
    name,
    content,
  };
}

/** Earlier `'''nickname text'''` span. */
function parseTripleSpan(text: string, open: number): FontSpan | undefined {
  const close = text.indexOf(TRIPLE_OPEN, open + TRIPLE_OPEN.length);
  if (close < 0) return undefined;
  const inner = text.slice(open + TRIPLE_OPEN.length, close);
  if (!inner || /[\r\n]/.test(inner)) return undefined;

  const separator = inner.search(/\s/);
  if (separator <= 0) return undefined;
  const name = inner.slice(0, separator).trim();
  if (!name || /[{}|\r\n']/.test(name)) return undefined;

  let contentOffset = separator;
  while (contentOffset < inner.length && /\s/.test(inner[contentOffset])) contentOffset++;
  const content = inner.slice(contentOffset);
  if (!content) return undefined;

  return {
    start: open,
    end: close + TRIPLE_OPEN.length,
    contentStart: open + TRIPLE_OPEN.length + contentOffset,
    contentEnd: close,
    name,
    content,
  };
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

/** Build the inline markup inserted by the font picker. */
export function formatFontSpan(name: string, content: string): string {
  const safeName =
    name
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[{}|'":\r\n]/g, "") || "font";
  const safeContent =
    content.replace(/[}\r\n]/g, " ").replace(/\s+/g, " ").trim() || "text";
  return `{${safeName}: ${safeContent}}`;
}

export function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) backslashes++;
  return backslashes % 2 === 1;
}

function unescapeOpeners(text: string): string {
  return text
    .replace(/\\(\{font:)/g, "$1")
    .replace(/\\(\{[^{}\n]+:)/g, "$1")
    .replace(/\\'''/g, "'''");
}
