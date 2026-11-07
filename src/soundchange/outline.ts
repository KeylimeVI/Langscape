export interface LexurgyRule {
  name: string;
  /** 1-based line number of the rule header. */
  line: number;
  /** 1-based last line of the rule's body. */
  endLine: number;
  /** Number of `Then:` sub-rules in this rule. */
  thenCount: number;
}

export interface LexurgyOutline {
  rules: LexurgyRule[];
  features: number;
  symbols: number;
  classes: number;
  elements: number;
  romanizers: number;
  errors: string[];
}

const DECLARATIONS =
  /^(Feature|Symbol|Class|Element|Romanizer|Syllable|Stress|Propagate|Define|Sound Changes)\b/i;
const RULE_HEADER = /^\s{0,3}([A-Za-z0-9_][A-Za-z0-9 _'’.\-]*?)\s*:\s*(?:#.*)?$/;
const THEN_HEADER = /^\s+Then\s*:\s*(?:#.*)?$/i;

/**
 * Parse rule headers and declaration counts for the rule selectors. This is
 * deliberately a structural parser, not a validator: Lexurgy itself is the
 * source of truth for whether a file is valid.
 */
export function parseOutline(source: string): LexurgyOutline {
  const lines = source.split(/\r?\n/);
  const rules: LexurgyRule[] = [];
  let features = 0;
  let symbols = 0;
  let classes = 0;
  let elements = 0;
  let romanizers = 0;
  let current: LexurgyRule | undefined;
  let inBlockComment = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;
    const trimmed = line.trim();

    if (inBlockComment) {
      if (trimmed.includes("#")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("#")) continue;

    if (/^Feature\b/i.test(trimmed)) features++;
    else if (/^Symbol\b/i.test(trimmed)) symbols++;
    else if (/^Class\b/i.test(trimmed)) classes++;
    else if (/^Element\b/i.test(trimmed)) elements++;
    else if (/^Romanizer\b/i.test(trimmed)) romanizers++;

    if (THEN_HEADER.test(line)) {
      if (current) current.thenCount++;
      continue;
    }

    if (DECLARATIONS.test(trimmed)) continue;
    if (trimmed.startsWith("Then:")) {
      if (current) current.thenCount++;
      continue;
    }

    const header = RULE_HEADER.exec(line);
    if (!header) continue;
    const name = header[1].trim();
    if (!name || /^(Feature|Symbol|Class|Element|Romanizer|Syllable|Stress|Propagate|Define)$/i.test(name)) {
      continue;
    }

    if (current) current.endLine = lineNumber - 1;
    current = { name, line: lineNumber, endLine: lines.length, thenCount: 0 };
    rules.push(current);
  }

  return {
    rules,
    features,
    symbols,
    classes,
    elements,
    romanizers,
    errors: [],
  };
}

export function ruleNames(outline: LexurgyOutline): string[] {
  return outline.rules.map((rule) => rule.name);
}

export function ruleAtLine(outline: LexurgyOutline, line: number): LexurgyRule | undefined {
  return outline.rules.find((rule) => line >= rule.line && line <= rule.endLine);
}

/** Convert a 1-based line to a CodeMirror document offset. */
export function lineToOffset(doc: string, line: number): number {
  const lines = doc.split("\n");
  const target = Math.max(0, Math.min(lines.length - 1, line - 1));
  let offset = 0;
  for (let i = 0; i < target; i++) offset += lines[i].length + 1;
  return offset;
}

export function lineRange(doc: string, line: number): { from: number; to: number } {
  const lines = doc.split("\n");
  const target = Math.max(0, Math.min(lines.length - 1, line - 1));
  let from = 0;
  for (let i = 0; i < target; i++) from += lines[i].length + 1;
  return { from, to: from + lines[target].length };
}
