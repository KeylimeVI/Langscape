#!/usr/bin/env node
/**
 * End-to-end verification against a real Obsidian instance.
 *
 * Prerequisites (not committed; see README):
 *   .tools/obsidian/obsidian-<version>/obsidian   (official Linux build)
 *   .tools/lexurgy/lexurgy-1.7.7/lib/*.jar       (official Lexurgy release)
 *   Java 8+ and a graphical session (DISPLAY).
 *
 * Usage:
 *   npm run build
 *   node scripts/e2e-obsidian.mjs
 *
 * The script creates a disposable vault in .tools/e2e-vault, installs the
 * built plugin there, opens the vault through Electron's IPC, exercises the
 * real plugin (starter vault, pipeline run, fonts, .lsc editor), and then
 * closes Obsidian.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tools = path.join(root, ".tools");
const vault = path.join(tools, "e2e-vault");
const home = path.join(tools, "e2e-home");
const port = Number(process.env.E2E_PORT ?? 9231);
const obsidianBin = process.env.OBSIDIAN_BIN ?? path.join(tools, "obsidian/obsidian-1.15.0/obsidian");
const lexurgyHome = process.env.LEXURGY_HOME ?? path.join(tools, "lexurgy/lexurgy-1.7.7");
const display = process.env.DISPLAY ?? ":0";

function log(message) {
  console.log(`[e2e] ${message}`);
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

async function setupVault() {
  if (process.env.E2E_RESET === "1") {
    await fs.rm(vault, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  }
  // Keep the Obsidian profile between runs so the vault stays trusted and the
  // test does not pester the person running it with a trust prompt every time.
  await fs.mkdir(path.join(vault, ".obsidian/plugins/langscape"), { recursive: true });
  await fs.mkdir(path.join(home, "config"), { recursive: true });
  await fs.mkdir(path.join(home, "cache"), { recursive: true });
  await fs.mkdir(path.join(home, "data"), { recursive: true });
  for (const stale of ["Langscape Demo", "Scratch.md", "FontNoteTest.md"]) {
    await fs.rm(path.join(vault, stale), { recursive: true, force: true });
  }
  await fs.rm(path.join(vault, ".obsidian/workspace.json"), { force: true });
  for (const file of ["main.js", "manifest.json", "styles.css"]) {
    await fs.copyFile(path.join(root, file), path.join(vault, ".obsidian/plugins/langscape", file));
  }
  await fs.writeFile(
    path.join(vault, ".obsidian/community-plugins.json"),
    JSON.stringify(["langscape"])
  );
  await fs.writeFile(
    path.join(vault, ".obsidian/plugins/langscape/data.json"),
    JSON.stringify(
      {
        lexurgyPath: lexurgyHome,
        traceByDefault: true,
      },
      null,
      2
    )
  );
  await fs.writeFile(path.join(vault, "Welcome.md"), "# E2E vault\n");
  await fs.mkdir(path.join(vault, "FontBase"), { recursive: true });
  await fs.writeFile(
    path.join(vault, "FontBase", "Word.md"),
    "---\nword: \"{Noto-Sans-Gothic: 𐌰𐍆𐌰}\"\n---\n"
  );
  await fs.writeFile(
    path.join(vault, "FontBase.base"),
    [
      "views:",
      "  - type: table",
      "    name: Font base",
      "    filters:",
      "      and:",
      '        - file.inFolder("FontBase")',
      "    order:",
      "      - file.name",
      "      - word",
      "",
    ].join("\n")
  );
}

async function waitForPort(url, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // Not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
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

async function saveScreenshot(cdp, name) {
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
  await fs.mkdir(path.join(root, "docs/screenshots"), { recursive: true });
  await fs.writeFile(
    path.join(root, "docs/screenshots", name),
    Buffer.from(screenshot.data, "base64")
  );
  log(`saved docs/screenshots/${name}`);
}

async function waitForEval(cdp, expression, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await cdp.eval(expression)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function findPage(selector) {
  const targets = await waitForPort(`http://127.0.0.1:${port}/json/list`);
  return targets.find((target) => target.type === "page" && selector(target));
}

async function waitForPage(selector, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const page = await findPage(selector);
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return undefined;
}

async function main() {
  await ensure(await exists(obsidianBin), `Obsidian binary not found: ${obsidianBin}`);
  await ensure(await exists(path.join(lexurgyHome, "lib")), `Lexurgy not found: ${lexurgyHome}`);
  await ensure(await exists(path.join(root, "main.js")), "main.js is missing; run npm run build first.");

  await setupVault();
  log(`launching ${obsidianBin}`);
  const child = spawn(
    obsidianBin,
    [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--ozone-platform=x11",
      `--remote-debugging-port=${port}`,
    ],
    {
      env: {
        ...process.env,
        DISPLAY: display,
        XDG_CONFIG_HOME: path.join(home, "config"),
        XDG_CACHE_HOME: path.join(home, "cache"),
        XDG_DATA_HOME: path.join(home, "data"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });

  try {
    let page = await waitForPage(
      (target) => target.url.includes("index.html") || target.url.includes("starter.html")
    );
    await ensure(page, "Obsidian did not open a window.");
    if (page.url.includes("starter.html")) {
      const starter = await Cdp.connect(page.webSocketDebuggerUrl);
      const opened = await starter.eval(
        `String(require('electron').ipcRenderer.sendSync('vault-open', ${JSON.stringify(vault)}, false))`
      );
      starter.close();
      await ensure(opened === "true", `Obsidian could not open the test vault: ${opened}`);
      log("vault opened");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      page = await waitForPage((target) => target.url.includes("index.html"));
      await ensure(page, "Obsidian did not load the vault window.");
    } else {
      log("reusing the already-open test vault");
    }
    const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    await ensure(
      await waitForEval(cdp, "Boolean(window.app && window.app.plugins)", 20_000),
      "Obsidian's plugin manager did not become available."
    );

    let loaded = await waitForEval(cdp, "Boolean(window.app?.plugins?.plugins?.langscape)", 8_000);
    if (!loaded) {
      const trusted = await cdp.eval(
        `(() => { const button = [...document.querySelectorAll('button')].find((el) => /trust author/i.test(el.textContent || '')); if (button) { button.click(); return true; } return false; })()`
      );
      if (trusted) log("accepted Obsidian's trust prompt");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!loaded) {
      await cdp.eval("(async () => { await app.plugins.enablePlugin('langscape'); return true; })()");
    }
    await ensure(
      await waitForEval(cdp, "Boolean(window.app?.plugins?.plugins?.langscape)", 15_000),
      "Langscape plugin did not load."
    );
    // A restored popout Settings window can steal Obsidian's activeWindow and
    // send later modals to an invisible window.
    await cdp.eval("document.body.classList.remove('theme-light'); document.body.classList.add('theme-dark'); true");
    await cdp.eval("app.setting?.close?.(); true");
    const commands = await cdp.eval(
      "JSON.stringify(Object.keys(app.commands.commands).filter((id) => id.startsWith('langscape:')))"
    );
    log(`commands: ${commands}`);

    const environment = await cdp.eval(
      "(async () => JSON.stringify(await app.plugins.plugins.langscape.lexurgy.getEnvironment(true)))()"
    );
    const env = JSON.parse(environment);
    await ensure(env.installation, `Lexurgy not detected: ${env.error ?? "unknown"}`);
    log(`Lexurgy: ${env.installation.label}`);

    await cdp.eval("(async () => { await app.plugins.plugins.langscape.createStarterVault(); return true; })()");
    await ensure(
      await exists(path.join(vault, "Langscape Demo/Pipelines/Demo.canvas")),
      "Starter vault was not created."
    );
    log("starter vault created");

    const canvasPath = "Langscape Demo/Pipelines/Demo.canvas";
    await cdp.eval(
      `(async () => {
        const path = ${JSON.stringify("Langscape Demo/Pipelines/Demo.canvas")};
        const f = app.vault.getAbstractFileByPath(path);
        const matching = () => app.workspace.getLeavesOfType('canvas').filter((candidate) => candidate.view.file?.path === path);
        let leaves = matching();
        let leaf = leaves.find((candidate) => candidate.view.containerEl.isShown()) || leaves[0];
        if (!leaf) {
          leaf = app.workspace.getLeaf('tab');
          await leaf.openFile(f);
        }
        for (const other of matching()) {
          if (other !== leaf) other.detach();
        }
        app.workspace.setActiveLeaf(leaf, { focus: true });
        leaf.view.canvas?.zoomToFit?.();
        leaf.view.canvas?.virtualize?.();
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return true;
      })()`
    );
    const canvasState = await cdp.eval(
      `(() => { const leaves = app.workspace.getLeavesOfType('canvas'); return JSON.stringify({ leaves: leaves.length, active: leaves.filter((leaf) => leaf.view.containerEl.isShown()).length, nodes: leaves.map((leaf) => leaf.view.canvas?.nodes?.size ?? -1), cards: document.querySelectorAll('.langscape-node-card').length, activeWindowMain: window.activeWindow === window }); })()`
    );
    if (!(await waitForEval(cdp, "document.querySelectorAll('.langscape-node-card').length >= 3", 10_000))) {
      throw new Error(`The canvas pipeline cards did not render: ${canvasState}`);
    }
    const cards = JSON.parse(
      await cdp.eval(
        "JSON.stringify([...document.querySelectorAll('.langscape-node-card')].map((card) => ({ kind: card.dataset.stepKind, label: card.querySelector('.langscape-node-label')?.textContent, detail: card.querySelector('.langscape-node-detail')?.textContent, buttons: [...card.querySelectorAll('button')].map((button) => button.textContent) })))"
      )
    );
    await ensure(cards.length === 3, `Expected three canvas cards, got ${cards.length}.`);
    const sourceCard = cards.find((card) => card.kind === "source");
    const changeCard = cards.find((card) => card.kind === "sound-change");
    const outputCard = cards.find((card) => card.kind === "output");
    await ensure(sourceCard && sourceCard.buttons.length === 0, "The source card should have no Run button.");
    await ensure(changeCard && changeCard.buttons.length === 0, "The sound-change card should have no Run button.");
    await ensure(outputCard && outputCard.buttons.includes("Run"), "The output card is missing its Run button.");
    await ensure(!outputCard?.buttons.includes("Run all"), "A single output should not show Run all.");
    log("canvas cards are compact and only the output has Run");
    await cdp.eval("document.querySelectorAll('.notice').forEach((notice) => notice.remove()); true");
    await saveScreenshot(cdp, "canvas-pipeline.png");

    // Inline card editing: source field and output pipeline title.
    const sourceFieldChanged = await cdp.eval(
      `(async () => { const card = document.querySelector('.langscape-node-card[data-step-kind="source"]'); const input = card?.querySelector('.langscape-node-field-input'); if (!input) return false; input.value = 'lexeme'; input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 700)); return true; })()`
    );
    await ensure(sourceFieldChanged, "The source field textbox was not found.");
    const sourceFieldGraph = JSON.parse(
      await cdp.eval(
        `(async () => JSON.stringify(await app.plugins.plugins.langscape.getLiveCanvasGraph(${JSON.stringify("Langscape Demo/Pipelines/Demo.canvas")})))()`
      )
    );
    await ensure(
      sourceFieldGraph.steps.find((step) => step.kind === "source")?.field === "lexeme",
      "Editing the source field did not update the pipeline."
    );
    await cdp.eval(
      `(async () => { const card = document.querySelector('.langscape-node-card[data-step-kind="source"]'); const input = card?.querySelector('.langscape-node-field-input'); if (!input) return false; input.value = 'word'; input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 700)); return true; })()`
    );

    const titleChanged = await cdp.eval(
      `(async () => { const card = document.querySelector('.langscape-node-card[data-step-kind="output"]'); const input = card?.querySelector('.langscape-node-title-input'); if (!input) return false; input.value = 'Modern Language'; input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 700)); return true; })()`
    );
    await ensure(titleChanged, "The output title textbox was not found.");
    const titledGraph = JSON.parse(
      await cdp.eval(
        `(async () => JSON.stringify(await app.plugins.plugins.langscape.getLiveCanvasGraph(${JSON.stringify("Langscape Demo/Pipelines/Demo.canvas")})))()`
      )
    );
    await ensure(
      titledGraph.steps.find((step) => step.kind === "output")?.name === "Modern Language",
      "Editing the output title did not update the pipeline name."
    );
    await cdp.eval(
      `(async () => { const card = document.querySelector('.langscape-node-card[data-step-kind="output"]'); const input = card?.querySelector('.langscape-node-title-input'); if (!input) return false; input.value = 'Modern'; input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 700)); return true; })()`
    );
    log("inline source field and output title update the canvas config");

    // Double-clicking a card body must not open the YAML metadata editor.
    const openedEditor = await cdp.eval(
      `(async () => { const card = document.querySelector('.langscape-node-card[data-step-kind="output"]'); card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); await new Promise((resolve) => setTimeout(resolve, 400)); return Boolean(document.querySelector('.canvas-node-content .cm-editor, .canvas-node.is-editing')); })()`
    );
    await ensure(!openedEditor, "Double-clicking a card opened the canvas metadata editor.");

    // Double-clicking a folder name opens the anchored picker; Escape closes it.
    const sourcePathOpened = await cdp.eval(
      `(async () => { const row = document.querySelector('.langscape-node-card[data-step-kind="source"] .langscape-node-path'); if (!row) return false; row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); await new Promise((resolve) => setTimeout(resolve, 250)); return Boolean(document.querySelector('.langscape-path-popover')); })()`
    );
    await ensure(sourcePathOpened, "Double-clicking the source folder did not open the picker.");
    await ensure(
      !(await cdp.eval("Boolean(document.querySelector('.canvas-node-content .cm-editor'))")),
      "Double-clicking a folder name opened the canvas metadata editor."
    );
    await saveScreenshot(cdp, "path-picker.png");
    await cdp.eval(
      `(() => { const input = document.querySelector('.langscape-path-search'); input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    const scPathOpened = await cdp.eval(
      `(async () => { const row = document.querySelector('.langscape-node-card[data-step-kind="sound-change"] .langscape-node-path'); if (!row) return false; row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); await new Promise((resolve) => setTimeout(resolve, 250)); const open = Boolean(document.querySelector('.langscape-path-popover')); document.querySelector('.langscape-path-search')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return open; })()`
    );
    await ensure(scPathOpened, "Double-clicking the sound-change file did not open the file picker.");
    await new Promise((resolve) => setTimeout(resolve, 200));
    log("double-click protection and anchored folder/file pickers work");

    const graph = JSON.parse(
      await cdp.eval(
        `(async () => JSON.stringify(await app.plugins.plugins.langscape.getPipelineGraph(${JSON.stringify("Langscape Demo/Pipelines/Demo.canvas")})))()`
      )
    );
    const outputStep = graph.steps.find((step) => step.kind === "output");
    await ensure(outputStep, "Demo canvas has no output step.");
    const branchRun = await cdp.eval(
      `(async () => JSON.stringify(await app.plugins.plugins.langscape.runCanvasByPath(${JSON.stringify("Langscape Demo/Pipelines/Demo.canvas")}, { targetNodeId: ${JSON.stringify(outputStep.id)} })))()`
    );
    const branchReport = JSON.parse(branchRun);
    await ensure(
      branchReport && branchReport.outputs.length === 1 && branchReport.outputs[0].paths.length === 3,
      "Running a single output did not write three notes."
    );
    for (const output of branchReport.outputs[0].paths) {
      await ensure(await exists(path.join(vault, output)), `Missing pipeline output: ${output}`);
    }
    const firstNote = await fs.readFile(
      path.join(vault, branchReport.outputs[0].paths[0]),
      "utf8"
    );
    await ensure(firstNote.includes('source: "[[Langscape Demo/Words/Proto/apa]]"'), "Output is missing its source property.");
    await ensure(firstNote.includes('original: "apa"'), "Output is missing its original word.");
    await ensure(firstNote.includes('word: "ebe"'), "Output is missing the evolved word.");
    await ensure(firstNote.includes('pipeline: "Modern"'), "Output is missing its pipeline name.");
    await ensure(!firstNote.includes("| Stage |"), "Output still contains the old stage table.");
    log(`single-output pipeline wrote: ${branchReport.outputs[0].paths.join(", ")}`);

    const rerun = JSON.parse(
      await cdp.eval(
        `(async () => JSON.stringify(await app.plugins.plugins.langscape.runCanvasByPath(${JSON.stringify("Langscape Demo/Pipelines/Demo.canvas")})))()`
      )
    );
    await ensure(
      JSON.stringify(rerun.outputs[0].paths) === JSON.stringify(branchReport.outputs[0].paths),
      "Re-running the pipeline did not update the same notes."
    );
    const modernDir = path.join(vault, "Langscape Demo/Words/Modern");
    await ensure((await fs.readdir(modernDir)).length === 3, "Pipeline created duplicate notes.");
    log("pipeline rerun is idempotent");

    // Exercise the canvas header action and its add-output flow.
    const actionClicked = await cdp.eval(
      `(() => { const button = [...app.workspace.activeLeaf.view.containerEl.querySelectorAll('[aria-label]')].find((el) => el.getAttribute('aria-label') === 'Langscape'); if (!button) return false; button.click(); return true; })()`
    );
    await ensure(actionClicked, "Canvas Langscape header action was not found.");
    await new Promise((resolve) => setTimeout(resolve, 300));
    const menuItems = await cdp.eval(
      "JSON.stringify([...document.querySelectorAll('.menu-item')].map((item) => item.textContent))"
    );
    await ensure(menuItems.includes("Run all pipelines"), "Canvas menu is missing Run all.");
    const addClicked = await cdp.eval(
      `(() => { const item = [...document.querySelectorAll('.menu-item')].find((el) => /Add output/i.test(el.textContent || '')); if (!item) return false; item.click(); return true; })()`
    );
    await ensure(addClicked, "Canvas Langscape menu did not contain Add output.");
    await ensure(
      await waitForEval(cdp, "Boolean(document.querySelector('.langscape-path-popover'))", 5_000),
      "The output folder picker did not open."
    );
    await cdp.eval(
      `(() => { const input = document.querySelector('.langscape-path-search'); input.value = 'Langscape Demo/Words/Alt'; input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.langscape-path-item.is-create')?.click(); return true; })()`
    );
    await cdp.eval("(async () => { await app.workspace.activeLeaf.view.save?.(); return true; })()");
    await new Promise((resolve) => setTimeout(resolve, 2200));
    const afterAdd = JSON.parse(
      await cdp.eval(
        `(async () => JSON.stringify(await app.plugins.plugins.langscape.getPipelineGraph(${JSON.stringify("Langscape Demo/Pipelines/Demo.canvas")})))()`
      )
    );
    await ensure(
      afterAdd.steps.filter((step) => step.kind === "output").length === 2,
      "Adding an output from the canvas menu did not create a second output."
    );
    const newOutput = afterAdd.steps.find(
      (step) => step.kind === "output" && step.path === "Langscape Demo/Words/Alt"
    );
    await ensure(newOutput, "The added output was not written to the canvas.");
    await ensure(
      afterAdd.issues.some(
        (issue) => issue.stepId === newOutput.id && /no input/i.test(issue.message)
      ),
      "The unconnected output has no validation error."
    );
    const addedCards = JSON.parse(
      await cdp.eval(
        "JSON.stringify([...document.querySelectorAll('.langscape-node-card')].map((card) => ({ label: card.querySelector('.langscape-node-label')?.textContent, buttons: [...card.querySelectorAll('button')].map((button) => button.textContent), issues: [...card.querySelectorAll('.langscape-node-issue')].map((issue) => issue.textContent) })))"
      )
    );
    await ensure(addedCards.length >= 4, "The newly added output card did not render.");
    await ensure(
      addedCards.some((card) => card.issues.some((issue) => /no input/i.test(issue))),
      "The unconnected output card did not show its error."
    );
    await cdp.eval(
      `(async () => { const v = app.workspace.activeLeaf.view; const c = v.canvas; const data = c.getData(); data.edges = [...(data.edges || []), { id: 'e-alt', fromNode: 'sound-changes', toNode: ${JSON.stringify(newOutput.id)}, fromSide: 'right', toSide: 'left' }]; c.importData(data, true); c.requestSave(); await v.save?.(); return true; })()`
    );
    await new Promise((resolve) => setTimeout(resolve, 900));
    const fixedCard = JSON.parse(
      await cdp.eval(
        `(() => { const card = document.querySelector('.langscape-node-card[data-step-id="${newOutput.id}"]'); return JSON.stringify({ found: Boolean(card), issues: card ? [...card.querySelectorAll('.langscape-node-issue')].map((issue) => issue.textContent) : [] }); })()`
      )
    );
    await ensure(fixedCard.found, "The added output card disappeared.");
    await ensure(
      !fixedCard.issues.some((issue) => /no input/i.test(issue)),
      "The output card did not clear its error after the connection was saved."
    );
    log("canvas menu added an output and cards refresh after connections");

    // Double-clicking the Lexurgy card body opens the .lsc file itself.
    const openedLsc = await cdp.eval(
      `(async () => { const card = document.querySelector('.langscape-node-card[data-step-kind="sound-change"]'); const header = card?.querySelector('.langscape-node-header'); if (!header) return false; header.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); await new Promise((resolve) => setTimeout(resolve, 900)); return app.workspace.activeLeaf?.view?.getViewType?.() === 'langscape-sound-change'; })()`
    );
    await ensure(openedLsc, "Double-clicking the sound-change card did not open the .lsc file.");
    log("double-clicking a sound-change card opens the .lsc file");

    await new Promise((resolve) => setTimeout(resolve, 1200));
    const fonts = await cdp.eval(
      "JSON.stringify(app.plugins.plugins.langscape.fontManager.list())"
    );
    await ensure(fonts.includes("Noto Sans Gothic"), "Demo font was not discovered.");
    await ensure(
      await cdp.eval("document.fonts.check('16px \"Noto Sans Gothic\"')"),
      "Demo font did not load."
    );
    log("font discovered and loaded");

    await cdp.eval(
      `(async () => { const f = app.vault.getAbstractFileByPath('Langscape Demo/Notes/Font demo.md'); const leaf = app.workspace.getLeaf('tab'); await leaf.openFile(f); app.workspace.setActiveLeaf(leaf, { focus: true }); return true; })()`
    );
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const inlineSpans = await cdp.eval(
      "document.querySelectorAll('.markdown-source-view .cm-content .langscape-font').length"
    );
    await ensure(inlineSpans === 1, `Expected exactly one inline font span in Live Preview, got ${inlineSpans}.`);
    const rawCode = await cdp.eval(
      "document.querySelector('.markdown-source-view .cm-content')?.innerText.includes('{Noto-Sans-Gothic:') ?? false"
    );
    await ensure(rawCode, "Inline code containing font markup was decorated instead of left literal.");
    const fontSpellcheck = JSON.parse(
      await cdp.eval(
        "JSON.stringify({ content: document.querySelector('.markdown-source-view .cm-content')?.getAttribute('spellcheck'), span: document.querySelector('.markdown-source-view .cm-content .langscape-font')?.getAttribute('spellcheck'), lines: document.querySelectorAll('.markdown-source-view .cm-line[spellcheck=\"false\"]').length })"
      )
    );
    await ensure(
      fontSpellcheck.content !== "false",
      `Spellcheck was disabled for the whole note: ${JSON.stringify(fontSpellcheck)}`
    );
    await ensure(
      fontSpellcheck.span === "false" && fontSpellcheck.lines > 0,
      `Spellcheck was not disabled on the font span/line: ${JSON.stringify(fontSpellcheck)}`
    );
    log(`font span spellcheck scope: ${JSON.stringify(fontSpellcheck)}`);
    log("inline font spans render in Live Preview (code stays literal)");
    await saveScreenshot(cdp, "font-demo.png");
    await cdp.eval(
      `(async () => { const f = app.vault.getAbstractFileByPath('Welcome.md'); const leaf = app.workspace.getLeaf('tab'); await leaf.openFile(f); app.workspace.setActiveLeaf(leaf, { focus: true }); await new Promise((resolve) => setTimeout(resolve, 500)); return true; })()`
    );
    const normalSpellcheck = await cdp.eval(
      "document.querySelector('.markdown-source-view .cm-content')?.getAttribute('spellcheck') ?? null"
    );
    await ensure(normalSpellcheck !== "false", "Spellcheck was disabled in a normal Markdown note.");
    log(`normal note spellcheck: ${normalSpellcheck}`);

    await cdp.eval(
      `(async () => { const f = app.vault.getAbstractFileByPath('Langscape Demo/Notes/Tree demo.md'); const leaf = app.workspace.getLeaf('tab'); await leaf.openFile(f); app.workspace.setActiveLeaf(leaf, { focus: true }); return true; })()`
    );
    await waitForEval(cdp, "document.querySelectorAll('.cm-editor .langscape-tree').length === 1", 5_000);
    const treeSource = JSON.parse(
      await cdp.eval(
        "JSON.stringify({ trees: document.querySelectorAll('.cm-editor .langscape-tree').length, labels: [...document.querySelectorAll('.cm-editor .langscape-tree-label')].map((node) => node.textContent), fonts: document.querySelectorAll('.cm-editor .langscape-tree .langscape-font').length, hidden: document.querySelectorAll('.langscape-tree-source-hidden').length, source: app.workspace.activeLeaf?.view?.editor?.getValue?.().includes('{tree:') ?? false })"
      )
    );
    await ensure(treeSource.trees === 1, `Syntax tree did not render in Live Preview: ${JSON.stringify(treeSource)}`);
    await ensure(treeSource.fonts === 1, `Font inside the syntax tree did not render: ${JSON.stringify(treeSource)}`);
    await ensure(treeSource.hidden > 0, `Tree source line was not hidden: ${JSON.stringify(treeSource)}`);
    await ensure(treeSource.source, "The tree's Markdown source disappeared from the editor model.");
    log(`syntax tree source render: ${JSON.stringify(treeSource)}`);

    const renamedTree = JSON.parse(
      await cdp.eval(
        `(async () => {
          const leaf = document.querySelector('.workspace-leaf.mod-active');
          const label = leaf?.querySelector('.langscape-tree-widget .langscape-tree-label');
          if (!label) return JSON.stringify({ error: 'no label' });
          const box = label.getBoundingClientRect();
          const init = { bubbles: true, cancelable: true, button: 0, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
          label.dispatchEvent(new MouseEvent('pointerdown', init));
          label.dispatchEvent(new MouseEvent('pointerup', init));
          await new Promise((resolve) => setTimeout(resolve, 250));
          const input = document.querySelector('.langscape-tree-edit');
          if (!input) return JSON.stringify({ error: 'no edit input' });
          input.value = 'S';
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
          await new Promise((resolve) => setTimeout(resolve, 500));
          return JSON.stringify({
            tree: document.querySelectorAll('.cm-editor .langscape-tree').length,
            labels: [...document.querySelectorAll('.cm-editor .langscape-tree-label')].map((node) => node.textContent),
            source: app.workspace.activeLeaf?.view?.editor?.getValue?.() ?? ''
          });
        })()`
      )
    );
    await ensure(!renamedTree.error, `Tree rename failed: ${JSON.stringify(renamedTree)}`);
    await ensure(renamedTree.tree === 1, `Tree disappeared after rename: ${JSON.stringify(renamedTree)}`);
    await ensure(renamedTree.labels[0] === 'S', `Tree label did not update: ${JSON.stringify(renamedTree)}`);
    await ensure(renamedTree.source.includes('{tree: S('), `Tree source did not update: ${JSON.stringify(renamedTree)}`);
    log(`syntax tree rename: ${JSON.stringify(renamedTree.labels.slice(0, 3))}`);

    const addedTree = await cdp.eval(
      `(async () => {
        const add = document.querySelector('.workspace-leaf.mod-active .langscape-tree-widget .langscape-tree-add');
        if (!add) return false;
        add.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 500));
        return Boolean(app.workspace.activeLeaf?.view?.editor?.getValue?.().includes('X'));
      })()`
    );
    await ensure(addedTree, "The graph + control did not add a child.");
    log("syntax tree plus control adds a child");

    await cdp.eval(
      `(async () => { const leaf = app.workspace.activeLeaf; await leaf.setViewState({ type: 'markdown', state: { file: 'Langscape Demo/Notes/Tree demo.md', mode: 'preview' }, active: true }); await new Promise((resolve) => setTimeout(resolve, 900)); return true; })()`
    );
    await waitForEval(cdp, "document.querySelectorAll('.markdown-preview-view .langscape-tree').length === 1", 5_000);
    const treePreview = JSON.parse(
      await cdp.eval(
        "JSON.stringify({ trees: document.querySelectorAll('.markdown-preview-view .langscape-tree').length, fonts: document.querySelectorAll('.markdown-preview-view .langscape-tree .langscape-font').length, labels: document.querySelectorAll('.markdown-preview-view .langscape-tree-label').length })"
      )
    );
    await ensure(treePreview.fonts === 1, `Tree fonts did not render in Reading view: ${JSON.stringify(treePreview)}`);
    log(`syntax tree Reading view: ${JSON.stringify(treePreview)}`);
    await saveScreenshot(cdp, "syntax-tree.png");
    await cdp.eval(
      `(async () => { const leaf = app.workspace.activeLeaf; await leaf.setViewState({ type: 'markdown', state: { file: 'Langscape Demo/Notes/Tree demo.md', mode: 'source' }, active: true }); await new Promise((resolve) => setTimeout(resolve, 600)); return true; })()`
    );

    await cdp.eval(
      `(async () => { const f = app.vault.getAbstractFileByPath('FontBase.base'); const leaf = app.workspace.getLeaf('tab'); await leaf.openFile(f); app.workspace.setActiveLeaf(leaf, { focus: true }); await new Promise((resolve) => setTimeout(resolve, 1400)); return true; })()`
    );
    const baseFonts = JSON.parse(
      await cdp.eval(
        "JSON.stringify({ roots: document.querySelectorAll('.bases-view, .bases-embed').length, spans: document.querySelectorAll('.bases-view .langscape-font, .bases-embed .langscape-font').length, text: document.querySelector('.bases-view, .bases-embed')?.textContent?.slice(0, 200) ?? null })"
      )
    );
    await ensure(baseFonts.roots > 0, `The Bases view did not render: ${JSON.stringify(baseFonts)}`);
    await ensure(baseFonts.spans > 0, `Font spans were not decorated in Bases: ${JSON.stringify(baseFonts)}`);
    log(`bases font spans: ${JSON.stringify(baseFonts)}`);
    const baseEdit = JSON.parse(
      await cdp.eval(
        `(async () => { const ed = document.querySelector('.bases-view [contenteditable="true"]'); if (!ed) return 'null'; const before = ed.textContent; ed.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); ed.focus(); const during = ed.textContent; ed.blur(); await new Promise((resolve) => setTimeout(resolve, 600)); const fresh = document.querySelector('.bases-view [contenteditable="true"]'); const file = await app.vault.adapter.read('FontBase/Word.md'); return JSON.stringify({ before, during, after: fresh?.textContent ?? null, span: Boolean(fresh?.querySelector('.langscape-font')), source: fresh?.dataset.langscapeSource ?? null, file }); })()`
      )
    );
    await ensure(baseEdit.during.includes("{Noto-Sans-Gothic:"), `Bases edit did not restore markup: ${JSON.stringify(baseEdit)}`);
    await ensure(baseEdit.file.includes("{Noto-Sans-Gothic:"), `Bases saved the value without font markup: ${JSON.stringify(baseEdit)}`);
    await ensure(baseEdit.span, `Bases did not re-render the font span after blur: ${JSON.stringify(baseEdit)}`);
    log(`bases edit preserve: ${JSON.stringify(baseEdit)}`);
    await saveScreenshot(cdp, "bases-font.png");

    await cdp.eval(
      `(async () => { const f = app.vault.getAbstractFileByPath('Langscape Demo/Changes/Demo.lsc'); window.localStorage.setItem('langscape-lsc-side-width', '390'); for (const old of app.workspace.getLeavesOfType('langscape-sound-change')) old.detach(); const leaf = app.workspace.getLeaf('tab'); await leaf.openFile(f); app.workspace.setActiveLeaf(leaf, { focus: true }); return true; })()`
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const lsc = JSON.parse(
      await cdp.eval(
        "JSON.stringify({ type: app.workspace.getLeavesOfType('langscape-sound-change')[0]?.view?.getViewType(), status: document.querySelector('.langscape-validation-status')?.textContent, editor: !!document.querySelector('.langscape-sound-change .cm-editor') })"
      )
    );
    await ensure(lsc.type === "langscape-sound-change", "The .lsc file did not open in the editor.");
    await ensure(lsc.status === "Compiles", `Unexpected validation status: ${lsc.status}`);
    await ensure(
      !(await cdp.eval("Boolean(document.querySelector('.langscape-pane-header, .langscape-test-stats, .langscape-results-summary, .langscape-test-actions'))")),
      "A removed editor/test-bench element is still present."
    );
    const resizeStart = JSON.parse(
      await cdp.eval(
        `(() => { const v = app.workspace.getLeavesOfType('langscape-sound-change')[0].view; const side = v.contentEl.querySelector('.langscape-lsc-side'); const handle = v.contentEl.querySelector('.langscape-lsc-resizer'); if (!side || !handle) return 'null'; const rect = handle.getBoundingClientRect(); return JSON.stringify({ width: side.getBoundingClientRect().width, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }); })()`
      )
    );
    await ensure(resizeStart, "The sidebar resize handle was not found.");
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: resizeStart.x,
      y: resizeStart.y,
      button: "left",
      clickCount: 1,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: resizeStart.x + 45,
      y: resizeStart.y,
      button: "left",
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: resizeStart.x + 45,
      y: resizeStart.y,
      button: "left",
      clickCount: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const resizeEnd = await cdp.eval(
      `(() => { const v = app.workspace.getLeavesOfType('langscape-sound-change')[0].view; return v.contentEl.querySelector('.langscape-lsc-side')?.getBoundingClientRect().width ?? 0; })()`
    );
    await ensure(
      Math.abs(resizeEnd - resizeStart.width) > 20,
      `The sidebar did not resize: ${resizeStart.width} -> ${resizeEnd}`
    );
    log(`sidebar resize: ${Math.round(resizeStart.width)} -> ${Math.round(resizeEnd)}`);
    const paneWords = await cdp.eval(
      "(async () => { const v = app.workspace.getLeavesOfType('langscape-sound-change')[0].view; const ta = v.contentEl.querySelector('.langscape-words-input'); ta.value = 'apa\\neke\\npataka\\nkata\\npata'; ta.dispatchEvent(new Event('input', { bubbles: true })); v.contentEl.querySelector('.langscape-run-button').click(); await new Promise((resolve) => setTimeout(resolve, 2200)); return [...v.contentEl.querySelectorAll('.langscape-results-table tbody tr')].map((tr) => [...tr.cells].map((td) => td.textContent).join('|')); })()"
    );
    await ensure(paneWords.length === 5, `Test bench produced ${paneWords.length} rows.`);
    await ensure(
      paneWords[0].includes("ebe"),
      `Unexpected test bench output: ${paneWords[0]}`
    );
    const traceState = JSON.parse(
      await cdp.eval(
        `(() => { const v = app.workspace.getLeavesOfType('langscape-sound-change')[0].view; const trace = v.contentEl.querySelector('.langscape-trace'); const rows = [...v.contentEl.querySelectorAll('.langscape-trace-table tbody tr')].map((tr) => [...tr.cells].map((td) => td.textContent.trim())); return JSON.stringify({ hidden: trace?.classList.contains('is-hidden'), rows, pre: Boolean(v.contentEl.querySelector('.langscape-trace-pre')), checks: v.contentEl.querySelectorAll('.langscape-trace-check').length }); })()`
      )
    );
    await ensure(!traceState.hidden, "The trace table was hidden while tracing was enabled.");
    await ensure(!traceState.pre, "The old trace <pre> is still rendered.");
    await ensure(traceState.rows.length >= 2, `The trace table has no iterations: ${JSON.stringify(traceState)}`);
    await ensure(traceState.rows[0][0] === "Input", `The trace table is missing its input row: ${JSON.stringify(traceState)}`);
    await ensure(traceState.checks === 5, "The trace checkbox column is missing.");
    const multiTrace = JSON.parse(
      await cdp.eval(
        `(async () => { const v = app.workspace.getLeavesOfType('langscape-sound-change')[0].view; for (const box of v.contentEl.querySelectorAll('.langscape-trace-check')) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); } await new Promise((resolve) => setTimeout(resolve, 250)); const table = v.contentEl.querySelector('.langscape-trace-table'); return JSON.stringify({ headers: [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()), rows: [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map((td) => td.textContent.trim())), checked: [...v.contentEl.querySelectorAll('.langscape-trace-check')].filter((box) => box.checked).length }); })()`
      )
    );
    await ensure(multiTrace.checked === 5, "Tracing did not keep multiple words selected.");
    await ensure(multiTrace.headers.length === 6, `Expected five word columns: ${JSON.stringify(multiTrace)}`);
    await ensure(multiTrace.rows.every((row) => row.length === 6), "Trace rows do not have one cell per word.");
    const traceScroll = JSON.parse(
      await cdp.eval(
        `(() => { const v = app.workspace.getLeavesOfType('langscape-sound-change')[0].view; const scroller = v.contentEl.querySelector('.langscape-trace-scroll'); if (!scroller) return 'null'; const before = scroller.scrollLeft; scroller.scrollLeft = 120; return JSON.stringify({ clientWidth: scroller.clientWidth, scrollWidth: scroller.scrollWidth, scrollLeft: scroller.scrollLeft, before, background: getComputedStyle(scroller).overflowX }); })()`
      )
    );
    await ensure(
      traceScroll.scrollWidth > traceScroll.clientWidth,
      `The trace table does not overflow horizontally: ${JSON.stringify(traceScroll)}`
    );
    await ensure(traceScroll.scrollLeft > traceScroll.before, "The trace table could not scroll sideways.");
    log(`trace horizontal scroll: ${JSON.stringify(traceScroll)}`);
    log(`multi-word trace: ${JSON.stringify(multiTrace.headers)}`);
    const traceOff = await cdp.eval(
      `(async () => { const v = app.workspace.getLeavesOfType('langscape-sound-change')[0].view; const box = v.contentEl.querySelector('.langscape-options-row input[type="checkbox"]'); box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 250)); return v.contentEl.querySelector('.langscape-trace')?.classList.contains('is-hidden'); })()`
    );
    await ensure(traceOff, "The trace UI stayed visible after turning tracing off.");
    await cdp.eval(
      `(async () => { const v = app.workspace.getLeavesOfType('langscape-sound-change')[0].view; const box = v.contentEl.querySelector('.langscape-options-row input[type="checkbox"]'); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 250)); const side = v.contentEl.querySelector('.langscape-lsc-side'); side.scrollTop = side.scrollHeight; await new Promise((resolve) => setTimeout(resolve, 150)); return true; })()`
    );
    log(`vertical trace table: ${JSON.stringify(traceState.rows.slice(0, 4))}`);
    const scrollState = JSON.parse(
      await cdp.eval(
        `(() => { const v = app.workspace.getLeavesOfType('langscape-sound-change')[0].view; const side = v.contentEl.querySelector('.langscape-lsc-side'); const trace = v.contentEl.querySelector('.langscape-trace'); return JSON.stringify({ scrollTop: side?.scrollTop, scrollHeight: side?.scrollHeight, clientHeight: side?.clientHeight, traceTop: trace?.offsetTop }); })()`
      )
    );
    log(`trace scroll state: ${JSON.stringify(scrollState)}`);
    await saveScreenshot(cdp, "trace-table.png");
    const tokenColors = JSON.parse(
      await cdp.eval(
        "JSON.stringify(['keyword', 'ruleName', 'featureValue', 'operator', 'comment'].map((tag) => { const el = app.workspace.getLeavesOfType('langscape-sound-change')[0]?.view?.contentEl?.querySelector('.langscape-syntax-' + tag); return { tag, found: Boolean(el), color: el ? getComputedStyle(el).color : null }; }))"
      )
    );
    await ensure(
      tokenColors.every((token) => token.found),
      `Missing syntax token classes: ${JSON.stringify(tokenColors)}`
    );
    await ensure(
      new Set(tokenColors.map((token) => token.color)).size >= 3,
      `Syntax colours did not vary: ${JSON.stringify(tokenColors)}`
    );
    log(`syntax colours: ${JSON.stringify(tokenColors)}`);
    const editorAppearance = JSON.parse(
      await cdp.eval(
        `(async () => { const v = app.workspace.getLeavesOfType('langscape-sound-change')[0].view; v.editor.focus(); const side = v.contentEl.querySelector('.langscape-lsc-side'); if (side) side.scrollTop = 0; v.editor.view.dispatch({ selection: { anchor: 0, head: 12 } }); await new Promise((resolve) => setTimeout(resolve, 180)); const cursor = v.contentEl.querySelector('.cm-cursor'); const line = v.contentEl.querySelector('.cm-line'); const active = v.contentEl.querySelector('.cm-activeLine'); return JSON.stringify({ cursor: cursor ? getComputedStyle(cursor).borderLeftColor : null, text: line ? getComputedStyle(line).color : null, hasSelectionClass: v.contentEl.querySelector('.cm-editor')?.classList.contains('has-selection'), activeLine: active ? getComputedStyle(active).backgroundColor : null, dark: document.body.classList.contains('theme-dark') }); })()`
      )
    );
    await ensure(editorAppearance.cursor, "The editor cursor was not found.");
    await ensure(
      editorAppearance.dark ? editorAppearance.cursor !== "rgb(0, 0, 0)" : editorAppearance.cursor !== "rgb(255, 255, 255)",
      `Editor cursor has the wrong colour for the theme: ${editorAppearance.cursor}`
    );
    await ensure(
      editorAppearance.text && editorAppearance.text !== "rgb(0, 0, 0)",
      `Editor text is not using the theme colour: ${editorAppearance.text}`
    );
    await ensure(editorAppearance.hasSelectionClass, "The editor did not mark an active selection.");
    await ensure(
      editorAppearance.activeLine === "rgba(0, 0, 0, 0)" || editorAppearance.activeLine === "transparent",
      `The current-line highlight stayed visible during selection: ${editorAppearance.activeLine}`
    );
    log(`editor appearance: ${JSON.stringify(editorAppearance)}`);
    await saveScreenshot(cdp, "sound-change-editor.png");

    await cdp.eval(
      "(async () => { app.setting.open(); app.setting.openTabById('langscape'); await new Promise((resolve) => setTimeout(resolve, 800)); return true; })()"
    );
    const settingsText = await cdp.eval(
      "app.setting.activeTab?.containerEl?.innerText ?? ''"
    );
    await ensure(settingsText.includes("Install Lexurgy"), "Settings is missing the Lexurgy installer.");
    await ensure(!settingsText.includes("Canvas pipelines"), "Settings still has the old pipeline section.");
    await ensure(!settingsText.includes("Discover fonts automatically"), "Settings still has the old font discovery toggle.");
    await ensure(!settingsText.includes("Add a font"), "Settings still has the old Add a font section.");
    await ensure(!settingsText.includes("Starter vault"), "Settings still has the old demo section.");
    await cdp.eval("app.setting?.close?.(); true");

    await cdp.eval(
      `(async () => { const file = app.vault.getAbstractFileByPath('Langscape Demo/Changes/Demo.lsc'); const explorer = app.workspace.getLeavesOfType('file-explorer')[0]; await explorer?.view?.revealInFolder?.(file); await new Promise((resolve) => setTimeout(resolve, 500)); return true; })()`
    );
    const navDebug = await cdp.eval(
      "JSON.stringify([...document.querySelectorAll('.nav-file-title')].map((el) => ({ path: el.getAttribute('data-path'), text: el.textContent, tag: el.querySelector('.nav-file-tag')?.textContent })).slice(0, 20))"
    );
    log(`nav files: ${navDebug}`);
    const lscTag = JSON.parse(
      await cdp.eval(
        `(() => { const titles = [...document.querySelectorAll('.nav-file-title')]; const title = titles.find((el) => (el.getAttribute('data-path') || el.dataset.path || '').toLowerCase().endsWith('.lsc')) || titles.find((el) => /Demo\.lsc$/i.test(el.textContent || '')); const tag = title?.querySelector('.nav-file-tag'); return JSON.stringify({ path: title?.getAttribute('data-path') || null, text: tag?.textContent ?? null, after: tag ? getComputedStyle(tag, '::after').content : null }); })()`
      )
    );
    await ensure(lscTag.after?.includes("LEXURGY"), `The .lsc file tag was not changed: ${JSON.stringify(lscTag)}`);
    log(`lsc file tag: ${JSON.stringify(lscTag)}`);

    cdp.close();
    console.log("\nE2E PASS");
  } catch (error) {
    console.error(`\nE2E FAIL: ${error instanceof Error ? error.message : String(error)}`);
    console.error(logs.slice(-4000));
    process.exitCode = 1;
  } finally {
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
}

await main();
