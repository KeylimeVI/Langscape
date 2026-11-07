import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

export type LexurgyTokenTag =
  | "comment"
  | "keyword"
  | "ruleName"
  | "featureName"
  | "featureValue"
  | "elementName"
  | "elementRef"
  | "capture"
  | "operator"
  | "punctuation"
  | "symbol"
  | "number"
  | "text";

export interface LexurgyToken {
  from: number;
  to: number;
  tag: LexurgyTokenTag;
}

export interface LexurgyHighlightState {
  /** Declaration active on the current line. */
  decl?: string;
  /** Square-bracket matrix nesting. */
  matrixDepth: number;
  /** Parentheses in a `Feature name (a, b)` value list. */
  featureListDepth: number;
  /** Brace nesting for `Class name { ... }`. */
  braceDepth: number;
}

const DECLARATIONS =
  /^(Feature|Diacritic|Symbol|Class|Element|Syllables|Deromanizer|Romanizer)\b/i;
const RULE_HEADER = /^([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\s*:/;
const BLOCK_TYPE = /^(Then|Else)\b\s*:/i;
const NAME = /^[A-Za-z0-9_]+/;

/**
 * Independent Lexurgy tokenizer.
 *
 * The Lexurgy web editor's grammar is GPL-3.0, so this is not a copy of it;
 * it is a small tokenizer written against the documented SC syntax. It is
 * intentionally forgiving, because this editor accepts half-written files.
 */
export function tokenizeLexurgyLine(
  line: string,
  state: LexurgyHighlightState
): LexurgyToken[] {
  const tokens: LexurgyToken[] = [];
  const push = (from: number, to: number, tag: LexurgyTokenTag): void => {
    if (to > from) tokens.push({ from, to, tag });
  };
  const commentAt = findComment(line);
  const limit = commentAt >= 0 ? commentAt : line.length;
  let i = 0;
  while (i < limit && (line[i] === " " || line[i] === "\t")) i++;
  const statementStart = i;
  const rest = line.slice(i, limit);
  state.decl = undefined;

  const declaration = DECLARATIONS.exec(rest);
  if (declaration) {
    const keyword = declaration[1];
    push(statementStart, statementStart + keyword.length, "keyword");
    state.decl = keyword.toLowerCase();
    i = statementStart + keyword.length;
    i = tokenizeDeclarationPrefix(line, i, limit, state, push);
  } else if (BLOCK_TYPE.test(rest)) {
    const match = BLOCK_TYPE.exec(rest)!;
    const keyword = match[1];
    push(statementStart, statementStart + keyword.length, "keyword");
    i = statementStart + keyword.length;
    while (i < limit && (line[i] === " " || line[i] === "\t")) i++;
    if (line[i] === ":") {
      push(i, i + 1, "punctuation");
      i++;
    }
  } else {
    const header = RULE_HEADER.exec(rest);
    if (header) {
      const name = header[1];
      push(statementStart, statementStart + name.length, "ruleName");
      i = statementStart + name.length;
      while (i < limit && (line[i] === " " || line[i] === "\t")) i++;
      if (line[i] === ":") {
        push(i, i + 1, "punctuation");
        i++;
      }
      state.decl = undefined;
    }
  }

  scanExpression(line, i, limit, state, push);
  if (commentAt >= 0) push(commentAt, line.length, "comment");
  return tokens;
}

function tokenizeDeclarationPrefix(
  line: string,
  start: number,
  limit: number,
  state: LexurgyHighlightState,
  push: (from: number, to: number, tag: LexurgyTokenTag) => void
): number {
  let i = start;
  const skip = (): void => {
    while (i < limit && (line[i] === " " || line[i] === "\t")) i++;
  };
  skip();

  switch (state.decl) {
    case "feature": {
      // Feature (Syllable) +stress, +long
      const modifier = /^\((Syllable|syllable)\)/.exec(line.slice(i, limit));
      if (modifier) {
        push(i, i + modifier[0].length, "keyword");
        i += modifier[0].length;
        return i;
      }
      if (line[i] === "+" || line[i] === "-") return i;
      const name = NAME.exec(line.slice(i, limit));
      if (name) {
        push(i, i + name[0].length, "featureName");
        i += name[0].length;
      }
      return i;
    }
    case "symbol":
    case "diacritic": {
      // Style every comma-separated symbol/diacritic, stopping at a matrix.
      while (i < limit && line[i] !== "[") {
        while (i < limit && (line[i] === " " || line[i] === "\t")) i++;
        if (i >= limit || line[i] === "[") break;
        if (line[i] === ",") {
          push(i, i + 1, "punctuation");
          i++;
          continue;
        }
        const symbolStart = i;
        while (i < limit && line[i] !== "," && line[i] !== "[") i++;
        let end = i;
        while (end > symbolStart && /[ \t]/.test(line[end - 1])) end--;
        push(symbolStart, end, "symbol");
      }
      return i;
    }
    case "class": {
      const name = NAME.exec(line.slice(i, limit));
      if (name) {
        push(i, i + name[0].length, "elementName");
        i += name[0].length;
      }
      return i;
    }
    case "element": {
      const name = NAME.exec(line.slice(i, limit));
      if (name) {
        push(i, i + name[0].length, "elementName");
        i += name[0].length;
      }
      return i;
    }
    case "romanizer":
    case "deromanizer": {
      if (line[i] === "-") {
        push(i, i + 1, "operator");
        i++;
        skip();
        const ruleName = NAME.exec(line.slice(i, limit))?.[0];
        if (ruleName) {
          push(i, i + ruleName.length, "ruleName");
          i += ruleName.length;
        }
      }
      skip();
      const literal = /^Literal\b/i.exec(line.slice(i, limit));
      if (literal) {
        push(i, i + literal[0].length, "keyword");
        i += literal[0].length;
      }
      return i;
    }
    default:
      return i;
  }
}

function scanExpression(
  line: string,
  start: number,
  limit: number,
  state: LexurgyHighlightState,
  push: (from: number, to: number, tag: LexurgyTokenTag) => void
): void {
  let i = start;
  while (i < limit) {
    const ch = line[i];
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }

    if (ch === "[") {
      push(i, i + 1, "punctuation");
      state.matrixDepth++;
      i++;
      continue;
    }
    if (ch === "]") {
      push(i, i + 1, "punctuation");
      state.matrixDepth = Math.max(0, state.matrixDepth - 1);
      i++;
      continue;
    }
    if (ch === "{") {
      push(i, i + 1, "punctuation");
      state.braceDepth++;
      i++;
      continue;
    }
    if (ch === "}") {
      push(i, i + 1, "punctuation");
      state.braceDepth = Math.max(0, state.braceDepth - 1);
      i++;
      continue;
    }
    if (ch === "(") {
      push(i, i + 1, "punctuation");
      if (state.decl === "feature") state.featureListDepth++;
      i++;
      continue;
    }
    if (ch === ")") {
      push(i, i + 1, "punctuation");
      state.featureListDepth = Math.max(0, state.featureListDepth - 1);
      i++;
      continue;
    }
    if (ch === "," || ch === ":") {
      push(i, i + 1, "punctuation");
      i++;
      continue;
    }

    if (state.matrixDepth > 0 || state.featureListDepth > 0) {
      const signed = /^[+-][A-Za-z0-9_]+/.exec(line.slice(i, limit));
      if (signed) {
        push(i, i + signed[0].length, "featureValue");
        i += signed[0].length;
        continue;
      }
      const capture = /^\$[A-Za-z0-9_]+/.exec(line.slice(i, limit));
      if (capture) {
        push(i, i + capture[0].length, "capture");
        i += capture[0].length;
        continue;
      }
      if (ch === "!" || ch === "*" || ch === "$") {
        push(i, i + 1, "operator");
        i++;
        continue;
      }
      const name = NAME.exec(line.slice(i, limit));
      if (name) {
        push(i, i + name[0].length, "featureValue");
        i += name[0].length;
        continue;
      }
      push(i, i + 1, "operator");
      i++;
      continue;
    }

    if (state.decl === "feature" && (ch === "+" || ch === "-")) {
      const signed = /^[+-][A-Za-z0-9_]+/.exec(line.slice(i, limit));
      if (signed) {
        push(i, i + signed[0].length, "featureValue");
        i += signed[0].length;
        continue;
      }
    }

    const capture = /^~?\$\.?\d+/.exec(line.slice(i, limit));
    if (capture) {
      push(i, i + capture[0].length, "capture");
      i += capture[0].length;
      continue;
    }
    if (ch === "$") {
      const len = line[i + 1] === "$" ? 2 : 1;
      push(i, i + len, "operator");
      i += len;
      continue;
    }
    if (ch === "@") {
      const name = /^@[A-Za-z0-9_-]+/.exec(line.slice(i, limit));
      if (name) {
        push(i, i + name[0].length, "elementRef");
        i += name[0].length;
        continue;
      }
    }
    if (ch === "=") {
      const arrow = /^(?:<=>|=>|==>|->|<=)/.exec(line.slice(i, limit));
      if (arrow) {
        push(i, i + arrow[0].length, "operator");
        i += arrow[0].length;
        continue;
      }
    }
    if (ch === "/") {
      const len = line[i + 1] === "/" ? 2 : 1;
      push(i, i + len, "operator");
      i += len;
      continue;
    }
    if (ch === "&") {
      const len = line[i + 1] === "!" ? 2 : 1;
      push(i, i + len, "operator");
      i += len;
      continue;
    }
    if (ch === "*") {
      const repeat = /^\*(?:\([^)]*\)|\d+)?/.exec(line.slice(i, limit));
      const len = repeat?.[0].length ?? 1;
      push(i, i + len, "operator");
      i += len;
      continue;
    }
    if ("_!?.+->".includes(ch)) {
      push(i, i + 1, "operator");
      i++;
      continue;
    }
    if (ch === "\\") {
      i += Math.min(2, limit - i);
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const number = /^\d+(?:-\d+)?/.exec(line.slice(i, limit));
      const len = number?.[0].length ?? 1;
      push(i, i + len, "number");
      i += len;
      continue;
    }

    const name = NAME.exec(line.slice(i, limit));
    if (name) {
      if (state.decl === "class" && state.braceDepth > 0) {
        push(i, i + name[0].length, "elementName");
      }
      i += name[0].length;
      continue;
    }

    // Conlang text: consume until the next structural character.
    const textStart = i;
    while (i < limit && !/[\s[\]{}()@$*!?/&<>+=,:."]/.test(line[i])) i++;
    if (i === textStart) i++;
    if (state.decl === "symbol" || state.decl === "diacritic") {
      push(textStart, i, "symbol");
    }
  }
}

function findComment(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== "#") continue;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && line[j] === "\\"; j--) backslashes++;
    if (backslashes % 2 === 0) return i;
  }
  return -1;
}

/**
 * Syntax colouring as decorations rather than a CodeMirror language extension.
 * This keeps the editor independent of the Markdown parser and works in every
 * Obsidian build, while still using the tokenizer above.
 */
export function createLexurgyHighlightExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    {
      decorations: (value) => value.decorations,
    }
  );
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const state = initialState();
    let position = from;
    while (position <= to) {
      const line = view.state.doc.lineAt(position);
      if (line.from > to) break;
      const text = view.state.doc.sliceString(line.from, Math.min(line.to, to));
      for (const token of tokenizeLexurgyLine(text, state)) {
        if (token.tag === "text") continue;
        builder.add(
          line.from + token.from,
          line.from + token.to,
          Decoration.mark({ class: `langscape-syntax-${token.tag}` })
        );
      }
      position = line.to + 1;
    }
  }
  return builder.finish();
}

function initialState(): LexurgyHighlightState {
  return {
    decl: undefined,
    matrixDepth: 0,
    featureListDepth: 0,
    braceDepth: 0,
  };
}
