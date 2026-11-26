/**
 * Environment resolution for Obsidian, Java, Lexurgy, and Android tools.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const TOOLS_DIR = path.join(ROOT_DIR, ".tools");

function findFirstBinary(candidates) {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

function whichBinary(name) {
  try {
    const out = execFileSync("which", [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function resolveObsidianBin() {
  if (process.env.OBSIDIAN_BIN && existsSync(process.env.OBSIDIAN_BIN)) {
    return process.env.OBSIDIAN_BIN;
  }
  const obsidianBase = path.join(TOOLS_DIR, "obsidian");
  if (existsSync(obsidianBase)) {
    const dirs = readdirSync(obsidianBase)
      .filter((entry) => entry.startsWith("obsidian-"))
      .sort()
      .reverse();
    for (const dir of dirs) {
      const bin = path.join(obsidianBase, dir, "obsidian");
      if (existsSync(bin)) return bin;
    }
  }
  return whichBinary("obsidian");
}

export function resolveJavaBin() {
  const candidates = [
    process.env.JAVA_BIN,
    process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", "java") : null,
    path.join(TOOLS_DIR, "lexurgy-jre17", "bin", "java"),
    whichBinary("java"),
  ];
  return findFirstBinary(candidates);
}

export async function resolveLexurgyPath() {
  const direct = [
    process.env.OBSIDIAN_TEST_LEXURGY_PATH,
    process.env.LEXURGY_HOME,
  ].filter(Boolean);
  for (const candidate of direct) {
    if (existsSync(candidate)) return path.resolve(candidate);
  }

  const lexurgyBase = path.join(TOOLS_DIR, "lexurgy");
  if (existsSync(lexurgyBase)) {
    const dirs = readdirSync(lexurgyBase)
      .filter((entry) => entry.startsWith("lexurgy-"))
      .sort()
      .reverse();
    for (const dir of dirs) {
      const full = path.join(lexurgyBase, dir);
      if (existsSync(path.join(full, "lib"))) return full;
    }
  }

  // Auto-extract bundled .tools/lexurgy.zip if present.
  const zipPath = path.join(TOOLS_DIR, "lexurgy.zip");
  if (existsSync(zipPath)) {
    await fs.mkdir(lexurgyBase, { recursive: true });
    execFileSync("unzip", ["-oq", zipPath, "-d", lexurgyBase], { stdio: "ignore" });
    const dirs = readdirSync(lexurgyBase)
      .filter((entry) => entry.startsWith("lexurgy-"))
      .sort()
      .reverse();
    for (const dir of dirs) {
      const full = path.join(lexurgyBase, dir);
      if (existsSync(path.join(full, "lib"))) return full;
    }
  }
  return null;
}

export function resolveAdbBin() {
  return findFirstBinary([
    process.env.ADB_BIN,
    path.join(TOOLS_DIR, "android", "platform-tools", "adb"),
    process.env.ANDROID_SDK_ROOT ? path.join(process.env.ANDROID_SDK_ROOT, "platform-tools", "adb") : null,
    process.env.ANDROID_HOME ? path.join(process.env.ANDROID_HOME, "platform-tools", "adb") : null,
    whichBinary("adb"),
  ]);
}

export function resolveEmulatorBin() {
  return findFirstBinary([
    process.env.ANDROID_EMULATOR_BIN,
    path.join(TOOLS_DIR, "android", "sdk", "emulator", "emulator"),
    process.env.ANDROID_SDK_ROOT ? path.join(process.env.ANDROID_SDK_ROOT, "emulator", "emulator") : null,
    process.env.ANDROID_HOME ? path.join(process.env.ANDROID_HOME, "emulator", "emulator") : null,
    whichBinary("emulator"),
  ]);
}

export function resolveObsidianApk() {
  if (process.env.OBSIDIAN_APK && existsSync(process.env.OBSIDIAN_APK)) {
    return process.env.OBSIDIAN_APK;
  }
  const androidDir = path.join(TOOLS_DIR, "android");
  if (existsSync(androidDir)) {
    const apks = readdirSync(androidDir)
      .filter((file) => /^Obsidian-.*\.apk$/i.test(file))
      .sort()
      .reverse();
    if (apks.length > 0) return path.join(androidDir, apks[0]);
  }
  return null;
}

export function hasKvm() {
  return existsSync("/dev/kvm");
}
