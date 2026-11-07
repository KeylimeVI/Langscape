import { normalizePath, type App, type TFile } from "obsidian";
import type { OutputStep } from "./model";
import {
  expandFilenameTemplate,
  isGeneratedNote,
  defaultPipelineName,
  renderMarkdownNote,
  renderWli,
  sanitizeFilename,
  type OutputWord,
} from "./output";

export interface WriteOutputOptions {
  app: App;
  step: OutputStep;
  words: OutputWord[];
  changes: string[];
  pipelinePath: string;
}

export interface WriteOutputResult {
  paths: string[];
  skipped: string[];
  errors: string[];
}

export async function writePipelineOutput(
  options: WriteOutputOptions
): Promise<WriteOutputResult> {
  if (options.words.length === 0) {
    return {
      paths: [],
      skipped: [],
      errors: ["The output step received no words."],
    };
  }
  if (options.step.format === "wli") return writeWli(options);
  return writeMarkdownNotes(options);
}

async function writeWli(options: WriteOutputOptions): Promise<WriteOutputResult> {
  const result: WriteOutputResult = { paths: [], skipped: [], errors: [] };
  const target = resolveWliPath(options.step.path, options.words);
  const sourcePaths = new Set(options.words.map((word) => word.sourcePath).filter(Boolean));
  if (sourcePaths.has(target)) {
    result.errors.push(
      `Refusing to overwrite a source word list with output: ${target}. Point the output step somewhere else.`
    );
    return result;
  }

  await ensureFolder(options.app, parentOf(target));
  const existing = options.app.vault.getAbstractFileByPath(target);
  if (existing && "extension" in existing) {
    if (!options.step.overwrite) {
      result.skipped.push(target);
      return result;
    }
  }
  await writeText(options.app, target, renderWli(options.words));
  result.paths.push(target);
  return result;
}

async function writeMarkdownNotes(options: WriteOutputOptions): Promise<WriteOutputResult> {
  const result: WriteOutputResult = { paths: [], skipped: [], errors: [] };
  const folder = normalizePath(options.step.path.replace(/^\/+|\/+$/g, ""));
  if (!folder) {
    result.errors.push("The output step has an empty folder path.");
    return result;
  }
  await ensureFolder(options.app, folder);
  const pipelineName = options.step.name?.trim() || defaultPipelineName(options.step.path);

  const sourcePaths = new Set(
    options.words.map((word) => word.sourcePath).filter((path): path is string => Boolean(path))
  );
  const used = new Set<string>();

  for (let index = 0; index < options.words.length; index++) {
    const word = options.words[index];
    const template = options.step.filename;
    const rawName = template
      ? expandFilenameTemplate(template, word, index)
      : sanitizeFilename(word.form);
    const baseName = sanitizeFilename(rawName || word.form);
    let target = normalizePath(`${folder}/${baseName}.md`);
    let suffix = 2;

    while (true) {
      if (sourcePaths.has(target)) {
        target = normalizePath(`${folder}/${baseName}-${suffix}.md`);
        suffix++;
        continue;
      }
      if (used.has(target)) {
        target = normalizePath(`${folder}/${baseName}-${suffix}.md`);
        suffix++;
        continue;
      }
      const existing = options.app.vault.getAbstractFileByPath(target);
      if (!existing || !("extension" in existing)) break;
      const file = existing as TFile;
      let content = "";
      try {
        content = await options.app.vault.cachedRead(file);
      } catch {
        content = "";
      }
      const generated = isGeneratedNote(content);
      // Never clobber a human-written note, even when overwrite is enabled.
      // Generated notes are safe to refresh on subsequent runs.
      if (generated && options.step.overwrite) break;
      target = normalizePath(`${folder}/${baseName}-${suffix}.md`);
      suffix++;
      if (suffix > 500) {
        result.errors.push(`Could not find a free filename for "${word.form}".`);
        break;
      }
    }

    used.add(target);
    try {
      const content = renderMarkdownNote(word, {
        pipelineName,
        outputField: options.step.field,
      });
      await writeText(options.app, target, content);
      result.paths.push(target);
    } catch (error) {
      result.errors.push(
        `Could not write ${target}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return result;
}

export function resolveWliPath(path: string, words: OutputWord[]): string {
  const clean = normalizePath(path.replace(/^\/+|\/+$/g, ""));
  if (/\.wli$/i.test(clean)) return clean;
  if (!clean) return "evolved.wli";
  return normalizePath(`${clean}/evolved.wli`);
}

async function ensureFolder(app: App, folder: string): Promise<void> {
  if (!folder || folder === ".") return;
  const normalized = normalizePath(folder);
  const existing = app.vault.getAbstractFileByPath(normalized);
  if (existing && "children" in existing) return;
  const parts = normalized.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const found = app.vault.getAbstractFileByPath(current);
    if (found && "children" in found) continue;
    try {
      await app.vault.createFolder(current);
    } catch (error) {
      // A concurrent create or an existing hidden folder should not fail the run.
      if (!(await app.vault.adapter.exists(current))) throw error;
    }
  }
}

async function writeText(app: App, path: string, content: string): Promise<void> {
  await ensureFolder(app, parentOf(path));
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing && "extension" in existing) {
    await app.vault.modify(existing as TFile, content);
    return;
  }
  await app.vault.create(path, content);
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "" : path.slice(0, index);
}

/** Exported for tests that need to check the collision logic without a vault. */
export function uniqueNotePath(
  folder: string,
  baseName: string,
  used: Set<string>,
  exists: (path: string) => boolean,
  isReusable: (path: string) => boolean
): string {
  let suffix = 2;
  let target = normalizePath(`${folder}/${baseName}.md`);
  while (used.has(target) || (exists(target) && !isReusable(target))) {
    target = normalizePath(`${folder}/${baseName}-${suffix}.md`);
    suffix++;
  }
  return target;
}
