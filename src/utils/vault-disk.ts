import { Platform, type FileSystemAdapter } from "obsidian";

export interface VaultDiskStats {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
  nlink: number;
}

export interface VaultDisk {
  stat(path: string): Promise<VaultDiskStats | undefined>;
  realpath(path: string): Promise<string | undefined>;
  isNestedVault(path: string): Promise<boolean>;
}

export async function createDesktopVaultDisk(
  adapter: FileSystemAdapter,
  configDirs: string[]
): Promise<VaultDisk | undefined> {
  if (!Platform.isDesktopApp) return undefined;
  const { lstat, realpath, stat } = await import("node:fs/promises");
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

function getErrnoCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

async function ifExists<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    const code = getErrnoCode(error);
    if (code !== "ENOENT" && code !== "ENOTDIR" && code !== "ELOOP") throw error;
    return undefined;
  }
}

async function ifAccessible<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    const code = getErrnoCode(error);
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
