// Structural recognition for Lexurgy 1.7.7. The engine remains responsible for
// validating expressions, declarations and references. Indentation is not
// significant, the interpreter requires a colon, and Then/Else are clauses
// when following an existing block, even when they start at column one.
const ruleName = "(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*";
const modifier = "(?:@[A-Za-z0-9]+|\\[[^\\]]*\\]|[A-Za-z0-9]+)";
const modifiers = `(?:\\s+${modifier})*`;
const ruleHeader = new RegExp(`^(${ruleName})${modifiers}:$`);
const blockClause = new RegExp(`^(?:Then|then|Else|else)${modifiers}:(?!:)`);
const blockReference = new RegExp(`^:${ruleName}$`);
const romanizer = new RegExp(`^(?:(?:Deromanizer|deromanizer)|(?:Romanizer|romanizer)(?:-${ruleName})?)(?:\\s+(?:Literal|literal))?:$`);
const syllables = /^(?:Syllables|syllables):$/;
const keywordExpression = /^(?:Off|off|Unchanged|unchanged)$/;

type Line = {
  original: string;
  ending: string;
  code: string;
  comment: number;
  owner?: string;
  ambiguous?: boolean;
};

export function listRecipeRules(source: string): string[] {
  return [...new Set(scanRules(source).names)];
}

export function filterRecipeRules(source: string, disabledRules: string[]): { source: string; hasCode: boolean } {
  const { lines, names } = scanRules(source);
  const disabled = new Set(disabledRules);
  const known = new Set(names);
  for (const name of disabled) {
    if (!known.has(name)) throw new Error(`Disabled rule "${name}" was not found.`);
  }
  // A persistent Cleanup rule and its Off statement can share one name.
  // Disabling that name disables both occurrences.
  let hasCode = false;
  const filtered = lines.map(({ original, ending, code, comment, owner, ambiguous }, index) => {
    if (code && owner !== undefined && disabled.has(owner)) {
      if (ambiguous) throw new Error(`Cannot identify the body of rule "${owner}" at line ${index + 1}.`);
      // Keep comments and newlines, including inline comments, to avoid
      // changing line numbers or removing non-rule text from the script.
      return (comment < original.length ? original.slice(comment) : "") + ending;
    }
    if (code) hasCode = true;
    return original + ending;
  });
  return { source: filtered.join(""), hasCode };
}

function scanRules(source: string): { lines: Line[]; names: string[] } {
  const names: string[] = [];
  const parts = source.split(/(\r?\n)/);
  const lines: Line[] = [];
  let owner: string | undefined;
  let inBlock = false;
  let hasBody = false;
  let depth = 0;
  let continues = false;
  for (let index = 0; index < parts.length; index += 2) {
    const original = parts[index];
    const { code, comment } = lexLine(original);
    const line: Line = { original, ending: parts[index + 1] ?? "", code, comment };
    lines.push(line);
    if (!code) continue;
    const continuesOnNextLine = /(?:=>|\/\/?|\\)$/.test(code);
    let ambiguous = false;
    if (depth > 0 || continues) {
      if (inBlock) hasBody = true;
    } else if (romanizer.test(code) || syllables.test(code) || isDeclaration(code)) {
      owner = undefined;
      inBlock = romanizer.test(code);
      hasBody = false;
    } else if (inBlock && hasBody && blockClause.test(code)) {
      // A clause may start its expression on this same line or the next one.
    } else if (inBlock && keywordExpression.test(code)) {
      hasBody = true;
    } else {
      const header = ruleHeader.exec(code);
      if (header) {
        owner = header[1];
        inBlock = true;
        hasBody = false;
        names.push(owner);
      } else if (inBlock) {
        hasBody = true;
        ambiguous = !continuesOnNextLine && !code.includes("=>") && !blockReference.test(code) && !code.startsWith("(");
      }
    }
    line.owner = owner;
    line.ambiguous = ambiguous;
    for (const char of code) {
      if ("([{".includes(char)) depth++;
      if (")]}".includes(char)) depth--;
    }
    continues = continuesOnNextLine;
  }
  return { lines, names };
}

function isDeclaration(code: string): boolean {
  // The same tokens may be rule names: e.g. `Feature:` or `Symbol RTL:`.
  return /^(?:Feature|feature)\s+(?:(?:\((?:Syllable|syllable)\)\s+)?\+?[A-Za-z0-9]+(?:,\s*\+?[A-Za-z0-9]+)*|.*\([^)]+\))$/.test(code) ||
    /^(?:Symbol|symbol)\s+[^\s,.=>()*[\]{}+?/\-_:~$@&]+(?:,\s*[^\s,.=>()*[\]{}+?/\-_:~$@&]+)*(?:\s+\[[^\]]*\])?$/.test(code) ||
    /^(?:Diacritic|diacritic)\s+[^:]+\[[^\]]*\](?:\s+\([^)]*\))*$/.test(code) && !code.includes("=>") ||
    /^(?:Class|class)\s+[A-Za-z0-9]+\s+\{/.test(code) ||
    /^(?:Element|element)\s+[A-Za-z0-9]+\s+.+/.test(code) && !code.includes("=>");
}

function lexLine(line: string): { code: string; comment: number } {
  let code = "";
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === "\\" && index + 1 < line.length) {
      // An escaped punctuation/whitespace character is a literal, not syntax.
      code += "\u0001";
      index++;
    } else if (char === "#") {
      return { code: code.trim(), comment: index };
    } else {
      code += char;
    }
  }
  return { code: code.trim(), comment: line.length };
}
