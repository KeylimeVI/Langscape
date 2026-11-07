import { promises as fs } from "node:fs";
import * as path from "node:path";
import { unzipSync } from "fflate";

export interface LexurgyArchive {
  version?: string;
  libDir: string;
  jarCount: number;
  files: string[];
}

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

/**
 * Extract the official Lexurgy CLI distribution zip into `destDir`.
 *
 * Only the `lib/*.jar` payload (plus a couple of small metadata files) is
 * written; arbitrary paths in the archive are ignored. The archive is staged
 * in a sibling directory and swapped in so a failed install cannot leave a
 * half-extracted installation behind.
 */
export async function extractLexurgyArchive(
  data: Uint8Array,
  destDir: string
): Promise<LexurgyArchive> {
  if (data.byteLength === 0) throw new Error("The Lexurgy archive is empty.");
  if (data.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error("The Lexurgy archive is unexpectedly large; refusing to extract it.");
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch (error) {
    throw new Error(
      `Could not unzip the Lexurgy distribution: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const names = Object.keys(entries);
  const prefix = findArchivePrefix(names);
  const jars = names.filter((name) => {
    const relative = stripPrefix(name, prefix);
    return /^lib\/[^/]+\.jar$/i.test(relative);
  });
  if (jars.length === 0) {
    throw new Error("The archive does not contain Lexurgy's lib/*.jar files.");
  }
  if (!jars.some((name) => /(^|\/)core-[^/]*\.jar$/i.test(name))) {
    throw new Error("The archive is missing Lexurgy's core jar.");
  }
  if (!jars.some((name) => /(^|\/)cli-[^/]*\.jar$/i.test(name))) {
    throw new Error("The archive is missing Lexurgy's CLI jar.");
  }

  const version =
    /lexurgy[_-]?(\d+\.\d+\.\d+)/i.exec(prefix || names[0] || "")?.[1] ??
    undefined;

  const parent = path.dirname(destDir);
  await fs.mkdir(parent, { recursive: true });
  const staging = path.join(
    parent,
    `.${path.basename(destDir)}.installing-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`
  );
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });

  const written: string[] = [];
  try {
    for (const name of jars) {
      const relative = stripPrefix(name, prefix);
      const target = path.join(staging, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, entries[name]);
      written.push(relative);
    }

    for (const name of names) {
      const relative = stripPrefix(name, prefix);
      if (!/^(LICENSE|LICENSE\.txt|NOTICE|README\.md)$/i.test(relative)) continue;
      const target = path.join(staging, relative);
      await fs.writeFile(target, entries[name]);
      written.push(relative);
    }

    await fs.writeFile(
      path.join(staging, "version.json"),
      JSON.stringify(
        {
          version: version ?? "unknown",
          installedAt: new Date().toISOString(),
          source: "https://github.com/def-gthill/lexurgy/releases",
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    written.push("version.json");

    await swapDirectory(staging, destDir);
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  return {
    version,
    libDir: path.join(destDir, "lib"),
    jarCount: jars.length,
    files: written.sort(),
  };
}

function findArchivePrefix(names: string[]): string {
  const first = names.find((name) => name.includes("/"));
  if (!first) return "";
  const prefix = first.slice(0, first.indexOf("/") + 1);
  if (names.every((name) => name === prefix.slice(0, -1) || name.startsWith(prefix))) {
    return prefix;
  }
  return "";
}

function stripPrefix(name: string, prefix: string): string {
  return prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

async function swapDirectory(staging: string, destDir: string): Promise<void> {
  const backup = `${destDir}.old-${Date.now()}`;
  const hadExisting = await pathExists(destDir);
  if (hadExisting) {
    await fs.rm(backup, { recursive: true, force: true });
    await fs.rename(destDir, backup);
  }
  try {
    await fs.rename(staging, destDir);
  } catch (error) {
    if (hadExisting) {
      await fs.rename(backup, destDir).catch(() => undefined);
    }
    throw error;
  }
  if (hadExisting) {
    await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
