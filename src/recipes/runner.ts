import { normalizePath, type App, type TAbstractFile, type TFile, type TFolder } from "obsidian";
import { isAlias, isMap, isScalar, parseDocument, stringify, visit, type Alias, type Scalar } from "yaml";
import { ensureVaultFolder } from "../utils/vault";
import type { Recipe } from "./model";
import { assertRecipeFolder, getRecipeDisk, type RecipeDisk } from "./paths";
import { filterRecipeRules } from "./rules";

interface Frontmatter {
  start: number;
  end: number;
  text: string;
  document: ReturnType<typeof parseDocument>;
}

type TextNode = Scalar<string> | Alias;

interface RecipeNote {
  output: string;
  source: string;
  frontmatter: Frontmatter;
  node: TextNode;
  word: string;
}

export async function listRecipeProperties(app: App, folder: string): Promise<string[]> {
  const names = new Set<string>();
  const files = await directMarkdownFiles(app, vaultPath(folder), getRecipeDisk(app.vault));
  for (const file of files) {
    const frontmatter = parseFrontmatter(await app.vault.read(file));
    if (!frontmatter || !isMap(frontmatter.document.contents)) continue;
    for (const { key, value } of frontmatter.document.contents.items) {
      if (isScalar(key) && typeof key.value === "string" && key.value.trim() &&
          textValue(frontmatter, value) !== undefined) {
        names.add(key.value);
      }
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export async function runRecipe({ app, recipe, apply }: {
  app: App;
  recipe: Recipe;
  apply: (source: string, words: string[]) => Promise<{ words: string[] }>;
}): Promise<{ written: number; skipped: number; paths: string[] }> {
  if (recipe.inputFolder === null || recipe.outputFolder === null) {
    throw new Error("Choose an input and an output folder before running the recipe.");
  }
  if (!recipe.property.trim()) throw new Error("Choose a text frontmatter property before running the recipe.");
  if (!recipe.changes.length) throw new Error("Add a sound-change file before running the recipe.");
  const inputFolder = vaultPath(recipe.inputFolder);
  const outputFolder = vaultPath(recipe.outputFolder);
  if (inputFolder.toLowerCase() === outputFolder.toLowerCase()) {
    throw new Error("The recipe input and output folders must be different.");
  }
  const disk = getRecipeDisk(app.vault);
  const files = await directMarkdownFiles(app, inputFolder, disk);
  const notes: RecipeNote[] = [];
  for (const file of files) {
    const source = await app.vault.read(file);
    const frontmatter = parseFrontmatter(source);
    if (!frontmatter) continue;
    const selected = findText(frontmatter, recipe.property);
    if (!selected) continue;
    const name = file.path.slice(file.path.lastIndexOf("/") + 1);
    const output = outputFolder === "/" ? name : `${outputFolder}/${name}`;
    notes.push({ output, source, frontmatter, ...selected });
  }

  await checkDestinations(app, outputFolder, notes.map(({ output }) => output), disk);
  const stages = [];
  for (const change of recipe.changes) {
    try {
      const path = vaultPath(change.path);
      const file = app.vault.getAbstractFileByPath(path);
      if (!isFile(file, "lsc")) throw new Error("Sound-change file (.lsc) not found.");
      const filtered = filterRecipeRules(await app.vault.read(file), change.disabledRules);
      if (filtered.hasCode) stages.push({ path, source: filtered.source });
    } catch (error) {
      throw fileError(change.path, error);
    }
  }

  let words = notes.map(({ word }) => word);
  for (const { path, source } of stages) {
    if (!words.length) break;
    try {
      const result = await apply(source, words);
      if (result.words.length !== notes.length || result.words.some((word) => typeof word !== "string")) {
        throw new Error(`Lexurgy did not return one text result for each of the ${notes.length} inputs.`);
      }
      words = result.words;
    } catch (error) {
      throw fileError(path, error);
    }
  }

  // Finish all Lexurgy work and prepare every copy before writing any outputs.
  const outputs = notes.map((note, index) => {
    try {
      return { path: note.output, content: replaceText(note, recipe.property, words[index]) };
    } catch (error) {
      throw fileError(note.output, error);
    }
  });
  const paths = outputs.map(({ path }) => path);
  if (outputs.length) {
    // A Lexurgy stage can take time; check again before creating anything.
    await checkDestinations(app, outputFolder, paths, disk);
    await ensureVaultFolder(app, outputFolder);
    for (const { path, content } of outputs) {
      const existing = await writableNoteAt(app, path, disk);
      if (existing) await app.vault.modify(existing, content);
      else await app.vault.create(path, content);
    }
  }
  return { written: paths.length, skipped: files.length - paths.length, paths };
}

async function directMarkdownFiles(app: App, path: string, disk?: RecipeDisk): Promise<TFile[]> {
  if (disk) await assertRecipeFolder(disk, path);
  const folder = path === "/" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(path);
  if (!isFolder(folder)) throw new Error(`Input folder "${path}" does not exist.`);
  const files: TFile[] = [];
  for (const file of folder.children) {
    if (isFile(file, "md") && (!disk || (await disk.stat(file.path))?.isFile())) files.push(file);
  }
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function isFile(file: TAbstractFile | null, extension: string): file is TFile {
  return !!file && "extension" in file && typeof file.extension === "string" &&
    file.extension.toLowerCase() === extension;
}

function isFolder(file: TAbstractFile | null): file is TFolder {
  return !!file && "children" in file;
}

function vaultPath(path: string): string {
  if (!path.trim() || path.split(/[\\/]/).includes("..")) throw new Error(`Invalid vault path "${path}".`);
  // Treat repeated separators and '.' as aliases for the same vault location.
  const parts = normalizePath(path).split("/").filter((part) => part && part !== ".");
  return parts.length ? parts.join("/") : "/";
}

async function checkDestinations(app: App, folder: string, paths: string[], disk?: RecipeDisk): Promise<void> {
  if (disk) await assertRecipeFolder(disk, folder);
  else if (folder !== "/") {
    let current = "";
    for (const part of folder.split("/")) {
      current = current ? `${current}/${part}` : part;
      const entry = app.vault.getAbstractFileByPath(current);
      if (entry ? !isFolder(entry) : (await app.vault.adapter.stat(current))?.type === "file") {
        throw new Error(`Output folder path "${current}" is occupied by a file.`);
      }
    }
  }
  const claimed = new Set<string>();
  for (const path of paths) {
    const key = path.toLowerCase();
    if (claimed.has(key)) throw new Error(`More than one input note would create "${path}".`);
    claimed.add(key);
    await writableNoteAt(app, path, disk);
  }
}

async function writableNoteAt(app: App, path: string, disk?: RecipeDisk): Promise<TFile | null> {
  const stats = await disk?.stat(path);
  const entry = app.vault.getAbstractFileByPath(path);
  if (stats && (!stats.isFile() || stats.nlink > 1)) {
    throw new Error(`Output path "${path}" is not an ordinary file; the recipe won't replace it.`);
  }
  if (isFile(entry, "md")) return entry;
  if (entry || stats || (!disk && await app.vault.adapter.exists(path))) {
    throw new Error(`Output path "${path}" already exists but is not a writable Markdown note.`);
  }
  return null;
}

function parseFrontmatter(source: string): Frontmatter | undefined {
  const start = /^\uFEFF?---[ \t]*\r?\n/.exec(source)?.[0].length;
  if (start === undefined) return;
  const close = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(source.slice(start));
  if (!close) return;
  const end = start + close.index;
  return parseYaml(source.slice(start, end), start, end);
}

function parseYaml(text: string, start: number, end: number): Frontmatter | undefined {
  const document = parseDocument(text, { keepSourceTokens: true });
  if (document.errors.length) return;
  return { start, end, text, document };
}

function textValue(frontmatter: Frontmatter, value: unknown): { node: TextNode; word: string } | undefined {
  const resolved = isAlias(value) ? value.resolve(frontmatter.document) : value;
  if (isScalar(resolved) && typeof resolved.value === "string" && resolved.value.trim()) {
    return { node: (isAlias(value) ? value : resolved) as TextNode, word: resolved.value };
  }
}

function findText(frontmatter: Frontmatter, property: string): { node: TextNode; word: string } | undefined {
  const root = frontmatter.document.contents;
  if (!isMap(root)) return;
  const pair = root.items.find(({ key }) => isScalar(key) && key.value === property);
  return textValue(frontmatter, pair?.value);
}

function replaceText({ source, frontmatter, node, word }: RecipeNote, property: string, output: string): string {
  if (word === output) return source;
  const { document, text, start, end } = frontmatter;
  if (!node.range) throw new Error("Could not locate the selected YAML value.");
  if (isScalar(node) && node.anchor) {
    let referenced = false;
    visit(document, { Alias: (_, alias) => { if (alias.resolve(document) === node) referenced = true; } });
    if (referenced) throw new Error("The selected YAML value is an anchor used elsewhere in the note.");
  }
  const [valueStart, valueEnd] = node.range;
  const token = node.srcToken;
  // A block scalar's range includes its header comment and newline as well as
  // the value. Preserve that comment on the new inline scalar.
  const trailer = token?.type === "block-scalar"
    ? token.props.slice(1).map((prop) => "source" in prop ? prop.source : "").join("") : "";
  const style = isScalar(node) && (node.type === "QUOTE_SINGLE" || node.type === "QUOTE_DOUBLE")
    ? node.type : "PLAIN";
  for (const defaultStringType of [style, "QUOTE_DOUBLE"] as const) {
    const scalar = stringify(output, {
      defaultStringType,
      blockQuote: false,
      lineWidth: 0,
      doubleQuotedMinMultiLineLength: Infinity,
    }).slice(0, -1);
    if (/\r|\n/.test(scalar)) continue;
    const updated = text.slice(0, valueStart) + scalar + trailer + text.slice(valueEnd);
    // Quoting can be required for a scalar embedded in a flow map, even if it
    // would parse as a string when rendered on its own. No other bytes change.
    const check = parseYaml(updated, 0, updated.length);
    const value = check && isMap(check.document.contents) ? check.document.contents.get(property) : undefined;
    if (value === output) return source.slice(0, start) + updated + source.slice(end);
  }
  throw new Error("Could not safely replace the selected YAML text.");
}

function fileError(path: string, error: unknown): Error {
  return new Error(`"${path}": ${error instanceof Error ? error.message : String(error)}`, { cause: error });
}
