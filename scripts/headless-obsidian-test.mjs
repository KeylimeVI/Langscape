#!/usr/bin/env node
/**
 * Focused Obsidian smoke test that runs without Xvfb or any system writes.
 *
 * The test launches the extracted Obsidian build in headless mode with a
 * disposable vault and profile under .tools/, drives it through the Chrome
 * DevTools Protocol, and checks the table/font/clipboard features.
 *
 * Usage:
 *   npm run test:obsidian
 *   node scripts/headless-obsidian-test.mjs --keep
 *
 * Requires the Obsidian Linux build at
 *   .tools/obsidian/obsidian-1.15.0/obsidian
 * or OBSIDIAN_BIN pointing at an obsidian executable.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tools = path.join(root, ".tools", "headless-obsidian");
const vault = path.join(tools, "vault");
const home = path.join(tools, "home");
const screenshot = path.join(tools, "last-run.png");
const port = Number(process.env.OBSIDIAN_CDP_PORT ?? 9245);
const keep = process.argv.includes("--keep");
const obsidianBin =
  process.env.OBSIDIAN_BIN ??
  path.join(root, ".tools", "obsidian", "obsidian-1.15.0", "obsidian");
const note = "Headless.md";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(message) {
  console.log(`[obsidian-test] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

async function ensure(condition, message) {
  if (!condition) fail(message);
}

async function waitFor(fn, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      // Page may be navigating to the vault.
    }
    await sleep(250);
  }
  fail(`Timed out waiting for ${label}`);
}

async function targets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) fail(`CDP returned HTTP ${response.status}`);
  return response.json();
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    };
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error(`Could not connect to ${url}`));
    });
    const cdp = new Cdp(ws);
    await cdp.send("Runtime.enable");
    return cdp;
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          "Evaluation failed"
      );
    }
    return result.result.value;
  }

  close() {
    this.ws.close();
  }
}

async function prepareVault() {
  await fs.rm(vault, { recursive: true, force: true });
  await fs.rm(home, { recursive: true, force: true });
  await fs.mkdir(path.join(vault, ".obsidian/plugins/langscape"), { recursive: true });
  await fs.mkdir(path.join(vault, "Fonts"), { recursive: true });
  await fs.mkdir(path.join(home, "config"), { recursive: true });
  await fs.mkdir(path.join(home, "cache"), { recursive: true });
  await fs.mkdir(path.join(home, "data"), { recursive: true });
  await fs.mkdir(path.join(tools, "tmp"), { recursive: true });

  for (const file of ["main.js", "manifest.json", "styles.css"]) {
    const source = path.join(root, file);
    await ensure(existsSync(source), `${file} is missing; run npm run build first.`);
    await fs.copyFile(source, path.join(vault, ".obsidian/plugins/langscape", file));
  }
  await fs.copyFile(
    path.join(root, "tests/fixtures/fonts/NotoSansGothic-Regular.ttf"),
    path.join(vault, "Fonts/NotoSansGothic-Regular.ttf")
  );
  await fs.writeFile(path.join(vault, ".obsidian/community-plugins.json"), '["langscape"]\n');
  await fs.writeFile(path.join(vault, ".obsidian/plugins/langscape/data.json"), "{}\n");

  await fs.writeFile(
    path.join(vault, note),
    [
      "# Headless test",
      "",
      "Font: {Noto-Sans-Gothic: 𐌰𐍆𐌰}",
      "",
      "| Region | Q1 | < | Q2 | < |",
      "| --- | --- | --- | --- | --- |",
      "| North | 10 | 12 | 14 | 16 |",
      "| South | 8 | 9 | 11 | 13 |",
      "| ^ | 22 | 28 | 30 | 34 |",
      "",
      "| A | B | C |",
      "| --- | --- | --- |",
      "| v | x | y |",
      "| ^ | h | < |",
      "",
      "| Script | Glyph |",
      "| --- | --- |",
      "| Gothic | {Noto-Sans-Gothic: 𐌰𐍆𐌰} |",
      "",
    ].join("\n")
  );
}

function launchObsidian() {
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_CACHE_HOME: path.join(home, "cache"),
    XDG_DATA_HOME: path.join(home, "data"),
    TMPDIR: path.join(tools, "tmp"),
  };
  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;

  const child = spawn(
    obsidianBin,
    [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--headless",
      "--ozone-platform=headless",
      `--remote-debugging-port=${port}`,
    ],
    { env, detached: true, stdio: ["ignore", "pipe", "pipe"] }
  );
  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk.toString();
    if (logs.length > 20000) logs = logs.slice(-20000);
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk.toString();
    if (logs.length > 20000) logs = logs.slice(-20000);
  });
  child.logs = () => logs;
  return child;
}

async function openVault() {
  const starter = await waitFor(async () => {
    const pages = await targets();
    return pages.find((page) => page.url.includes("starter.html"));
  }, 30_000, "Obsidian starter window");

  const starterCdp = await Cdp.connect(starter.webSocketDebuggerUrl);
  const opened = await starterCdp.eval(
    `String(require('electron').ipcRenderer.sendSync('vault-open', ${JSON.stringify(vault)}, false))`
  );
  starterCdp.close();
  await ensure(opened === "true", `Obsidian could not open the test vault: ${opened}`);

  const page = await waitFor(async () => {
    const pages = await targets();
    return pages.find((target) => target.url.includes("index.html"));
  }, 30_000, "Obsidian vault window");

  const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1600,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await cdp.send("Page.bringToFront").catch(() => {});

  // Fresh profiles show a trust prompt before community plugins load.
  for (let attempt = 0; attempt < 40; attempt++) {
    const clicked = await cdp.eval(
      `(() => {
        const button = [...document.querySelectorAll('button')].find((el) =>
          /trust author/i.test(el.textContent || '')
        );
        if (!button) return false;
        button.click();
        return true;
      })()`
    );
    if (clicked) {
      log("accepted Obsidian's trust prompt");
      break;
    }
    await sleep(250);
  }

  await waitFor(
    () => cdp.eval("Boolean(window.app && app.workspace && app.plugins)"),
    30_000,
    "Obsidian app"
  );
  await waitFor(
    () => cdp.eval("Boolean(window.app?.plugins?.plugins?.langscape)"),
    30_000,
    "Langscape plugin"
  );

  await cdp.eval(`(async () => {
    await app.plugins.plugins.langscape.refreshFonts();
    return app.plugins.plugins.langscape.fontManager.list().length;
  })()`);

  await cdp.eval(`(async () => {
    const leaf = app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: 'markdown',
      state: { file: ${JSON.stringify(note)}, mode: 'source' },
      active: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return true;
  })()`);

  await waitFor(
    () => cdp.eval("document.querySelectorAll('.cm-table-widget table').length >= 3"),
    20_000,
    "table widgets"
  );

  return cdp;
}

async function testMergedTable(cdp) {
  const result = await cdp.eval(`(() => {
    const table = document.querySelectorAll('.cm-table-widget table')[0];
    const q1 = table.rows[0].cells[1];
    const south = table.rows[2].cells[0];
    return {
      q1ColSpan: q1.colSpan,
      southRowSpan: south.rowSpan,
      merged: table.classList.contains('langscape-merged-table'),
      covered: table.querySelectorAll('.langscape-table-covered').length,
    };
  })()`);
  await ensure(result.merged, "Merged table was not marked as merged.");
  await ensure(result.q1ColSpan === 2, "Header colspan was not applied.");
  await ensure(result.southRowSpan === 2, "Body rowspan was not applied.");
  await ensure(result.covered > 0, "Covered cells were not hidden.");
  log("merged table renders correctly");
}

async function clickCell(cdp, tableIndex, row, column) {
  const center = await cdp.eval(`(() => {
    const table = document.querySelectorAll('.cm-table-widget table')[${tableIndex}];
    const rect = table.rows[${row}].cells[${column}].getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: center.x,
    y: center.y,
    button: "none",
    buttons: 0,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: center.x,
    y: center.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: center.x,
    y: center.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  return center;
}

async function testFontCellAndClipboard(cdp) {
  // Font table is the third table in the note.
  await clickCell(cdp, 2, 1, 1);
  await sleep(700);

  const active = await cdp.eval(`(() => {
    const table = document.querySelectorAll('.cm-table-widget table')[2];
    const cell = table.rows[1].cells[1];
    const editor = cell.querySelector('.cm-editor');
    return {
      active: Boolean(editor),
      text: editor ? editor.textContent.trim() : cell.textContent.trim(),
      spans: editor ? editor.querySelectorAll('.langscape-font').length : 0,
    };
  })()`);
  await ensure(active.active, "The font cell editor did not open.");
  await ensure(active.text === "𐌰𐍆𐌰", `The active cell shows ${JSON.stringify(active.text)}.`);
  await ensure(active.spans > 0, "The active cell is missing its rendered font span.");
  log("active font cell renders its font");

  await cdp.eval(`(() => {
    const table = document.querySelectorAll('.cm-table-widget table')[2];
    const span = table.querySelector('.cm-editor .langscape-font');
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  })()`);
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "c",
    code: "KeyC",
    modifiers: 2,
    windowsVirtualKeyCode: 67,
    nativeVirtualKeyCode: 67,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "c",
    code: "KeyC",
    modifiers: 2,
    windowsVirtualKeyCode: 67,
    nativeVirtualKeyCode: 67,
  });
  await sleep(300);
  const clipboard = await cdp.eval("require('electron').clipboard.readText()");
  await ensure(
    clipboard.includes("{Noto-Sans-Gothic:") && clipboard.includes("𐌰𐍆𐌰"),
    `Clipboard did not contain font markup: ${JSON.stringify(clipboard)}`
  );
  log("copy places font markup on the clipboard");
}

async function testRectangularSelection(cdp) {
  // The second table has adjacent vertical and horizontal merged groups.
  const start = await cdp.eval(`(() => {
    const table = document.querySelectorAll('.cm-table-widget table')[1];
    const rect = table.rows[1].cells[0].getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  const end = await cdp.eval(`(() => {
    const table = document.querySelectorAll('.cm-table-widget table')[1];
    const rect = table.rows[2].cells[1].getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: start.x,
    y: start.y,
    button: "none",
    buttons: 0,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: start.x,
    y: start.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: end.x,
    y: end.y,
    button: "left",
    buttons: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: end.x,
    y: end.y,
    button: "left",
    buttons: 0,
  });
  await sleep(300);

  const selected = await cdp.eval(`(() => {
    const table = document.querySelectorAll('.cm-table-widget table')[1];
    return [...table.querySelectorAll('th,td')]
      .filter((cell) => cell.classList.contains('langscape-table-selected'))
      .map((cell) => cell.dataset.langscapeR + ':' + cell.dataset.langscapeC);
  })()`);
  const expected = ["1:0", "1:1", "1:2", "2:0", "2:1", "2:2"];
  await ensure(
    expected.every((key) => selected.includes(key)),
    `Selection was not a full rectangle: ${JSON.stringify(selected)}`
  );
  log("selection expands to a full rectangle");
}

async function main() {
  await ensure(existsSync(obsidianBin), `Obsidian binary not found: ${obsidianBin}`);
  await prepareVault();
  log("launching headless Obsidian");
  const child = launchObsidian();
  let cdp = null;
  let passed = false;
  try {
    cdp = await openVault();
    await testMergedTable(cdp);
    await testFontCellAndClipboard(cdp);
    await testRectangularSelection(cdp);

    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(screenshot, Buffer.from(shot.data, "base64"));
    log(`screenshot: ${path.relative(root, screenshot)}`);
    passed = true;
    log("all checks passed");
  } catch (error) {
    console.error(`[obsidian-test] FAILED: ${error.message}`);
    if (child.logs()) console.error(child.logs().slice(-4000));
    process.exitCode = 1;
  } finally {
    cdp?.close();
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill();
    }
    await sleep(500);
    // Keep a failed vault/profile for debugging.
    if (passed && !keep) {
      await fs.rm(vault, { recursive: true, force: true });
      await fs.rm(home, { recursive: true, force: true });
    }
    if (!passed) log(`kept test vault at ${path.relative(root, vault)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
