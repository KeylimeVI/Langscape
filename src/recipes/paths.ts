import { lstat, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { FileSystemAdapter, TFolder, type Vault } from "obsidian";

export interface RecipeDisk {
  stat(path: string): Promise<Stats | undefined>;
  isNestedVault(path: string): Promise<boolean>;
}

export function getRecipeDisk(vault: Vault): RecipeDisk | undefined {
  const { adapter } = vault;
  if (!(adapter instanceof FileSystemAdapter)) return;
  const configDirs = new Set([".obsidian", vault.configDir]);
  return {
    // Don't follow file links: two vault-relative paths may name the same data.
    stat: (path) => ifExists(() => lstat(adapter.getFullPath(path))),
    async isNestedVault(path) {
      for (const configDir of configDirs) {
        const config = await ifExists(() => stat(adapter.getFullPath(`${path}/${configDir}`)));
        if (config?.isDirectory()) return true;
      }
      return false;
    },
  };
}

export async function listRecipeFolders(vault: Vault): Promise<string[]> {
  const disk = getRecipeDisk(vault);
  const root = vault.getRoot();
  const seen = new Set([root.path, "/"]);
  const paths: string[] = [];
  const visitChildren = async (parent: TFolder): Promise<void> => {
    await Promise.all(parent.children.map(async (child) => {
      if (!(child instanceof TFolder) || child.parent !== parent || seen.has(child.path)) return;
      seen.add(child.path);
      // Stop at the boundary, rather than trimming a prefix off all its children.
      if (disk && (!(await disk.stat(child.path))?.isDirectory() || await disk.isNestedVault(child.path))) return;
      paths.push(child.path);
      await visitChildren(child);
    }));
  };
  await visitChildren(root);
  return ["/", ...paths.sort((a, b) => a.localeCompare(b))];
}

export async function assertRecipeFolder(disk: RecipeDisk, path: string): Promise<void> {
  if (path === "/") return;
  let current = "";
  for (const part of path.split("/")) {
    current = current ? `${current}/${part}` : part;
    const entry = await disk.stat(current);
    if (!entry) return; // A new output folder can be created below this path.
    if (entry.isSymbolicLink()) throw new Error(`Folder "${current}" is a link. Choose its original location instead.`);
    if (!entry.isDirectory()) throw new Error(`Folder path "${current}" is occupied by a file.`);
    if (await disk.isNestedVault(current)) throw new Error(`Folder "${current}" belongs to another Obsidian vault.`);
  }
}

async function ifExists<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    return undefined;
  }
}
