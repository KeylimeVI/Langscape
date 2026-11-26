#!/usr/bin/env node
/**
 * Downloads and prepares Android testing prerequisites under .tools/android/:
 *   1. Official Google Android platform-tools (adb)
 *   2. Official Obsidian Android APK from obsidianmd/obsidian-releases (optional/default)
 *   3. Optional Android SDK cmdline-tools + Pixel 7 AVD (--create-avd, requires KVM for x86_64)
 *
 * Usage:
 *   node scripts/visual-e2e/setup-android.mjs [--no-apk] [--create-avd]
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { TOOLS_DIR, hasKvm, resolveAdbBin, resolveJavaBin, resolveObsidianApk } from "./lib/env.mjs";

const PLATFORM_TOOLS_URL = "https://dl.google.com/android/repository/platform-tools-latest-linux.zip";
const CMDLINE_TOOLS_URL = "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip";
const OBSIDIAN_RELEASES_API = "https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest";

function log(msg) {
  console.log(`[setup-android] ${msg}`);
}

async function downloadFile(url, destPath) {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  log(`downloading ${url}`);
  const response = await fetch(url, {
    headers: { "User-Agent": "Langscape-Visual-E2E" },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destPath, buffer);
  return destPath;
}

async function ensurePlatformTools(androidDir) {
  const existing = resolveAdbBin();
  if (existing) {
    log(`adb already available at ${existing}`);
    return existing;
  }
  const zipPath = path.join(androidDir, "platform-tools.zip");
  await downloadFile(PLATFORM_TOOLS_URL, zipPath);
  execFileSync("unzip", ["-oq", zipPath, "-d", androidDir], { stdio: "inherit" });
  await fs.rm(zipPath, { force: true });
  const adbPath = path.join(androidDir, "platform-tools", "adb");
  await fs.chmod(adbPath, 0o755);
  log(`installed adb at ${adbPath}`);
  return adbPath;
}

async function ensureObsidianApk(androidDir) {
  const existing = resolveObsidianApk();
  if (existing) {
    log(`Obsidian APK already cached at ${existing}`);
    return existing;
  }
  const res = await fetch(OBSIDIAN_RELEASES_API, {
    headers: { "User-Agent": "Langscape-Visual-E2E", Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub releases lookup failed: HTTP ${res.status}`);
  const release = await res.json();
  const asset = (release.assets ?? []).find((a) => /\.apk$/i.test(a.name));
  if (!asset) throw new Error("No .apk asset found in latest Obsidian release");
  const apkPath = path.join(androidDir, asset.name);
  await downloadFile(asset.browser_download_url, apkPath);
  log(`downloaded ${asset.name} (${Math.round(asset.size / (1024 * 1024))} MB)`);
  return apkPath;
}

async function createAndroidAvd(androidDir) {
  if (!hasKvm()) {
    console.warn(
      "[setup-android] /dev/kvm is not available on this host.\n" +
        "  • x86_64 Android Emulators require KVM hardware acceleration.\n" +
        "  • On this container, use either:\n" +
        "      1) npm run test:visual:mobile    (instant Android mobile emulation inside real Obsidian)\n" +
        "      2) npm run test:visual:android -- --connect <phone-ip>:<port>   (physical Android device via Wireless ADB)\n" +
        "  • Run --create-avd on a KVM-enabled Linux/macOS/Windows machine to create a local emulator AVD."
    );
    return false;
  }

  const javaBin = resolveJavaBin();
  if (!javaBin) {
    throw new Error("Java 17+ is required to run Android sdkmanager/avdmanager.");
  }

  const sdkRoot = path.join(androidDir, "sdk");
  const cmdlineLatest = path.join(sdkRoot, "cmdline-tools", "latest");
  if (!existsSync(path.join(cmdlineLatest, "bin", "sdkmanager"))) {
    const zipPath = path.join(androidDir, "cmdline-tools.zip");
    await downloadFile(CMDLINE_TOOLS_URL, zipPath);
    const tmpExtract = path.join(androidDir, "cmdline-tmp");
    await fs.rm(tmpExtract, { recursive: true, force: true });
    execFileSync("unzip", ["-oq", zipPath, "-d", tmpExtract], { stdio: "inherit" });
    await fs.mkdir(path.dirname(cmdlineLatest), { recursive: true });
    await fs.rm(cmdlineLatest, { recursive: true, force: true });
    await fs.rename(path.join(tmpExtract, "cmdline-tools"), cmdlineLatest);
    await fs.rm(tmpExtract, { recursive: true, force: true });
    await fs.rm(zipPath, { force: true });
  }

  const env = {
    ...process.env,
    ANDROID_SDK_ROOT: sdkRoot,
    ANDROID_HOME: sdkRoot,
    JAVA_HOME: path.resolve(path.dirname(javaBin), ".."),
  };
  const sdkmanager = path.join(cmdlineLatest, "bin", "sdkmanager");
  const avdmanager = path.join(cmdlineLatest, "bin", "avdmanager");
  const sysImg = "system-images;android-34;google_apis;x86_64";

  log("accepting Android SDK licenses and installing emulator + Android 14 (API 34) image");
  execFileSync("bash", ["-c", `yes | "${sdkmanager}" --sdk_root="${sdkRoot}" --licenses >/dev/null`], { env });
  execFileSync(sdkmanager, [`--sdk_root=${sdkRoot}`, "platform-tools", "emulator", "platforms;android-34", sysImg], {
    env,
    stdio: "inherit",
  });

  log("creating AVD 'langscape-pixel7'");
  execFileSync(
    "bash",
    ["-c", `echo "no" | "${avdmanager}" create avd --force --name langscape-pixel7 --package "${sysImg}" --device pixel_7`],
    { env, stdio: "inherit" }
  );
  log("AVD 'langscape-pixel7' is ready. Run: npm run test:visual:android -- --boot-avd langscape-pixel7");
  return true;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const androidDir = path.join(TOOLS_DIR, "android");
  await fs.mkdir(androidDir, { recursive: true });

  const adbPath = await ensurePlatformTools(androidDir);
  const version = execFileSync(adbPath, ["--version"], { encoding: "utf8" }).split("\n")[0];
  log(`verified ${version}`);

  if (!args.has("--no-apk")) {
    await ensureObsidianApk(androidDir);
  }
  if (args.has("--create-avd")) {
    await createAndroidAvd(androidDir);
  }

  log(`KVM available: ${hasKvm() ? "yes (local Android Emulator supported)" : "no (use Wireless/USB ADB or test:visual:mobile)"}`);
}

main().catch((error) => {
  console.error(`[setup-android] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
