import { normalizePath, type App } from "obsidian";

/** Create a vault folder (and its parents), tolerating concurrent creation. */
export async function ensureVaultFolder(app: App, folder: string): Promise<void> {
  if (!folder || folder === "." || folder === "/") return;
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
