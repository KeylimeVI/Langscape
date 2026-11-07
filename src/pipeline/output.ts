import type { WordEntry } from "./words";

export interface Stage {
  label: string;
  form: string;
}

export interface OutputWord extends WordEntry {
  form: string;
  history: Stage[];
}

export interface NoteRenderContext {
  /** Final language / pipeline name; defaults to the output folder name. */
  pipelineName: string;
  /** Property name for the evolved word. */
  outputField?: string;
}

const RESERVED_FIELDS = new Set(["source", "original", "pipeline"]);

/** Preserve conlang orthography while keeping names safe on every OS. */
export function sanitizeFilename(form: string): string {
  const normalized = form.normalize("NFC");
  let safe = normalized
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, 100)
    .trim();
  if (!safe) return "word";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safe)) safe = `word-${safe}`.slice(0, 100);
  return safe;
}

export function expandFilenameTemplate(
  template: string | undefined,
  word: OutputWord,
  index: number
): string {
  const base = template?.trim() || "{word}";
  return base
    .replace(/\{word\}/gi, word.form)
    .replace(/\{proto\}/gi, word.word)
    .replace(/\{index\}/gi, String(index + 1))
    .replace(/\{source\}/gi, word.sourcePath?.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "");
}

/**
 * Generated notes contain only the useful properties:
 * source, original word, evolved word, and pipeline/language name.
 */
export function renderMarkdownNote(word: OutputWord, context: NoteRenderContext): string {
  const requestedField = context.outputField?.trim() || "word";
  const field = RESERVED_FIELDS.has(requestedField) ? "word" : requestedField;
  const sourceLink = word.sourcePath
    ? `[[${word.sourcePath.replace(/\.md$/i, "")}]]`
    : undefined;

  const lines = ["---"];
  if (sourceLink) lines.push(`source: ${yamlString(sourceLink)}`);
  lines.push(`original: ${yamlString(word.word)}`);
  lines.push(`${yamlKey(field)}: ${yamlString(word.form)}`);
  lines.push(`pipeline: ${yamlString(context.pipelineName)}`);
  lines.push("---", "");
  return lines.join("\n");
}

export function renderWli(words: OutputWord[]): string {
  return words.map((word) => word.form).join("\n") + (words.length ? "\n" : "");
}

/**
 * A generated note is identified by its pipeline/original properties. Old notes
 * from before this format are still detected by the `langscape: word` marker.
 */
export function isGeneratedNote(content: string): boolean {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? "";
  if (/^langscape:\s*word\s*$/m.test(frontmatter)) return true;
  return /^pipeline:\s*\S/m.test(frontmatter) && /^original:\s*\S/m.test(frontmatter);
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlKey(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value);
}

export function defaultPipelineName(path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, "");
  const base = clean.split("/").pop() ?? "";
  return base.replace(/\.wli$/i, "") || "output";
}
