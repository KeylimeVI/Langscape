export interface SyntaxTreeNode {
  label: string;
  children: SyntaxTreeNode[];
}

/**
 * A syntax tree is a complete Markdown line:
 *
 *   {tree: VP(NP(I), V(see), NP(Det(the), Adj(blue), N(sky)))}
 *
 * Labels may contain font spans. The outer brace matcher is balanced, so
 * `{tengwar: text}` inside a label does not terminate the tree.
 */
export function parseSyntaxTreeLine(line: string): SyntaxTreeNode | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{tree:")) return null;

  let depth = 0;
  let close = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
      if (depth < 0) return null;
    }
  }
  if (close !== trimmed.length - 1) return null;

  const body = trimmed.slice(6, close);
  const parser = new TreeParser(body);
  const root = parser.parseNode();
  parser.skipWhitespace();
  if (!root || parser.position !== body.length) return null;
  return root;
}

class TreeParser {
  position = 0;

  constructor(private readonly text: string) {}

  parseNode(): SyntaxTreeNode | null {
    this.skipWhitespace();
    const label = this.readLabel();
    if (label === null) return null;

    const children: SyntaxTreeNode[] = [];
    this.skipWhitespace();
    if (this.peek() !== "(") return { label, children };

    this.position++;
    this.skipWhitespace();
    if (this.peek() === ")") {
      this.position++;
      return { label, children };
    }

    while (this.position < this.text.length) {
      const child = this.parseNode();
      if (!child) return null;
      children.push(child);
      this.skipWhitespace();
      const separator = this.peek();
      if (separator === ",") {
        this.position++;
        this.skipWhitespace();
        continue;
      }
      if (separator === ")") {
        this.position++;
        return { label, children };
      }
      return null;
    }
    return null;
  }

  skipWhitespace(): void {
    while (this.position < this.text.length && /\s/.test(this.text[this.position])) {
      this.position++;
    }
  }

  private peek(): string | undefined {
    return this.text[this.position];
  }

  private readLabel(): string | null {
    if (this.peek() === '"') {
      this.position++;
      let value = "";
      while (this.position < this.text.length) {
        const char = this.text[this.position];
        if (char === "\\") {
          const next = this.text[this.position + 1];
          if (next === undefined) return null;
          value += next;
          this.position += 2;
          continue;
        }
        if (char === '"') {
          this.position++;
          return value;
        }
        value += char;
        this.position++;
      }
      return null;
    }

    const start = this.position;
    let braces = 0;
    while (this.position < this.text.length) {
      const char = this.text[this.position];
      if (char === "{") {
        braces++;
        this.position++;
        continue;
      }
      if (char === "}") {
        if (braces === 0) break;
        braces--;
        this.position++;
        continue;
      }
      if (braces === 0 && (char === "(" || char === "," || char === ")")) break;
      this.position++;
    }
    if (this.position === start) return null;
    const value = this.text.slice(start, this.position).trim();
    return value || null;
  }
}

/** Serialize a tree back to the single-line `{tree: ...}` Markdown form. */
export function serializeSyntaxTree(root: SyntaxTreeNode): string {
  return `{tree: ${serializeNode(root)}}`;
}

function serializeNode(node: SyntaxTreeNode): string {
  const label = node.label.trim() ? node.label.trim() : '""';
  if (node.children.length === 0) return label;
  return `${label}(${node.children.map(serializeNode).join(", ")})`;
}

/** True when a label can round-trip through the tree parser. */
export function isValidSyntaxTreeLabel(label: string): boolean {
  const value = label.trim();
  if (!value) return true;
  const parsed = parseSyntaxTreeLine(`{tree: ${value}()}`);
  return parsed !== null && parsed.label === value;
}
