import { lstat, realpath, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import type { FileSystemAdapter } from "obsidian";

export interface VaultDisk {
  stat(path: string): Promise<Stats | undefined>;
  realpath(path: string): Promise<string | undefined>;
  isNestedVault(path: string): Promise<boolean>;
}

export function createDesktopVaultDisk(
  adapter: FileSystemAdapter,
  configDirs: string[]
): VaultDisk {
  return {
    // Don't follow file links: two vault-relative paths may name the same data.
    stat: (path) => ifExists(() => lstat(adapter.getFullPath(path))),
    realpath: (path) => ifAccessible(() => realpath(adapter.getFullPath(path))),
    async isNestedVault(path) {
      for (const configDir of configDirs) {
        const config = await ifExists(() => stat(adapter.getFullPath(`${path}/${configDir}`)));
        if (config?.isDirectory()) return true;
      }
      return false;
    },
  };
}

async function ifExists<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR" && code !== "ELOOP") throw error;
    return undefined;
  }
}

async function ifAccessible<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      code === "ENOENT" ||
      code === "ENOTDIR" ||
      code === "ELOOP" ||
      code === "EACCES" ||
      code === "EPERM"
    ) {
      return undefined;
    }
    throw error;
  }
}
