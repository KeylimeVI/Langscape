/**
 * Launches an isolated Obsidian Electron instance (desktop or Android-mobile emulated),
 * opens a disposable vault with the built Langscape plugin, and returns a live CDP session.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { CdpClient, listTargets, sleep, waitFor } from "./cdp.mjs";
import { ROOT_DIR, resolveJavaBin, resolveLexurgyPath, resolveObsidianBin } from "./env.mjs";

const ANDROID_PIXEL_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

function wrapForMobileSandbox(bundleSource) {
  // Mirror Obsidian Mobile's module loader: expose only `obsidian` (with Android mobile Platform)
  // and `@codemirror/*`, and block Node built-ins / `process` / `Buffer`.
  return `(function (require, process, Buffer) {
${bundleSource}
})(function (name) {
  if (name === "obsidian") {
    const api = require(name);
    return Object.create(api, {
      Platform: {
        value: {
          ...api.Platform,
          isDesktop: false,
          isDesktopApp: false,
          isMobile: true,
          isMobileApp: true,
          isAndroidApp: true,
          isIosApp: false,
          isPhone: true,
          isTablet: false,
        },
      },
    });
  }
  if (name.startsWith("@codemirror/")) return require(name);
  throw new Error("Unavailable module on Obsidian Mobile: " + name);
});`;
}

export async function launchObsidianSession({
  workDir,
  mobile = false,
  headed = false,
  port = mobile ? 9266 : 9265,
  keep = false,
  initialFiles = {},
  enableRealLexurgy = true,
  log = (msg) => console.log(`[visual-e2e] ${msg}`),
}) {
  const obsidianBin = resolveObsidianBin();
  if (!obsidianBin || !existsSync(obsidianBin)) {
    throw new Error(
      `Obsidian binary not found. Place extracted Obsidian under .tools/obsidian/obsidian-<ver>/obsidian or set OBSIDIAN_BIN.`
    );
  }

  const shortTag = mobile ? "m" : "d";
  const shortBase = path.join(ROOT_DIR, ".tools", "ve", shortTag);
  const vaultDir = path.join(shortBase, "v");
  const homeDir = path.join(shortBase, "h");
  // Keep TMPDIR short so Chromium's AF_UNIX SingletonSocket stays well under Linux's 108-byte limit.
  const tmpDir = path.join(shortBase, "t");
  const pluginDir = path.join(vaultDir, ".obsidian", "plugins", "langscape");

  await fs.rm(vaultDir, { recursive: true, force: true });
  await fs.rm(homeDir, { recursive: true, force: true });
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.mkdir(path.join(vaultDir, "Fonts"), { recursive: true });
  await fs.mkdir(path.join(homeDir, "config"), { recursive: true });
  await fs.mkdir(path.join(homeDir, "cache"), { recursive: true });
  await fs.mkdir(path.join(homeDir, "data"), { recursive: true });
  await fs.mkdir(tmpDir, { recursive: true });

  for (const file of ["main.js", "manifest.json", "styles.css"]) {
    const src = path.join(ROOT_DIR, file);
    if (!existsSync(src)) {
      throw new Error(`Missing built plugin file ${file}. Run "npm run build" first.`);
    }
    const dst = path.join(pluginDir, file);
    if (mobile && file === "main.js") {
      const bundle = await fs.readFile(src, "utf8");
      await fs.writeFile(dst, wrapForMobileSandbox(bundle), "utf8");
    } else {
      await fs.copyFile(src, dst);
    }
  }

  // Always include the OFL Noto Sans Gothic fixture font in the test vault.
  await fs.copyFile(
    path.join(ROOT_DIR, "tests/fixtures/fonts/NotoSansGothic-Regular.ttf"),
    path.join(vaultDir, "Fonts/NotoSansGothic-Regular.ttf")
  );
  await fs.writeFile(
    path.join(vaultDir, ".obsidian", "community-plugins.json"),
    JSON.stringify(["langscape"], null, 2) + "\n"
  );

  // Configure real Java + Lexurgy on desktop when available.
  const javaBin = !mobile && enableRealLexurgy ? resolveJavaBin() : null;
  const lexurgyPath = !mobile && enableRealLexurgy ? await resolveLexurgyPath() : null;
  const settings = {};
  if (javaBin) settings.javaPath = javaBin;
  if (lexurgyPath) settings.lexurgyPath = lexurgyPath;
  await fs.writeFile(path.join(pluginDir, "data.json"), JSON.stringify(settings, null, 2) + "\n");

  // Default welcome note + any caller-provided vault files.
  const filesToWrite = {
    "Welcome.md": "# Langscape Visual E2E Vault\n",
    ...initialFiles,
  };
  for (const [relPath, content] of Object.entries(filesToWrite)) {
    const fullPath = path.join(vaultDir, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf8");
  }

  const env = {
    ...process.env,
    HOME: homeDir,
    XDG_CONFIG_HOME: path.join(homeDir, "config"),
    XDG_CACHE_HOME: path.join(homeDir, "cache"),
    XDG_DATA_HOME: path.join(homeDir, "data"),
    TMPDIR: tmpDir,
  };
  if (javaBin) {
    env.PATH = `${path.dirname(javaBin)}:${env.PATH ?? ""}`;
  }
  if (!headed) {
    delete env.DISPLAY;
    delete env.WAYLAND_DISPLAY;
  }

  const args = [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${port}`,
  ];
  if (!headed) {
    args.push("--headless", "--ozone-platform=headless");
  }

  log(`launching Obsidian (${mobile ? "mobile-android-emulated" : "desktop"}, ${headed ? "headed" : "headless"}) on CDP port ${port}`);
  const child = spawn(obsidianBin, args, {
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let logs = "";
  const appendLog = (chunk) => {
    logs += chunk.toString();
    if (logs.length > 30_000) logs = logs.slice(-30_000);
  };
  child.stdout.on("data", appendLog);
  child.stderr.on("data", appendLog);

  const cleanup = async (passed = true) => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        // Already exited.
      }
    }
    await sleep(450);
    if (passed && !keep) {
      await fs.rm(vaultDir, { recursive: true, force: true });
      await fs.rm(homeDir, { recursive: true, force: true });
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  };

  let cdp = null;
  try {
    const starter = await waitFor(
      async () => (await listTargets(port)).find((t) => t.url.includes("starter.html")),
      30_000,
      "Obsidian starter window"
    );
    const starterCdp = await CdpClient.connect(starter.webSocketDebuggerUrl);
    const opened = await starterCdp.eval(
      `String(require('electron').ipcRenderer.sendSync('vault-open', ${JSON.stringify(vaultDir)}, false))`
    );
    starterCdp.close();
    if (opened !== "true") {
      throw new Error(`Obsidian refused to open vault ${vaultDir}: ${opened}`);
    }

    const connectVaultPage = async () => {
      const target = await waitFor(
        async () => (await listTargets(port)).find((t) => t.url.includes("index.html")),
        30_000,
        "Obsidian vault window"
      );
      return CdpClient.connect(target.webSocketDebuggerUrl);
    };

    cdp = await connectVaultPage();

    if (mobile) {
      // Enable Obsidian's native built-in Mobile UI emulation and reload cleanly.
      await cdp.configureViewport({
        width: 412,
        height: 915,
        deviceScaleFactor: 2,
        mobile: true,
        touch: true,
        userAgent: ANDROID_PIXEL_UA,
      });
      const alreadyMobile = await cdp.eval(`localStorage.getItem('EmulateMobile') === '1'`);
      if (!alreadyMobile) {
        log("enabling Obsidian native mobile UI emulation (EmulateMobile=1) and reloading");
        await cdp.eval(`(() => { localStorage.setItem('EmulateMobile', '1'); window.location.reload(); return true; })()`);
        await sleep(1200);
        cdp.close();
        cdp = await waitFor(async () => {
          const client = await connectVaultPage();
          const ready = await client.eval(`document.readyState === 'complete' && Boolean(window.app)`).catch(() => false);
          if (ready) return client;
          client.close();
          return null;
        }, 30_000, "reloaded mobile Obsidian window", 350);
        await cdp.configureViewport({
          width: 412,
          height: 915,
          deviceScaleFactor: 2,
          mobile: true,
          touch: true,
          userAgent: ANDROID_PIXEL_UA,
        });
      }
    } else {
      await cdp.configureViewport({
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
        touch: false,
      });
    }

    // Accept the "Trust author and enable plugins" prompt on fresh profiles.
    for (let attempt = 0; attempt < 35; attempt++) {
      const clicked = await cdp.eval(`(() => {
        const btn = [...document.querySelectorAll('button')].find((el) => /trust author/i.test(el.textContent || ''));
        if (!btn) return false;
        btn.click();
        return true;
      })()`).catch(() => false);
      if (clicked) {
        log("accepted Obsidian trust prompt");
        break;
      }
      const loaded = await cdp.eval(`Boolean(window.app?.plugins?.plugins?.langscape)`).catch(() => false);
      if (loaded) break;
      await sleep(250);
    }

    await waitFor(
      () => cdp.eval(`Boolean(window.app && app.workspace && app.plugins?.plugins?.langscape)`),
      30_000,
      "Langscape plugin initialization"
    );

    // Ensure Obsidian's global activeWindow/activeDocument point to this vault window
    // in headless mode (just as an OS window focus event does on a desktop display).
    await cdp.eval(`(() => {
      window.focus();
      window.dispatchEvent(new Event('focus'));
      if (typeof activeWindow !== 'undefined') activeWindow = window;
      if (typeof activeDocument !== 'undefined') activeDocument = document;
      return { activeWin: window.activeWindow === window, activeDoc: window.activeDocument === document };
    })()`);

    if (mobile) {
      // Ensure Android platform CSS class is present alongside Obsidian's .is-mobile/.is-phone
      await cdp.eval(`(() => {
        document.body.classList.add('is-android');
        return {
          isMobile: document.body.classList.contains('is-mobile'),
          isPhone: document.body.classList.contains('is-phone'),
          isAndroid: document.body.classList.contains('is-android'),
        };
      })()`);
    }

    await cdp.eval(`(async () => {
      await app.plugins.plugins.langscape.refreshFonts();
      return app.plugins.plugins.langscape.fontManager.list().length;
    })()`);

    return {
      cdp,
      vaultDir,
      homeDir,
      javaBin,
      lexurgyPath,
      mobile,
      getLogs: () => logs,
      close: async (passed = true) => {
        cdp?.close();
        await cleanup(passed);
      },
    };
  } catch (error) {
    cdp?.close();
    await cleanup(false);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n--- Obsidian logs ---\n${logs.slice(-2500)}`
    );
  }
}
