import { FileSystemAdapter, normalizePath, Platform, TFile, TFolder, type App, type Vault } from "obsidian";
import type { VaultDisk } from "./vault-disk";

export type { VaultDisk };

type VaultDiskModule = typeof import("./vault-disk");
let vaultDiskLoader: Promise<VaultDiskModule | undefined> | undefined;

function loadVaultDiskModule(): Promise<VaultDiskModule | undefined> {
  if (!Platform?.isDesktopApp) return Promise.resolve(undefined);
  if (!vaultDiskLoader) {
    vaultDiskLoader = import("./vault-disk").catch(() => undefined);
  }
  return vaultDiskLoader;
}

function configDirNames(vault: Vault): string[] {
  const names = new Set([".obsidian"]);
  if (vault.configDir) names.add(vault.configDir);
  return [...names];
}

export async function getVaultDisk(vault: Vault): Promise<VaultDisk | undefined> {
  const { adapter } = vault;
  if (!(adapter instanceof FileSystemAdapter)) return undefined;
  const mod = await loadVaultDiskModule();
  if (!mod) return undefined;
  return mod.createDesktopVaultDisk(adapter, configDirNames(vault));
}

/**
 * List real folders in the vault, stopping at symlinks/junctions, nested
 * Obsidian vaults, and directory aliases/cycles.
 */
export async function listVaultFolders(vault: Vault): Promise<TFolder[]> {
  const { folders } = await walkVault(vault, "folders");
  return folders.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * List real files in the vault matching `matchFile`, skipping symlinks,
 * nested Obsidian vaults, and directory aliases/cycles.
 */
export async function listVaultFiles(
  vault: Vault,
  matchFile?: (file: TFile) => boolean
): Promise<TFile[]> {
  const { files } = await walkVault(vault, "files", matchFile);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function walkVault(
  vault: Vault,
  kind: "folders" | "files",
  matchFile?: (file: TFile) => boolean
): Promise<{ folders: TFolder[]; files: TFile[] }> {
  const disk = await getVaultDisk(vault);
  const root = vault.getRoot();
  const seen = new Set([root.path, "/"]);
  const visitedRealDirs = new Set<string>();
  const rootReal = disk ? await disk.realpath("") : undefined;
  if (rootReal) visitedRealDirs.add(rootReal);

  const folders: TFolder[] = [];
  const files: TFile[] = [];

  const visitChildren = async (parent: TFolder): Promise<void> => {
    const children = [...parent.children].sort((a, b) => a.path.localeCompare(b.path));
    const checked = await Promise.all(children.map(async (child) => {
      if (child.parent !== parent || seen.has(child.path)) return null;
      seen.add(child.path);
      if (child instanceof TFolder) {
        // Stop at the boundary, rather than trimming a prefix off all its children.
        if (disk) {
          const entry = await disk.stat(child.path);
          if (!entry?.isDirectory() || await disk.isNestedVault(child.path)) return null;
          const real = await disk.realpath(child.path);
          return { child, kind: "folder" as const, real };
        }
        if (await isNestedVaultViaAdapter(vault, child.path)) return null;
        return { child, kind: "folder" as const, real: undefined };
      }
      if (kind === "files" && child instanceof TFile && (!matchFile || matchFile(child))) {
        if (disk && !(await disk.stat(child.path))?.isFile()) return null;
        return { child, kind: "file" as const, real: undefined };
      }
      return null;
    }));

    const nextFolders: TFolder[] = [];
    for (const item of checked) {
      if (!item) continue;
      if (item.kind === "folder") {
        if (item.real) {
          if (visitedRealDirs.has(item.real)) continue;
          visitedRealDirs.add(item.real);
        }
        if (kind === "folders") folders.push(item.child);
        nextFolders.push(item.child);
      } else {
        files.push(item.child);
      }
    }

    await Promise.all(nextFolders.map((folder) => visitChildren(folder)));
  };

  await visitChildren(root);
  return { folders, files };
}

async function isNestedVaultViaAdapter(vault: Vault, path: string): Promise<boolean> {
  const stat = vault.adapter?.stat;
  if (typeof stat !== "function") return false;
  for (const configDir of configDirNames(vault)) {
    try {
      const entry = await stat.call(vault.adapter, `${path}/${configDir}`);
      if (entry?.type === "folder") return true;
    } catch {
      // Ignore unreadable adapter paths.
    }
  }
  return false;
}

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
