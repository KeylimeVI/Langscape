import type { Vault } from "obsidian";
import { getVaultDisk, listVaultFiles, listVaultFolders, type VaultDisk } from "../utils/vault";

export type RecipeDisk = VaultDisk;

export function getRecipeDisk(vault: Vault): Promise<RecipeDisk | undefined> {
  return getVaultDisk(vault);
}

export async function listRecipeFolders(vault: Vault): Promise<string[]> {
  const folders = await listVaultFolders(vault);
  return ["/", ...folders.map((folder) => folder.path)];
}

export async function listRecipeSoundChanges(vault: Vault): Promise<string[]> {
  const files = await listVaultFiles(vault, (file) => file.extension.toLowerCase() === "lsc");
  return files.map((file) => file.path);
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
