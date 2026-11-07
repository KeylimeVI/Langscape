import type { App } from "obsidian";
import { parseYaml } from "obsidian";
import type { SourceStep } from "./model";

export interface WordEntry {
  word: string;
  sourcePath?: string;
  meta: Record<string, unknown>;
}

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const WORD_BLOCK = /```(?:langscape-words?|langscape-wordlist)(?:[ \t]+[^\n]*)?\r?\n([\s\S]*?)```/gi;

export function splitFrontmatter(source: string): ParsedFrontmatter {
  const match = FRONTMATTER.exec(source);
  if (!match) return { data: {}, body: source };
  let data: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(match[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    data = {};
  }
  return { data, body: source.slice(match[0].length) };
}

export function extractMarkdownWords(
  source: string,
  sourcePath: string,
  field = "word"
): WordEntry[] {
  const { data, body } = splitFrontmatter(source);
  const entries: WordEntry[] = [];
  const seen = new Set<string>();

  const add = (value: unknown): void => {
    const words = Array.isArray(value) ? value : [value];
    for (const item of words) {
      if (typeof item !== "string" && typeof item !== "number") continue;
      const word = String(item).trim();
      if (!word || seen.has(word)) continue;
      seen.add(word);
      entries.push({ word, sourcePath, meta: { ...data } });
    }
  };

  if (Object.prototype.hasOwnProperty.call(data, field)) {
    add(data[field]);
  } else if (Object.prototype.hasOwnProperty.call(data, "words")) {
    add(data.words);
  }

  WORD_BLOCK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_BLOCK.exec(body)) !== null) {
    for (const line of match[1].split(/\r?\n/)) {
      const word = line.trim();
      if (!word) continue;
      add(word);
    }
  }

  return entries;
}

export function parseWli(source: string, sourcePath?: string): WordEntry[] {
  const entries: WordEntry[] = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    entries.push({ word: line, sourcePath, meta: {} });
  }
  return entries;
}

export function inlineWords(words: string[]): WordEntry[] {
  return words
    .map((word) => word.trim())
    .filter(Boolean)
    .map((word) => ({ word, meta: {} }));
}

/** Read all words for a source step from the vault. */
export async function extractSourceWords(app: App, step: SourceStep): Promise<WordEntry[]> {
  const path = step.path.trim().replace(/^\/+|\/+$/g, "");
  if (!path) throw new Error("The source step has no path.");
  const abstract = app.vault.getAbstractFileByPath(path);

  if (abstract && "extension" in abstract) {
    const file = abstract as import("obsidian").TFile;
    const text = await app.vault.cachedRead(file);
    return parseSourceFile(text, file.path, file.extension.toLowerCase(), step.field);
  }

  const folder = abstract as import("obsidian").TFolder | null;
  if (folder && "children" in folder) {
    const files = app.vault
      .getFiles()
      .filter((file) => file.path.startsWith(path + "/"))
      .sort((a, b) => a.path.localeCompare(b.path));
    const entries: WordEntry[] = [];
    for (const file of files) {
      const extension = file.extension.toLowerCase();
      if (step.format === "markdown" && extension !== "md") continue;
      if (step.format === "wli" && extension !== "wli") continue;
      const text = await app.vault.cachedRead(file);
      entries.push(...parseSourceFile(text, file.path, extension, step.field));
    }
    return entries;
  }

  // The path might be a folder that Obsidian's cache doesn't know about yet, or
  // a .wli file that has not been indexed. Try the adapter directly.
  try {
    const text = await app.vault.adapter.read(path);
    return parseSourceFile(text, path, path.split(".").pop()?.toLowerCase() ?? "", step.field);
  } catch {
    throw new Error(`Source path not found: ${path}`);
  }
}

export function parseSourceFile(
  text: string,
  path: string,
  extension: string,
  field: string
): WordEntry[] {
  if (extension === "wli" || extension === "wordlist") return parseWli(text, path);
  return extractMarkdownWords(text, path, field);
}

export function wordFieldLabel(field: string): string {
  return field === "word" ? "word" : `“${field}” field`;
}
