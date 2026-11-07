#!/usr/bin/env node
/**
 * Build the plugin, then replace the installed Langscape build in a vault.
 *
 * Runtime state that is not part of the build is preserved:
 *   - data.json
 *   - lexurgy/ (the managed Lexurgy installation)
 *
 * Usage:
 *   npm run install:vault
 *   npm run install:vault -- --vault "/path/to/vault"
 *   npm run install:vault -- --no-build
 *   npm run install:vault -- --no-preserve
 *   npm run install:vault -- --dry-run
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_VAULT = "/home/keylime/Documents/Obsidian Vault";
const args = process.argv.slice(2);

function help() {
  console.log(`Install the newest Langscape build into an Obsidian vault.

Usage:
  npm run install:vault [-- options]

Options:
  --vault <path>       Vault path (default: ${DEFAULT_VAULT})
  --no-build           Use the newest dist zip without rebuilding
  --no-preserve        Do not carry over data.json / lexurgy/
  --dry-run            Show the plan without changing anything
  --help               Show this help`);
}

let vault = process.env.OBSIDIAN_VAULT || DEFAULT_VAULT;
let build = true;
let preserve = true;
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--help" || arg === "-h") {
    help();
    process.exit(0);
  } else if (arg === "--no-build") {
    build = false;
  } else if (arg === "--no-preserve") {
    preserve = false;
  } else if (arg === "--dry-run") {
    dryRun = true;
  } else if (arg === "--vault") {
    const value = args[++i];
    if (!value) throw new Error("--vault requires a path");
    vault = value;
  } else if (arg.startsWith("--vault=")) {
    vault = arg.slice("--vault=".length);
  } else {
    throw new Error(`Unknown option: ${arg}`);
  }
}

vault = path.resolve(vault);
const pluginsDir = path.join(vault, ".obsidian", "plugins");
const destination = path.join(pluginsDir, "langscape");
const communityPluginsPath = path.join(vault, ".obsidian", "community-plugins.json");

if (!fs.existsSync(vault) || !fs.statSync(vault).isDirectory()) {
  fail(`Vault does not exist: ${vault}`);
}
if (!fs.existsSync(pluginsDir) || !fs.statSync(pluginsDir).isDirectory()) {
  fail(`Not an Obsidian vault (missing .obsidian/plugins): ${vault}`);
}

console.log(`Vault: ${vault}`);

if (build) {
  run("npm", ["run", "build"]);
  run("npm", ["run", "package:release"]);
}

const zip = newestBuild();
console.log(`Build: ${path.relative(root, zip)}`);

const files = readZip(zip);
const manifest = JSON.parse(files.get("manifest.json").toString("utf8"));
if (manifest.id !== "langscape") {
  fail(`Unexpected plugin id "${manifest.id}" in ${zip}`);
}
for (const required of ["main.js", "manifest.json", "styles.css"]) {
  if (!files.has(required)) fail(`${zip} is missing ${required}`);
}

const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
const oldDirs = entries
  .filter((entry) => entry.isDirectory() && /^langscape(?:-.+)?$/.test(entry.name))
  .map((entry) => path.join(pluginsDir, entry.name));
const oldZips = entries
  .filter((entry) => entry.isFile() && /^langscape-.+\.zip$/i.test(entry.name))
  .map((entry) => path.join(pluginsDir, entry.name));

const candidates = [...new Set([destination, ...oldDirs])].filter((dir) =>
  fs.existsSync(dir)
);
const runtimeSource = pickRuntimeSource(candidates);

if (dryRun) {
  console.log(`Would install ${path.relative(root, zip)} -> ${destination}`);
  if (preserve && runtimeSource) {
    console.log(`Would preserve data.json / lexurgy/ from ${runtimeSource}`);
  }
  for (const old of [...oldDirs, ...oldZips]) {
    if (old !== destination) console.log(`Would remove ${old}`);
  }
  console.log("Dry run: no files changed.");
  process.exit(0);
}

const staging = fs.mkdtempSync(path.join(pluginsDir, ".langscape-install-"));
try {
  writeFiles(staging, files);

  if (preserve && runtimeSource) {
    for (const name of ["lexurgy", "data.json"]) {
      const source = path.join(runtimeSource, name);
      if (!fs.existsSync(source)) continue;
      fs.cpSync(source, path.join(staging, name), { recursive: true });
      console.log(`Preserved ${name} from ${runtimeSource}`);
    }
  }

  for (const old of [...oldDirs, ...oldZips]) {
    if (old === destination) continue;
    fs.rmSync(old, { recursive: true, force: true });
    console.log(`Removed ${old}`);
  }
  fs.rmSync(destination, { recursive: true, force: true });
  fs.renameSync(staging, destination);

  ensureEnabled(communityPluginsPath);
  console.log(`Installed ${manifest.name} ${manifest.version} -> ${destination}`);
  console.log("Reload Obsidian (or disable/enable the plugin) to load the new build.");
} catch (error) {
  fs.rmSync(staging, { recursive: true, force: true });
  throw error;
}

function newestBuild() {
  const dist = path.join(root, "dist");
  if (!fs.existsSync(dist)) fail("No dist/ directory. Run with a build first.");
  const candidates = fs
    .readdirSync(dist)
    .filter((name) => /^langscape-.+\.zip$/i.test(name))
    .map((name) => {
      const file = path.join(dist, name);
      return { file, mtime: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime || b.file.localeCompare(a.file));
  if (candidates.length === 0) fail("No Langscape build zip found in dist/.");
  return candidates[0].file;
}

function readZip(file) {
  let data;
  try {
    data = unzipSync(new Uint8Array(fs.readFileSync(file)));
  } catch (error) {
    fail(`Could not read ${file}: ${error.message}`);
  }
  const files = new Map();
  for (const [name, bytes] of Object.entries(data)) {
    const clean = name.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!clean || clean.endsWith("/")) continue;
    if (clean.startsWith("/") || clean.split("/").includes("..")) {
      fail(`Unsafe path in ${file}: ${name}`);
    }
    files.set(clean, Buffer.from(bytes));
  }
  return files;
}

function writeFiles(target, files) {
  for (const [name, bytes] of files) {
    const output = path.join(target, ...name.split("/"));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, bytes);
  }
}

function pickRuntimeSource(candidates) {
  for (const dir of candidates) {
    if (
      fs.existsSync(path.join(dir, "lexurgy")) ||
      fs.existsSync(path.join(dir, "data.json"))
    ) {
      return dir;
    }
  }
  return undefined;
}

function ensureEnabled(file) {
  let list = [];
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      console.warn(`Could not parse ${file}; leaving it unchanged.`);
      return;
    }
  }
  if (!list.includes("langscape")) {
    list.push("langscape");
    fs.writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`);
    console.log("Enabled langscape in community-plugins.json");
  }
}

function run(command, commandArgs) {
  const executable = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
  console.log(`> ${command} ${commandArgs.join(" ")}`);
  const result = spawnSync(executable, commandArgs, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail(`${command} ${commandArgs.join(" ")} failed.`);
  return result;
}

function fail(message) {
  console.error(`\nError: ${message}`);
  process.exit(1);
}
