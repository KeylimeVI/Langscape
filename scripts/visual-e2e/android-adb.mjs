#!/usr/bin/env node
/**
 * Real Android Device / Emulator E2E & Screenshot Runner for Langscape.
 *
 * Connects to an Android Emulator (local KVM AVD) or a physical Android phone
 * (USB or Wireless ADB), installs Obsidian APK if needed, pushes a disposable
 * test vault containing the built Langscape plugin, drives Obsidian through
 * UIAutomator + deep links + real touch gestures, and captures real Android
 * framebuffer PNG screenshots + report.json + verify-prompt.md + index.html.
 *
 * Usage:
 *   node scripts/visual-e2e/android-adb.mjs [--check]
 *                                           [--serial <device-id>]
 *                                           [--connect <ip:port>]
 *                                           [--boot-avd <avd-name>]
 *                                           [--install-apk]
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { findUiNode, parseAdbDevices, parseUiHierarchy, stageAndroidTestVault } from "./lib/android-ui.mjs";
import { sleep, waitFor } from "./lib/cdp.mjs";
import {
  ROOT_DIR,
  TOOLS_DIR,
  hasKvm,
  resolveAdbBin,
  resolveEmulatorBin,
  resolveObsidianApk,
} from "./lib/env.mjs";
import { TestRunRecorder } from "./lib/report.mjs";

const OBSIDIAN_PKG = "md.obsidian";
const REMOTE_VAULT_NAME = "LangscapeMobileTest";
const REMOTE_VAULT_DIR = `/sdcard/Documents/${REMOTE_VAULT_NAME}`;

function parseArgs(argv) {
  const opts = {
    check: false,
    serial: process.env.ANDROID_SERIAL ?? null,
    connect: null,
    bootAvd: null,
    installApk: false,
    outDir: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check" || a === "--dry-run") opts.check = true;
    else if (a === "--serial" && argv[i + 1]) opts.serial = argv[++i];
    else if (a === "--connect" && argv[i + 1]) opts.connect = argv[++i];
    else if (a === "--boot-avd" && argv[i + 1]) opts.bootAvd = argv[++i];
    else if (a === "--install-apk") opts.installApk = true;
    else if (a === "--out" && argv[i + 1]) opts.outDir = path.resolve(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/visual-e2e/android-adb.mjs [options]
  --check                  Verify adb, Obsidian APK, vault staging, and connected devices without launching
  --serial <id>            Target a specific adb device/emulator serial
  --connect <host:port>    Connect to a physical Android device over Wireless ADB
  --boot-avd <name>        Boot a local Android Emulator AVD headlessly before testing
  --install-apk            Force (re)installation of cached Obsidian-*.apk
  --out <dir>              Output directory for screenshots and report`);
      process.exit(0);
    }
  }
  return opts;
}

function log(msg) {
  console.log(`[android-e2e] ${msg}`);
}

function adbEnv() {
  const androidHome = path.join(TOOLS_DIR, "android", "home");
  return {
    ...process.env,
    HOME: process.env.ADB_USE_SYSTEM_HOME ? process.env.HOME : androidHome,
    ANDROID_USER_HOME: process.env.ANDROID_USER_HOME ?? androidHome,
  };
}

class AdbDevice {
  constructor(adbBin, serial) {
    this.adbBin = adbBin;
    this.serial = serial;
  }

  run(args, opts = {}) {
    const fullArgs = this.serial ? ["-s", this.serial, ...args] : args;
    return execFileSync(this.adbBin, fullArgs, {
      encoding: opts.buffer ? undefined : "utf8",
      maxBuffer: 32 * 1024 * 1024,
      env: adbEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  shell(cmd) {
    return this.run(["shell", cmd]).trim();
  }

  async screencap(filePath) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const png = this.run(["exec-out", "screencap", "-p"], { buffer: true });
    await fs.writeFile(filePath, png);
    return filePath;
  }

  dumpUi() {
    this.shell("uiautomator dump /sdcard/window_dump.xml >/dev/null 2>&1 || true");
    const xml = this.shell("cat /sdcard/window_dump.xml 2>/dev/null || true");
    return parseUiHierarchy(xml);
  }

  tap(x, y) {
    this.shell(`input tap ${Math.round(x)} ${Math.round(y)}`);
  }

  swipe(x1, y1, x2, y2, durationMs = 300) {
    this.shell(`input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${durationMs}`);
  }

  async tapIfPresent(query) {
    const nodes = this.dumpUi();
    const match = findUiNode(nodes, query);
    if (!match) return false;
    this.tap(match.bounds.cx, match.bounds.cy);
    await sleep(600);
    return true;
  }

  isPackageInstalled(pkg) {
    return this.shell(`pm list packages ${pkg}`).includes(`package:${pkg}`);
  }

  openObsidianUri(uri) {
    const escaped = uri.replace(/'/g, "'\\''");
    this.shell(`am start -a android.intent.action.VIEW -d '${escaped}' ${OBSIDIAN_PKG}`);
  }
}

async function bootEmulator(adbBin, avdName) {
  const emulatorBin = resolveEmulatorBin();
  if (!emulatorBin) {
    throw new Error("Android emulator binary not found. Run: npm run test:visual:setup-android -- --create-avd");
  }
  if (!hasKvm()) {
    throw new Error("Cannot boot x86_64 Android AVD without /dev/kvm.");
  }
  log(`booting AVD "${avdName}" headlessly`);
  const child = spawn(
    emulatorBin,
    ["-avd", avdName, "-no-window", "-no-audio", "-no-boot-anim", "-gpu", "swiftshader_indirect"],
    { detached: true, stdio: "ignore" }
  );
  const serial = await waitFor(
    async () => {
      const out = execFileSync(adbBin, ["devices", "-l"], { encoding: "utf8" });
      const ready = parseAdbDevices(out).find((d) => d.state === "device" && d.serial.startsWith("emulator-"));
      if (!ready) return null;
      const dev = new AdbDevice(adbBin, ready.serial);
      const booted = dev.shell("getprop sys.boot_completed");
      return booted === "1" ? ready.serial : null;
    },
    180_000,
    `AVD ${avdName} boot completion`,
    2000
  );
  return { serial, stop: () => { try { process.kill(-child.pid, "SIGTERM"); } catch {} } };
}

async function dismissOnboardingAndTrust(device) {
  const prompts = [
    { label: "Allow files access", textRegex: /^allow$/i },
    { label: "Continue without sync", textRegex: /continue without sync|not now|skip/i },
    { label: "Use my existing vault", textRegex: /use my existing vault|open folder as vault/i },
    { label: "Trust author", textRegex: /trust author/i },
    { label: "Turn on community plugins", textRegex: /turn on community plugins/i },
  ];
  for (let round = 0; round < 5; round++) {
    let clickedAny = false;
    for (const p of prompts) {
      if (await device.tapIfPresent({ textRegex: p.textRegex })) {
        log(`tapped Android prompt: ${p.label}`);
        clickedAny = true;
      }
    }
    if (!clickedAny) break;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const adbBin = resolveAdbBin();
  if (!adbBin) {
    throw new Error("adb not found. Run: npm run test:visual:setup-android");
  }

  await fs.mkdir(path.join(TOOLS_DIR, "android", "home"), { recursive: true });
  const env = adbEnv();

  if (opts.connect) {
    log(`connecting to wireless Android device ${opts.connect}`);
    execFileSync(adbBin, ["connect", opts.connect], { env, stdio: "inherit" });
  }

  const devicesRaw = execFileSync(adbBin, ["devices", "-l"], { env, encoding: "utf8" });
  const devices = parseAdbDevices(devicesRaw);
  const apkPath = resolveObsidianApk();

  if (opts.check) {
    const stageDir = path.join(TOOLS_DIR, "android", "staged-vault-check");
    const staged = await stageAndroidTestVault(stageDir, ROOT_DIR);
    log(`adb:          ${adbBin}`);
    log(`Obsidian APK: ${apkPath ?? "not downloaded (run setup-android)"}`);
    log(`KVM present:  ${hasKvm() ? "yes" : "no"}`);
    log(`Vault staged: ${path.relative(ROOT_DIR, staged.vaultDir)} (${staged.noteNames.length} notes + NotoSansGothic font)`);
    log(`Devices:      ${devices.length ? devices.map((d) => `${d.serial} (${d.state})`).join(", ") : "none attached"}`);
    return;
  }

  let bootedEmu = null;
  let serial = opts.serial;
  try {
    if (!serial && opts.bootAvd) {
      bootedEmu = await bootEmulator(adbBin, opts.bootAvd);
      serial = bootedEmu.serial;
    }
    if (!serial) {
      const online = devices.find((d) => d.state === "device");
      if (!online) {
        throw new Error(
          "No online Android device or emulator found via adb.\n" +
            "Options:\n" +
            "  1. Connect a physical Android phone via USB debugging or Wireless ADB (--connect <ip>:<port>)\n" +
            "  2. Boot a local AVD on a KVM host (--boot-avd langscape-pixel7)\n" +
            "  3. Run instant Android-emulated tests right now with: npm run test:visual:mobile"
        );
      }
      serial = online.serial;
    }

    const device = new AdbDevice(adbBin, serial);
    const model = device.shell("getprop ro.product.model") || serial;
    const androidRelease = device.shell("getprop ro.build.version.release") || "unknown";
    log(`connected to Android device ${serial} (${model}, Android ${androidRelease})`);

    if (opts.installApk || !device.isPackageInstalled(OBSIDIAN_PKG)) {
      if (!apkPath || !existsSync(apkPath)) {
        throw new Error("Obsidian APK not found locally. Run: npm run test:visual:setup-android");
      }
      log(`installing ${path.basename(apkPath)} on ${serial}`);
      device.run(["install", "-r", apkPath]);
    }

    // Grant external storage access so Obsidian can open the pushed test vault.
    device.shell(`appops set ${OBSIDIAN_PKG} MANAGE_EXTERNAL_STORAGE allow || true`);
    device.shell(`pm grant ${OBSIDIAN_PKG} android.permission.READ_EXTERNAL_STORAGE 2>/dev/null || true`);
    device.shell(`pm grant ${OBSIDIAN_PKG} android.permission.WRITE_EXTERNAL_STORAGE 2>/dev/null || true`);

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const runDir = opts.outDir ?? path.join(TOOLS_DIR, "visual-e2e", `android-${stamp}`);
    const latestLink = path.join(TOOLS_DIR, "visual-e2e", "latest-android");
    const stagedVault = path.join(runDir, "staged-vault");
    await stageAndroidTestVault(stagedVault, ROOT_DIR);

    log(`pushing ${REMOTE_VAULT_NAME} to ${REMOTE_VAULT_DIR}`);
    device.shell(`rm -rf '${REMOTE_VAULT_DIR}' && mkdir -p '${REMOTE_VAULT_DIR}'`);
    device.run(["push", `${stagedVault}/.`, REMOTE_VAULT_DIR]);

    const recorder = new TestRunRecorder({
      runDir,
      rootDir: ROOT_DIR,
      targets: ["android-adb"],
      environment: { serial, model, androidRelease, obsidianApk: apkPath },
    });
    await recorder.init();

    // Launch Obsidian and dismiss any first-run/trust dialogs.
    device.shell(`am force-stop ${OBSIDIAN_PKG}`);
    device.shell(`monkey -p ${OBSIDIAN_PKG} -c android.intent.category.LAUNCHER 1`);
    await sleep(3500);
    await dismissOnboardingAndTrust(device);

    const scenarios = [
      {
        id: "a01-android-fonts",
        title: "Real Android: Custom Noto Sans Gothic vault font",
        file: "01-Fonts",
        criteria: [
          "Real Obsidian for Android renders Gothic glyphs (𐌰𐍆𐌰 𐌴𐌺𐌴 𐍅𐌿𐌻𐍆𐍃) without tofu boxes or raw braces.",
          "Text wraps cleanly on the real Android screen.",
        ],
      },
      {
        id: "a02-android-syntax-tree",
        title: "Real Android: Syntax tree with Gothic leaf node",
        file: "02-Syntax-Tree",
        criteria: [
          "Syntax tree renders on Android with SVG branches and Gothic leaf glyphs.",
          "No clipped root/leaf nodes or broken layout.",
        ],
      },
      {
        id: "a03-android-merged-tables",
        title: "Real Android: Merged Markdown tables",
        file: "03-Merged-Tables",
        criteria: [
          "Merged table cells span columns/rows cleanly with no stray `<` or `^` tokens.",
          "Gothic glyphs render inside the paradigm table.",
        ],
      },
      {
        id: "a04-android-showcase",
        title: "Real Android: Combined fonts, syntax tree, and merged table",
        file: "04-Showcase",
        criteria: [
          "All three mobile-supported features render together cleanly inside Obsidian for Android.",
        ],
      },
    ];

    for (const sc of scenarios) {
      const started = Date.now();
      try {
        device.openObsidianUri(
          `obsidian://open?vault=${encodeURIComponent(REMOTE_VAULT_NAME)}&file=${encodeURIComponent(sc.file)}`
        );
        await sleep(2500);
        await dismissOnboardingAndTrust(device);
        const shotPath = recorder.screenshotPath(`${sc.id}.png`);
        await device.screencap(shotPath);
        await recorder.recordScenario({
          id: sc.id,
          title: sc.title,
          target: "android-adb",
          status: "pass",
          durationMs: Date.now() - started,
          assertions: [`Opened ${sc.file}.md on real Android (${model}) and captured framebuffer screenshot`],
          screenshots: [
            {
              id: sc.id,
              filePath: shotPath,
              caption: `${sc.title} captured on ${model} (Android ${androidRelease})`,
              checkCriteria: sc.criteria,
            },
          ],
        });
        log(`PASS ${sc.id}`);
      } catch (error) {
        await recorder.recordScenario({
          id: sc.id,
          title: sc.title,
          target: "android-adb",
          status: "fail",
          durationMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
          screenshots: [],
        });
        log(`FAIL ${sc.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const { report, reportPath, promptPath, galleryPath } = await recorder.finalize(latestLink);
    log(`Report JSON:   ${path.relative(ROOT_DIR, reportPath)}`);
    log(`Verify prompt: ${path.relative(ROOT_DIR, promptPath)}`);
    log(`HTML gallery:  ${path.relative(ROOT_DIR, galleryPath)}`);
    if (!report.summary.ok) process.exitCode = 1;
  } finally {
    bootedEmu?.stop();
  }
}

main().catch((error) => {
  console.error(`[android-e2e] FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
