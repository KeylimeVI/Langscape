#!/usr/bin/env node
/**
 * Focused Obsidian smoke test that runs without Xvfb or any system writes.
 *
 * The test launches the extracted Obsidian build in headless mode with a
 * disposable vault and profile under .tools/, drives it through the Chrome
 * DevTools Protocol, and checks tables, fonts, tree editing, the Lexurgy UI,
 * and recipe execution.
 *
 * Usage:
 *   npm run test:obsidian
 *   npm run test:obsidian -- --live-docs  # also check the official manual over HTTPS
 *   npm run test:obsidian -- --capture-recipe  # save a cropped recipe card screenshot
 *   node scripts/headless-obsidian-test.mjs --keep
 *
 * Requires the Obsidian Linux build at
 *   .tools/obsidian/obsidian-1.15.0/obsidian
 * or OBSIDIAN_BIN pointing at an obsidian executable.
 * Set OBSIDIAN_TEST_LEXURGY_PATH to an installed Lexurgy directory (with Java
 * on PATH) to run the recipe against the JVM instead of the test double.
 */
import assert from "node:assert/strict";
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
const testLexurgyPath = process.env.OBSIDIAN_TEST_LEXURGY_PATH;
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
  const settings = testLexurgyPath ? { lexurgyPath: path.resolve(testLexurgyPath) } : {};
  await fs.writeFile(path.join(vault, ".obsidian/plugins/langscape/data.json"), JSON.stringify(settings));

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
      "| ^ | 8 | 9 | 11 | 13 |",
      "| South | 22 | 28 | 30 | 34 |",
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
    const north = table.rows[1].cells[0];
    return {
      q1ColSpan: q1.colSpan,
      northRowSpan: north.rowSpan,
      merged: table.classList.contains('langscape-merged-table'),
      covered: table.querySelectorAll('.langscape-table-covered').length,
    };
  })()`);
  await ensure(result.merged, "Merged table was not marked as merged.");
  await ensure(result.q1ColSpan === 2, "Header colspan was not applied.");
  await ensure(result.northRowSpan === 2, "Body rowspan was not applied.");
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
  const loaded = await cdp.eval(`(async () => {
    const span = document.querySelectorAll('.cm-table-widget table')[2].querySelector('.cm-editor .langscape-font');
    const family = getComputedStyle(span).fontFamily;
    const faces = await document.fonts.load('16px ' + family, span.textContent);
    return { family, loadedFace: faces.some(face => face.family.includes('Noto Sans Gothic') && face.status === 'loaded'), registered: [...document.fonts].map(face => ({ family: face.family, status: face.status })), hasInjectedStyle: !!document.getElementById('langscape-font-faces') };
  })()`);
  assert.match(loaded.family, /Noto Sans Gothic/);
  assert.equal(loaded.loadedFace, true, `The vault font did not load through FontFace: ${JSON.stringify(loaded)}`);
  assert.equal(loaded.hasInjectedStyle, false);
  log("active font cell uses the actual vault font without injecting a stylesheet");

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

async function testSyntaxTreeDrag(cdp) {
  const original = "{tree: S(NP(N(cat), Adj(small)), VP(V(see)), P)}";
  await cdp.eval(`(async () => {
    const file = await app.vault.create('Drag tree.md', ${JSON.stringify(original)});
    await app.workspace.getLeaf('tab').openFile(file, { active: true });
  })()`);
  const tree = "app.workspace.getMostRecentLeaf().view.contentEl.querySelector('.langscape-tree-widget')";
  const current = () => cdp.eval("app.workspace.getMostRecentLeaf().view.editor.getValue()");
  await waitFor(() => cdp.eval(`Boolean(${tree})`), 10_000, "the syntax tree widget");

  const center = (text, side) => cdp.eval(`(() => {
    const tree = ${tree};
    if (!tree) return null;
    const label = [...tree.querySelectorAll('.langscape-tree-label')]
      .find((label) => label.textContent === ${JSON.stringify(text)});
    const target = ${JSON.stringify(side ?? null)}
      ? label?.parentElement.querySelector('.langscape-tree-drop-side.is-' + ${JSON.stringify(side ?? null)})
      : label;
    const rect = target?.getBoundingClientRect();
    return rect?.width && rect.height ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  })()`);
  const mouse = (type, point) => cdp.send("Input.dispatchMouseEvent", {
    type, ...point, button: "left", buttons: type === "mouseReleased" ? 0 : 1,
    clickCount: 1,
  });
  const drag = async (source, target, side, expected) => {
    const start = await waitFor(() => center(source), 10_000, `the label ${source}`);
    const targetBeforeDrag = await center(target);
    await mouse("mousePressed", start);
    await mouse("mouseMoved", { x: start.x + 8, y: start.y });
    const point = await waitFor(() => center(target, side), 5_000, `the drop mark for ${target}`);
    await mouse("mouseMoved", point);
    const targetHit = await cdp.eval(`(() => {
      const active = (${tree}).querySelector('.is-tree-drop-active');
      return active && active.parentElement.querySelector('.langscape-tree-label').textContent === ${JSON.stringify(target)}
        && (${JSON.stringify(side ?? null)} ? active.classList.contains('is-' + ${JSON.stringify(side ?? null)})
          : active.classList.contains('langscape-tree-label'));
    })()`);
    await ensure(targetHit, `The real pointer did not highlight the intended ${target} drop target.`);
    const during = await center(target);
    await ensure(during.x === targetBeforeDrag.x && during.y === targetBeforeDrag.y, "The layout moved during the drag.");
    await mouse("mouseReleased", point);
    await waitFor(async () => (await current()) === expected, 5_000, `Markdown after moving ${source}`);
  };

  await drag("NP", "VP", "after", "{tree: S(VP(V(see)), NP(N(cat), Adj(small)), P)}");
  await drag("N", "V", "before", "{tree: S(VP(N(cat), V(see)), NP(Adj(small)), P)}");
  const final = "{tree: S(VP(N(cat), V(see), P), NP(Adj(small)))}";
  await drag("P", "VP", undefined, final);

  const source = await center("N");
  await mouse("mousePressed", source);
  await mouse("mouseMoved", await center("NP"));
  const blank = await cdp.eval(`(() => {
    const rect = (${tree}).getBoundingClientRect();
    return { x: rect.left + 2, y: rect.top + 2 };
  })()`);
  await mouse("mouseMoved", blank);
  await mouse("mouseReleased", blank);
  await ensure((await current()) === final, "Dropping in blank space changed the tree source.");
  await ensure(await cdp.eval("!document.querySelector('.langscape-tree-drag-preview')"), "The drag preview was left behind.");
  log("tree drag highlights and commits sibling ordering, reparenting, and blank-space cancellation");
}

async function clickExplorerMenuItem(cdp, selector, title) {
  await waitFor(() => cdp.eval(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),
    10_000, `the explorer target ${selector}`);
  const clicked = await cdp.eval(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, button: 2, clientX: rect.left + 6, clientY: rect.top + 6,
    }));
    const items = [...document.querySelectorAll('.menu-item-title')]
      .filter((item) => item.textContent === ${JSON.stringify(title)});
    if (items.length !== 1) return false;
    items[0].closest('.menu-item').click();
    return true;
  })()`);
  await ensure(clicked, `Could not click ${title} in the menu for ${selector}.`);
}

async function testLexurgyUi(cdp, liveDocs) {
  const ribbonRemoved = await cdp.eval(`!document.querySelector(
    '[aria-label="Langscape: new sound-change file"], [aria-label="Langscape: insert custom-font text"]'
  )`);
  await ensure(ribbonRemoved, "The Langscape ribbon buttons are still present.");

  for (const [selector, expectedPath] of [
    [".nav-files-container", "Sound Changes.lsc"],
    ['.nav-folder-title[data-path="Fonts"]', "Fonts/Sound Changes.lsc"],
  ]) {
    await clickExplorerMenuItem(cdp, selector, "New Lexurgy file");
    await waitFor(() => cdp.eval(
      `app.workspace.getActiveFile()?.path === ${JSON.stringify(expectedPath)}`,
    ), 10_000, `the new ${expectedPath} editor`);
  }
  log("native explorer menu creates and opens Lexurgy files in the root and clicked folder");

  await cdp.eval(`app.workspace.getMostRecentLeaf().view.contentEl.querySelector('.langscape-docs-button').click()`);
  await waitFor(() => cdp.eval(`(() => {
    const docs = app.workspace.getLeavesOfType('langscape-lexurgy-docs');
    return docs.length === 1 && app.workspace.getMostRecentLeaf() === docs[0]
      && app.workspace.getLeavesOfType('langscape-sound-change').length > 0
      && Boolean(docs[0].view.contentEl.querySelector('.langscape-docs-article'));
  })()`), 10_000, "the native Lexurgy Docs tab alongside the editor");
  log("the test bench Docs button opens a separate native tab");
  if (!liveDocs) return;

  const link = async (path) => {
    const selector = `.langscape-docs-article a[href="https://www.lexurgy.com/sc/docs${path}"]`;
    await waitFor(() => cdp.eval(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), 20_000, `manual link ${path}`);
    await cdp.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  await link("/tutorial");
  await link("/tutorial/basics");
  await waitFor(() => cdp.eval(`document.querySelector('.langscape-docs-example code')?.textContent.includes('lot-thought-merger')`),
    20_000, "a tutorial example rendered as code");
  await cdp.eval(`(() => {
    const sections = document.querySelector('.langscape-docs-toolbar select');
    sections.value = 'conditions';
    sections.dispatchEvent(new Event('change'));
  })()`);
  await ensure(await cdp.eval(`document.querySelector('.langscape-docs-article').scrollTop > 0`), "Jump to section did not scroll the article.");
  await cdp.eval(`[...document.querySelectorAll('.langscape-docs-toolbar button')].find((button) => button.textContent === 'Contents').click()`);
  await link("/cheatsheet");
  await waitFor(() => cdp.eval(`Boolean(document.querySelector('.langscape-docs-article table code'))`),
    20_000, "a cheat sheet table rendered in the tab");
  log("the live manual renders navigation, jump links, tutorial examples and cheat sheet tables");
}

async function testRecipe(cdp) {
  const input = "Recipe input";
  const output = "Recipe output";
  const nestedVault = "Nested Vault";
  const normalFolder = `${input}/${nestedVault}`;
  const filename = "A source note.md";
  const property = "proto-form";
  const first = "First.lsc";
  const second = "Second.lsc";
  const body = "\n# Source heading\n\nThe body is unchanged.\n\n- Including this list\n";
  const sources = {
    [`${input}/${filename}`]: `---\n${property}: apa\ngloss: father\ntags: [kin]\nattested: false\n---\n${body}`,
    [`${input}/Unmatched.md`]: "---\ngloss: not a match\n---\n# Unmatched\n",
    "Outside.md": `---\n${property}: aka\n---\n# Outside the selected folder\n`,
  };
  const fixtures = {
    ...sources,
    [first]: "Keep-First:\n  a => e\n\nDiscard-First:\n  e => i\n",
    [second]: "Keep-Second:\n  p => b\n",
    [`${nestedVault}/${first}`]: "",
    [`${normalFolder}/${first}`]: "",
  };
  await cdp.eval(`(async () => {
    for (const folder of ${JSON.stringify([input, output, normalFolder, nestedVault])}) await app.vault.createFolder(folder);
    for (const [path, contents] of Object.entries(${JSON.stringify(fixtures)})) {
      await app.vault.create(path, contents);
    }
  })()`);

  await fs.mkdir(path.join(vault, nestedVault, ".obsidian"));
  const recipePath = `${input}/Recipe.recipe`;
  const view = "app.workspace.getMostRecentLeaf()?.view";
  for (const [selector, expectedPath] of [
    [".nav-files-container", "Recipe.recipe"],
    [`.nav-folder-title[data-path="${input}"]`, recipePath],
  ]) {
    await clickExplorerMenuItem(cdp, selector, "New recipe");
    await waitFor(() => cdp.eval(
      `${view}?.getViewType() === 'langscape-recipe' && ${view}?.file?.path === ${JSON.stringify(expectedPath)}`,
    ), 10_000, `the new ${expectedPath} card`);
  }

  const control = (selector) => `${view}?.contentEl?.querySelector(${JSON.stringify(selector)})`;
  const click = (selector) => waitFor(() => cdp.eval(`(() => {
    const el = ${control(selector)};
    if (!el || el.disabled) return false;
    el.click();
    return true;
  })()`), 10_000, `the enabled ${selector} control`);
  const pick = async (selector, path) => {
    await click(selector);
    await waitFor(() => cdp.eval(`(() => {
      const label = [...document.querySelectorAll('.langscape-path-popover .langscape-path-label')]
        .find((el) => el.textContent === ${JSON.stringify(path)});
      if (!label) return false;
      label.closest('.langscape-path-item').click();
      return true;
    })()`), 10_000, `the picker option ${path}`);
  };
  const listChoices = async (selector) => {
    await click(selector);
    const listed = await waitFor(() => cdp.eval(`(() => {
      const rows = [...document.querySelectorAll(".langscape-path-popover .langscape-path-label")];
      return rows.length && rows.map((row) => row.textContent);
    })()`), 10_000, `the choices for ${selector}`);
    await cdp.eval(`document.querySelector(".langscape-path-search").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
    return listed;
  };
  const folders = await listChoices(".langscape-recipe-input-folder");
  assert.ok(folders.includes(normalFolder), "A normal folder with the same basename should remain visible.");
  assert.ok(!folders.includes(nestedVault), "A nested vault should not appear in the folder picker.");
  const changes = await listChoices(".langscape-recipe-add-change");
  assert.ok(changes.includes(`${normalFolder}/${first}`), "A real .lsc file with the same basename should remain visible.");
  assert.ok(!changes.includes(`${nestedVault}/${first}`), "Files in a nested vault should not appear in the sound-change picker.");
  await pick(".langscape-recipe-input-folder", input);
  const propertySelect = control(".langscape-recipe-property");
  await waitFor(() => cdp.eval(`(() => {
    const select = ${propertySelect};
    if (!select || select.disabled || ![...select.options].some((option) => option.value === ${JSON.stringify(property)})) {
      return false;
    }
    select.value = ${JSON.stringify(property)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`), 10_000, `the discovered ${property} property`);

  for (const path of [first, second]) {
    await pick(".langscape-recipe-add-change", path);
    await waitFor(() => cdp.eval(`Boolean(${control(`.langscape-recipe-change[data-path="${path}"]`)})`),
      10_000, `the added ${path} change`);
  }
  const firstRow = `.langscape-recipe-change[data-path="${first}"]`;
  const rule = `${firstRow} input[type="checkbox"][data-rule="Discard-First"]`;
  await click(`${firstRow} .langscape-recipe-advanced > summary`);
  await waitFor(() => cdp.eval(`${control(rule)}?.checked === true`), 10_000, "the enabled Discard-First rule");
  await click(rule);
  await pick(".langscape-recipe-output-folder", output);

  const outputPath = `${output}/${filename}`;
  const run = async (expected = "success") => {
    await click(".langscape-recipe-run");
    const result = await waitFor(() => cdp.eval(`(() => {
      const el = ${control('.langscape-recipe-result[data-state="success"], .langscape-recipe-result[data-state="error"]')};
      return el && { state: el.dataset.state, text: el.textContent };
    })()`), 10_000, "the recipe run result");
    assert.equal(result.state, expected, result.text);
    return result.text;
  };
  try {
    // Keep the real recipe and vault operations; normally substitute only the JVM call.
    if (!testLexurgyPath) await cdp.eval(`(() => {
      const lexurgy = app.plugins.plugins.langscape.lexurgy;
      const original = Object.getOwnPropertyDescriptor(lexurgy, 'apply');
      const mock = window.__recipeSmoke = {
        calls: 0,
        restore() {
          if (original) Object.defineProperty(lexurgy, 'apply', original);
          else delete lexurgy.apply;
          delete window.__recipeSmoke;
        },
      };
      const stages = [
        { rule: 'Keep-First:', input: 'apa', output: 'epe' },
        { rule: 'Keep-Second:', input: 'epe', output: 'ebe', expression: 'p => b' },
        { rule: 'Keep-First:', input: 'apa', output: 'epe' },
        { rule: 'Keep-Second:', input: 'epe', output: 'ede', expression: 'p => d' },
      ];
      lexurgy.apply = async (changes, words) => {
        const stage = stages[mock.calls++];
        if (!stage || !changes.includes(stage.rule) || changes.includes('Discard-First:')
          || (stage.expression && !changes.includes(stage.expression))
          || words.length !== 1 || words[0] !== stage.input) {
          throw new Error('Unexpected recipe stage ' + mock.calls + ': ' + JSON.stringify({ changes, words }));
        }
        return { words: [stage.output], intermediates: {}, traceLines: [] };
      };
    })()`);
    await run();
    assert.match(await fs.readFile(path.join(vault, outputPath), "utf8"), /^proto-form: ebe$/m);
    await cdp.eval(`app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(second)}),
      ${JSON.stringify("Keep-Second:\n  p => d\n")})`);
    await run();
    if (!testLexurgyPath) {
      assert.equal(await cdp.eval("window.__recipeSmoke.calls"), 4, "Both changes must run in order on each run.");
    }
  } finally {
    if (!testLexurgyPath) await cdp.eval("window.__recipeSmoke?.restore()");
  }

  const saved = JSON.parse(await fs.readFile(path.join(vault, recipePath), "utf8"));
  assert.deepEqual(saved, {
    inputFolder: input,
    property,
    changes: [{ path: first, disabledRules: ["Discard-First"] }, { path: second, disabledRules: [] }],
    outputFolder: output,
  }, "The configured recipe should be saved to the recipe file.");
  assert.deepEqual(await fs.readdir(path.join(vault, output)), [filename], "Only the matching filename should be copied.");
  const contents = await fs.readFile(path.join(vault, outputPath), "utf8");
  const header = /^---\n[\s\S]*?\n---\n/.exec(contents);
  await ensure(header, "The output is missing YAML frontmatter.");
  assert.equal(contents.slice(header[0].length), body, "The output body changed.");
  const properties = await waitFor(() => cdp.eval(`(() => {
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(outputPath)});
    const frontmatter = file && app.metadataCache.getFileCache(file)?.frontmatter;
    if (frontmatter?.[${JSON.stringify(property)}] !== "ede") return null;
    const { position, ...properties } = frontmatter;
    return properties;
  })()`), 10_000, "the output frontmatter cache");
  assert.deepEqual(properties, {
    [property]: "ede", gloss: "father", tags: ["kin"], attested: false,
  }, "Only the selected property should change.");
  for (const [pathInVault, original] of Object.entries(sources)) {
    assert.equal(await fs.readFile(path.join(vault, pathInVault), "utf8"), original, `${pathInVault} changed.`);
  }
  log(`native recipe card run ${testLexurgyPath ? "with real Lexurgy " : ""}preserves filenames, other properties, bodies and source notes`);
  if (process.argv.includes("--capture-recipe")) {
    const clip = await cdp.eval(`(() => {
      const { left, top, right, bottom } = ${control(".langscape-recipe-card")}.getBoundingClientRect();
      const x = Math.max(0, left - 12);
      const y = Math.max(0, top - 12);
      const width = Math.min(innerWidth, right + 12) - x;
      const height = Math.min(innerHeight, bottom + 12) - y;
      return { x, y, width, height, scale: 1 };
    })()`);
    const image = await cdp.send("Page.captureScreenshot", { format: "png", clip });
    await fs.writeFile(path.join(tools, "recipe-card.png"), Buffer.from(image.data, "base64"));
    log("recipe screenshot: .tools/headless-obsidian/recipe-card.png");
  }

  if (testLexurgyPath) {
    const setFirstChange = (source) => cdp.eval(`app.vault.modify(
      app.vault.getAbstractFileByPath(${JSON.stringify(first)}), ${JSON.stringify(source)})`);
    const titlePath = `${output}/Unmetched.md`;
    await cdp.eval(`(() => {
      const select = ${propertySelect};
      select.querySelector('option[data-target="title"]').selected = true;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await run();
    assert.equal(JSON.parse(await fs.readFile(path.join(vault, recipePath), "utf8")).target, "title");
    const expected = sources[`${input}/Unmatched.md`];
    assert.equal(await fs.readFile(path.join(vault, titlePath), "utf8"), expected);
    assert.equal(await fs.readFile(path.join(vault, input, "Unmatched.md"), "utf8"), expected);

    await setFirstChange("Keep-First:\n  a => \\?\n\nDiscard-First:\n  e => i\n");
    const before = (await fs.readdir(path.join(vault, output))).sort();
    assert.match(await run("error"), /Unmatched\.md.*Invalid note title/);
    assert.deepEqual((await fs.readdir(path.join(vault, output))).sort(), before);
    assert.equal(await fs.readFile(path.join(vault, titlePath), "utf8"), expected);
    log("recipe title mode evolves filenames and rejects illegal Lexurgy output before writing");
  }
}

async function testManualLexurgySetup(cdp) {
  await cdp.eval("app.setting.open(); app.setting.openTabById('langscape'); true");
  try {
    const controls = await waitFor(() => cdp.eval(`(() => {
      const settings = app.setting.activeTab?.containerEl;
      if (!settings?.querySelector('.langscape-lexurgy-setting-status')) return null;
      const links = [...settings.querySelectorAll('a')];
      return {
        headings: [...settings.querySelectorAll('.setting-item-heading .setting-item-name')].map(el => el.textContent.trim()),
        link: links.find(el => el.textContent === 'Open official Lexurgy releases')?.href,
        hasInstaller: [...settings.querySelectorAll('button')].some(el => el.textContent === 'Install Lexurgy'),
        hasPath: !!settings.querySelector('input[placeholder="/home/you/lexurgy"]'),
      };
    })()`), 10_000, "Lexurgy setup settings");
    assert.deepEqual(controls.headings, ["Fonts", "Lexurgy"]);
    assert.equal(controls.link, "https://github.com/def-gthill/lexurgy/releases");
    assert.equal(controls.hasInstaller, false);
    assert.equal(controls.hasPath, true);
  } finally {
    await cdp.eval("app.setting.close(); true");
  }
  log("Lexurgy setup links to the official releases and accepts a configured path without an in-app installer");
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

    const tableRect = await cdp.eval(`(() => {
      const table = document.querySelectorAll('.cm-table-widget table')[0];
      const rect = table.getBoundingClientRect();
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    })()`);
    const tableShot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      clip: {
        x: Math.max(0, tableRect.x - 16),
        y: Math.max(0, tableRect.y - 16),
        width: tableRect.width + 32,
        height: tableRect.height + 32,
        scale: 2,
      },
    });
    await fs.writeFile(
      path.join(tools, "merged-table.png"),
      Buffer.from(tableShot.data, "base64")
    );

    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(screenshot, Buffer.from(shot.data, "base64"));
    log(`screenshot: ${path.relative(root, screenshot)}`);
    log(`merged table: ${path.relative(root, path.join(tools, "merged-table.png"))}`);
    await testSyntaxTreeDrag(cdp);
    await testLexurgyUi(cdp, process.argv.includes("--live-docs"));
    await testRecipe(cdp);
    await testManualLexurgySetup(cdp);
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
