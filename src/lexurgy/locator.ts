import { Platform } from "obsidian";
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
  /** Optional legacy install directory retained for existing users. */
  managedDir?: string;
  /** Extra directories to search for a Lexurgy installation. */
  extraSearchPaths?: string[];
}

interface LocatorNodeModules {
  execFile: typeof import("node:child_process").execFile;
  fs: typeof import("node:fs").promises;
  os: typeof import("node:os");
  path: typeof import("node:path");
}

let locatorModulesPromise: Promise<LocatorNodeModules | undefined> | undefined;

async function loadLocatorNodeModules(): Promise<LocatorNodeModules | undefined> {
  if (!Platform.isDesktopApp) return undefined;
  if (!locatorModulesPromise) {
    locatorModulesPromise = (async () => {
      if (!Platform.isDesktopApp) return undefined;
      const [childProcess, fsMod, osMod, pathMod] = await Promise.all([
        import("node:child_process"),
        import("node:fs"),
        import("node:os"),
        import("node:path"),
      ]);
      return {
        execFile: childProcess.execFile,
        fs: fsMod.promises,
        os: osMod,
        path: pathMod,
      };
    })();
  }
  return locatorModulesPromise;
}

const VERSION_FILE = "version.json";

export async function detectLexurgyEnvironment(
  options: DetectOptions = {}
): Promise<LexurgyEnvironment> {
  const notes: string[] = [];
  const mods = await loadLocatorNodeModules();
  if (!mods) {
    return {
      notes,
      error: "Lexurgy is only available on desktop.",
    };
  }
  const java = await detectJava(options.javaPath);
  if (!java) {
    return {
      notes,
      error:
        "Java was not found. Lexurgy recommends Java 17 or newer. Install a JRE, " +
        "then set its path in Langscape settings (or add java to PATH).",
    };
  }

  // A user can switch to a newer, manually installed copy even if a legacy copy remains.
  const configuredPath = options.configuredPath?.trim();
  if (configuredPath) {
    const configured = await installationFromConfiguredPath(mods, configuredPath, java);
    if (configured) return { java, installation: configured, notes };
    notes.push(`The configured Lexurgy path was not usable: ${configuredPath}`);
  }

  if (options.managedDir) {
    const legacy = await installationFromDirectory(mods, options.managedDir, "managed", java);
    if (legacy) return { java, installation: legacy, notes };
  }
  for (const dir of options.extraSearchPaths ?? []) {
    const installation = await installationFromDirectory(mods, dir, "configured", java);
    if (installation) return { java, installation, notes };
  }

  const onPath = await findExecutableOnPath(
    mods,
    process.platform === "win32" ? "lexurgy.bat" : "lexurgy"
  );
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

  for (const dir of defaultLexurgyLocations(mods)) {
    const installation = await installationFromDirectory(mods, dir, "configured", java);
    if (installation) return { java, installation, notes };
  }

  return {
    java,
    notes,
    error:
      "Lexurgy was not found. Download and extract the official CLI separately, " +
      "or point Langscape at an existing installation in settings.",
  };
}

export async function detectJava(configuredPath?: string): Promise<JavaInfo | undefined> {
  const mods = await loadLocatorNodeModules();
  if (!mods) return undefined;
  const candidates: string[] = [];
  if (configuredPath?.trim()) candidates.push(configuredPath.trim());
  if (process.env.JAVA_HOME) {
    candidates.push(mods.path.join(process.env.JAVA_HOME, "bin", javaExecutable()));
  }
  candidates.push(javaExecutable());

  for (const candidate of candidates) {
    const info = await probeJava(mods, candidate);
    if (info) return info;
  }
  return undefined;
}

async function probeJava(
  mods: LocatorNodeModules,
  command: string
): Promise<JavaInfo | undefined> {
  return new Promise((resolve) => {
    mods.execFile(
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
  mods: LocatorNodeModules,
  dir: string,
  kind: InstallationKind,
  java: JavaInfo
): Promise<LexurgyInstallation | undefined> {
  const home = mods.path.resolve(dir);
  const libDir = mods.path.join(home, "lib");
  const jars = await listJars(mods, libDir);
  if (jars.length === 0) return undefined;
  const version = await readManagedVersion(mods, home);
  const label =
    kind === "managed"
      ? `Existing Lexurgy${version ? ` ${version}` : ""}`
      : `Lexurgy${version ? ` ${version}` : ""} (${home})`;
  return {
    kind,
    label,
    home,
    version,
    launch: classpathLaunch(mods, java.path, libDir, home),
  };
}

async function installationFromConfiguredPath(
  mods: LocatorNodeModules,
  target: string,
  java: JavaInfo
): Promise<LexurgyInstallation | undefined> {
  const resolved = mods.path.resolve(target);
  const stats = await mods.fs.stat(resolved).catch(() => undefined);
  if (!stats) return undefined;

  if (stats.isDirectory()) {
    const asHome = await installationFromDirectory(mods, resolved, "configured", java);
    if (asHome) return asHome;
    // A bin directory next to lib.
    const parent = mods.path.dirname(resolved);
    return installationFromDirectory(mods, parent, "configured", java);
  }

  if (resolved.toLowerCase().endsWith(".jar")) {
    return {
      kind: "jar",
      label: `Lexurgy jar (${resolved})`,
      launch: {
        command: java.path,
        args: ["-jar", resolved, "server"],
        label: "Lexurgy jar",
      },
    };
  }

  // Scripts on Windows are usually .bat and need cmd.exe; Node's spawn handles
  // .bat on win32 only with shell:true, so prefer the classpath if we can find it.
  const home = mods.path.dirname(mods.path.dirname(resolved));
  const sibling = await installationFromDirectory(mods, home, "configured", java);
  if (sibling) return sibling;

  return {
    kind: "executable",
    label: `Lexurgy executable (${resolved})`,
    launch: { command: resolved, args: ["server"], label: "Lexurgy CLI" },
  };
}

function classpathLaunch(
  mods: LocatorNodeModules,
  javaPath: string,
  libDir: string,
  cwd: string
): LaunchSpec {
  // The JVM expands a trailing "*" in a classpath entry into every jar in that
  // directory. This works cross-platform without constructing a giant path.
  return {
    command: javaPath,
    args: [
      "-cp",
      mods.path.join(libDir, "*"),
      "com.meamoria.lexurgy.cli.MainKt",
      "server",
    ],
    cwd,
    label: "Lexurgy (managed classpath)",
  };
}

async function listJars(mods: LocatorNodeModules, dir: string): Promise<string[]> {
  try {
    const entries = await mods.fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jar"))
      .map((entry) => mods.path.join(dir, entry.name));
  } catch {
    return [];
  }
}

async function readManagedVersion(
  mods: LocatorNodeModules,
  home: string
): Promise<string | undefined> {
  try {
    const raw = await mods.fs.readFile(mods.path.join(home, VERSION_FILE), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
      return typeof parsed.version === "string" ? parsed.version : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function findExecutableOnPath(
  mods: LocatorNodeModules,
  name: string
): Promise<string | undefined> {
  const command = process.platform === "win32" ? "where" : "which";
  return new Promise((resolve) => {
    mods.execFile(command, [name], { timeout: 5_000, windowsHide: true }, (error, stdout) => {
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

function defaultLexurgyLocations(mods: LocatorNodeModules): string[] {
  const home = mods.os.homedir();
  const locations = [
    mods.path.join(home, "lexurgy"),
    mods.path.join(home, "lexurgy-1.7.7"),
    mods.path.join(home, "Applications", "lexurgy"),
    "/usr/local/lexurgy",
    "/opt/lexurgy",
  ];
  return [...new Set(locations)];
}

export function javaExecutable(): string {
  return process.platform === "win32" ? "java.exe" : "java";
}
