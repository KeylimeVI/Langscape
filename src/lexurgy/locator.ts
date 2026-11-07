import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { LaunchSpec } from "./server";

export interface JavaInfo {
  path: string;
  version: string;
}

export type InstallationKind = "managed" | "configured" | "path" | "jar" | "executable";

export interface LexurgyInstallation {
  kind: InstallationKind;
  /** Short label for status UI, e.g. "Managed Lexurgy 1.7.7". */
  label: string;
  /** Directory containing the lib jars, when applicable. */
  home?: string;
  version?: string;
  launch: LaunchSpec;
}

export interface LexurgyEnvironment {
  java?: JavaInfo;
  installation?: LexurgyInstallation;
  /** A user-facing explanation when detection fails. */
  error?: string;
  /** Non-fatal notes, e.g. a configured path was ignored. */
  notes: string[];
}

export interface DetectOptions {
  /** Explicit path from settings (executable, jar, or install directory). */
  configuredPath?: string;
  /** Explicit java executable from settings. */
  javaPath?: string;
  /** Directory managed by Langscape's installer. */
  managedDir?: string;
  /** Extra directories to search for a Lexurgy installation. */
  extraSearchPaths?: string[];
}

const VERSION_FILE = "version.json";

export async function detectLexurgyEnvironment(
  options: DetectOptions = {}
): Promise<LexurgyEnvironment> {
  const notes: string[] = [];
  const java = await detectJava(options.javaPath);
  if (!java) {
    return {
      notes,
      error:
        "Java was not found. Lexurgy needs Java 8 or newer. Install a JRE, " +
        "then set its path in Langscape settings (or add java to PATH).",
    };
  }

  const candidates: Array<{ dir: string; kind: InstallationKind }> = [];
  if (options.managedDir) candidates.push({ dir: options.managedDir, kind: "managed" });
  for (const extra of options.extraSearchPaths ?? []) {
    candidates.push({ dir: extra, kind: "configured" });
  }

  for (const candidate of candidates) {
    const installation = await installationFromDirectory(candidate.dir, candidate.kind, java);
    if (installation) return { java, installation, notes };
  }

  if (options.configuredPath?.trim()) {
    const configured = await installationFromConfiguredPath(
      options.configuredPath.trim(),
      java
    );
    if (configured) return { java, installation: configured, notes };
    notes.push(
      `The configured Lexurgy path was not usable: ${options.configuredPath.trim()}`
    );
  }

  const onPath = await findExecutableOnPath(process.platform === "win32" ? "lexurgy.bat" : "lexurgy");
  if (onPath) {
    return {
      java,
      installation: {
        kind: "path",
        label: `Lexurgy on PATH (${onPath})`,
        launch: { command: onPath, args: ["server"], label: "Lexurgy CLI" },
      },
      notes,
    };
  }

  for (const dir of defaultLexurgyLocations()) {
    const installation = await installationFromDirectory(dir, "configured", java);
    if (installation) return { java, installation, notes };
  }

  return {
    java,
    notes,
    error:
      "Lexurgy was not found. Click \"Install Lexurgy\" to download the official CLI, " +
      "or point Langscape at an existing installation in settings.",
  };
}

export async function detectJava(configuredPath?: string): Promise<JavaInfo | undefined> {
  const candidates: string[] = [];
  if (configuredPath?.trim()) candidates.push(configuredPath.trim());
  if (process.env.JAVA_HOME) {
    candidates.push(path.join(process.env.JAVA_HOME, "bin", javaExecutable()));
  }
  candidates.push(javaExecutable());

  for (const candidate of candidates) {
    const info = await probeJava(candidate);
    if (info) return info;
  }
  return undefined;
}

async function probeJava(command: string): Promise<JavaInfo | undefined> {
  return new Promise((resolve) => {
    execFile(
      command,
      ["-version"],
      { timeout: 8_000, windowsHide: true },
      (error, _stdout, stderr) => {
        if (error) {
          resolve(undefined);
          return;
        }
        const version = (stderr || _stdout || "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.length > 0);
        resolve({ path: command, version: version ?? "Java" });
      }
    );
  });
}

async function installationFromDirectory(
  dir: string,
  kind: InstallationKind,
  java: JavaInfo
): Promise<LexurgyInstallation | undefined> {
  const home = path.resolve(dir);
  const libDir = path.join(home, "lib");
  const jars = await listJars(libDir);
  if (jars.length === 0) return undefined;
  const version = await readManagedVersion(home);
  const label =
    kind === "managed"
      ? `Langscape-managed Lexurgy${version ? ` ${version}` : ""}`
      : `Lexurgy${version ? ` ${version}` : ""} (${home})`;
  return {
    kind,
    label,
    home,
    version,
    launch: classpathLaunch(java.path, libDir, home),
  };
}

async function installationFromConfiguredPath(
  target: string,
  java: JavaInfo
): Promise<LexurgyInstallation | undefined> {
  const resolved = path.resolve(target);
  let stats;
  try {
    stats = await fs.stat(resolved);
  } catch {
    return undefined;
  }

  if (stats.isDirectory()) {
    const asHome = await installationFromDirectory(resolved, "configured", java);
    if (asHome) return asHome;
    // A bin directory next to lib.
    const parent = path.dirname(resolved);
    return installationFromDirectory(parent, "configured", java);
  }

  if (resolved.toLowerCase().endsWith(".jar")) {
    return {
      kind: "jar",
      label: `Lexurgy jar (${resolved})`,
      launch: {
        command: java.path,
        args: ["-Dfile.encoding=UTF-8", "-jar", resolved, "server"],
        label: "Lexurgy jar",
      },
    };
  }

  // Scripts on Windows are usually .bat and need cmd.exe; Node's spawn handles
  // .bat on win32 only with shell:true, so prefer the classpath if we can find it.
  const home = path.dirname(path.dirname(resolved));
  const sibling = await installationFromDirectory(home, "configured", java);
  if (sibling) return sibling;

  return {
    kind: "executable",
    label: `Lexurgy executable (${resolved})`,
    launch: { command: resolved, args: ["server"], label: "Lexurgy CLI" },
  };
}

function classpathLaunch(javaPath: string, libDir: string, cwd: string): LaunchSpec {
  // The JVM expands a trailing "*" in a classpath entry into every jar in that
  // directory. This works cross-platform without constructing a giant path.
  return {
    command: javaPath,
    args: [
      "-Dfile.encoding=UTF-8",
      "-cp",
      path.join(libDir, "*"),
      "com.meamoria.lexurgy.cli.MainKt",
      "server",
    ],
    cwd,
    label: "Lexurgy (managed classpath)",
  };
}

async function listJars(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jar"))
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

async function readManagedVersion(home: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(path.join(home, VERSION_FILE), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

async function findExecutableOnPath(name: string): Promise<string | undefined> {
  const command = process.platform === "win32" ? "where" : "which";
  return new Promise((resolve) => {
    execFile(command, [name], { timeout: 5_000, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(undefined);
        return;
      }
      const first = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      resolve(first);
    });
  });
}

export function defaultLexurgyLocations(): string[] {
  const home = os.homedir();
  const locations = [
    path.join(home, "lexurgy"),
    path.join(home, "lexurgy-1.7.7"),
    path.join(home, "Applications", "lexurgy"),
    "/usr/local/lexurgy",
    "/opt/lexurgy",
  ];
  return [...new Set(locations)];
}

export function javaExecutable(): string {
  return process.platform === "win32" ? "java.exe" : "java";
}
