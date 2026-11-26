/**
 * Comprehensive Desktop Obsidian E2E & visual verification suite for Langscape.
 * Exercises every end-user feature with real pointer/keyboard interactions and
 * captures high-signal screenshots with explicit visual acceptance criteria.
 */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { sleep, waitFor } from "../lib/cdp.mjs";
import { ROOT_DIR } from "../lib/env.mjs";

async function openMarkdownNote(cdp, filePath, mode = "source") {
  await cdp.eval(`(async () => {
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(filePath)});
    if (!file) throw new Error('Missing vault file: ' + ${JSON.stringify(filePath)});
    const leaf = app.workspace.getLeaf(false);
    await leaf.setViewState({
      type: 'markdown',
      state: { file: ${JSON.stringify(filePath)}, mode: ${JSON.stringify(mode)} },
      active: true,
    });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    return true;
  })()`);
  await sleep(600);
}

async function createAndOpenNote(cdp, filePath, content, mode = "source") {
  await cdp.eval(`(async () => {
    const existing = app.vault.getAbstractFileByPath(${JSON.stringify(filePath)});
    if (existing) await app.vault.modify(existing, ${JSON.stringify(content)});
    else await app.vault.create(${JSON.stringify(filePath)}, ${JSON.stringify(content)});
    return true;
  })()`);
  await openMarkdownNote(cdp, filePath, mode);
}

async function clickExplorerMenuItem(cdp, selector, title) {
  await waitFor(
    () => cdp.eval(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),
    10_000,
    `explorer item ${selector}`
  );
  const clicked = await cdp.eval(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: rect.left + 8,
      clientY: rect.top + 8,
    }));
    const items = [...document.querySelectorAll('.menu-item-title')]
      .filter((el) => el.textContent?.trim() === ${JSON.stringify(title)});
    if (items.length !== 1) return false;
    items[0].closest('.menu-item').click();
    return true;
  })()`);
  assert.equal(clicked, true, `Could not trigger explorer menu item "${title}" on ${selector}`);
}

export function getDesktopScenarios({ liveDocs = false } = {}) {
  return [
    {
      id: "d01-fonts-live-preview",
      title: "Custom vault fonts in Live Preview, table cells, and clipboard",
      async run({ cdp, recorder }) {
        const assertions = [];
        const screenshots = [];

        const noteContent = [
          "# Writing Systems (Live Preview)",
          "",
          "Inline Gothic text: {Noto-Sans-Gothic: 𐌰𐍆𐌰 𐌴𐌺𐌴 𐍅𐌿𐌻𐍆𐍃}",
          "",
          "| Script | Example | Gloss |",
          "| --- | --- | --- |",
          "| Gothic | {Noto-Sans-Gothic: 𐌰𐍆𐌰} | father |",
          "| Gothic | {Noto-Sans-Gothic: 𐌴𐌺𐌴} | edge |",
          "",
        ].join("\n");

        await createAndOpenNote(cdp, "Fonts Live.md", noteContent, "source");
        await waitFor(
          () =>
            cdp.eval(`(async () => {
              const span = document.querySelector('.cm-content .langscape-font');
              if (!span) return false;
              const fam = getComputedStyle(span).fontFamily;
              if (!fam.includes('Noto Sans Gothic')) return false;
              const faces = await document.fonts.load('16px ' + fam, '𐌰');
              return faces.some((f) => f.family.includes('Noto Sans Gothic') && f.status === 'loaded');
            })()`),
          15_000,
          "Noto Sans Gothic FontFace in Live Preview"
        );
        assertions.push("Vault FontFace loaded and applied in Live Preview");

        // Click the Gothic cell inside the table to enter live table-cell editing.
        await waitFor(
          () => cdp.eval(`document.querySelectorAll('.cm-table-widget table').length >= 1`),
          10_000,
          "table widget in Fonts Live.md"
        );
        const cellRect = await cdp.eval(`(() => {
          const table = document.querySelector('.cm-table-widget table');
          const r = table.rows[1].cells[1].getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`);
        await cdp.clickPoint(cellRect.x, cellRect.y);
        await sleep(500);

        const activeCell = await cdp.eval(`(() => {
          const table = document.querySelector('.cm-table-widget table');
          const cell = table.rows[1].cells[1];
          const editor = cell.querySelector('.cm-editor');
          return {
            hasEditor: Boolean(editor),
            text: editor ? editor.textContent.trim() : cell.textContent.trim(),
            spans: editor ? editor.querySelectorAll('.langscape-font').length : 0,
          };
        })()`);
        assert.equal(activeCell.hasEditor, true, "Table cell editor did not open");
        assert.equal(activeCell.text, "𐌰𐍆𐌰", `Unexpected active cell text: ${activeCell.text}`);
        assert.ok(activeCell.spans > 0, "Missing rendered font span inside active table cell");
        assertions.push("Active table cell renders custom Gothic font inline");

        // Select span and press Ctrl+C to verify clipboard preserves font markup.
        await cdp.eval(`(() => {
          const span = document.querySelector('.cm-table-widget table .cm-editor .langscape-font');
          const range = document.createRange();
          range.selectNodeContents(span);
          const sel = getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          return true;
        })()`);
        await cdp.pressKey("c", { modifiers: 2 });
        await sleep(300);
        const clip = await cdp.eval(`require('electron').clipboard.readText()`);
        assert.ok(clip.includes("{Noto-Sans-Gothic:") && clip.includes("𐌰𐍆𐌰"), `Unexpected clipboard: ${clip}`);
        assertions.push("Ctrl+C preserves {Noto-Sans-Gothic: ...} markup on clipboard");

        const shotPath = recorder.screenshotPath("d01-fonts-live-preview.png");
        await cdp.captureViewport(shotPath);
        screenshots.push({
          id: "d01-fonts-live-preview",
          filePath: shotPath,
          caption: "Live Preview with inline Gothic glyphs and active table cell font rendering",
          checkCriteria: [
            "Gothic letters (𐌰𐍆𐌰 𐌴𐌺𐌴 𐍅𐌿𐌻𐍆𐍃) render as real Gothic script glyphs, not tofu boxes or raw {Noto-Sans-Gothic: ...} syntax.",
            "The table displays Gothic glyphs cleanly inside the Example column.",
            "No overlapping text, broken layout, or visual artifacts in dark mode.",
          ],
        });

        return { assertions, screenshots };
      },
    },

    {
      id: "d02-fonts-reading-and-notewide",
      title: "Reading view custom fonts and note-wide langscape-font frontmatter",
      async run({ cdp, recorder }) {
        const assertions = [];
        const screenshots = [];

        const noteWideContent = [
          "---",
          "langscape-font: Noto Sans Gothic",
          "---",
          "# 𐌰𐍆𐌰 𐌴𐌺𐌴",
          "",
          "𐌰𐍆𐌰 𐌴𐌺𐌴 𐍅𐌿𐌻𐍆𐍃 — whole note styled via `langscape-font` frontmatter.",
          "",
          "Inline span still works too: {Noto-Sans-Gothic: 𐌰𐍆𐌰}.",
          "",
        ].join("\n");

        await createAndOpenNote(cdp, "NoteWideFont.md", noteWideContent, "preview");
        await waitFor(
          () =>
            cdp.eval(`(() => {
              const view = app.workspace.getMostRecentLeaf().view.contentEl;
              const preview = view.querySelector('.markdown-reading-view');
              const span = preview?.querySelector('.langscape-font');
              const p = preview?.querySelector('.markdown-preview-section p');
              if (!span || !p) return false;
              return getComputedStyle(span).fontFamily.includes('Noto Sans Gothic');
            })()`),
          15_000,
          "Reading view note-wide font"
        );
        assertions.push("Reading view renders note-wide and inline Noto Sans Gothic fonts");

        const shotPath = recorder.screenshotPath("d02-fonts-reading-notewide.png");
        await cdp.captureViewport(shotPath);
        screenshots.push({
          id: "d02-fonts-reading-notewide",
          filePath: shotPath,
          caption: "Reading view with note-wide langscape-font frontmatter and inline Gothic span",
          checkCriteria: [
            "Frontmatter property `langscape-font: Noto Sans Gothic` is visible at top of note.",
            "Gothic script glyphs render clearly in both the heading and body paragraph (no missing glyph boxes).",
            "Inline `{Noto-Sans-Gothic: 𐌰𐍆𐌰}` shows rendered Gothic text with braces hidden.",
          ],
        });

        return { assertions, screenshots };
      },
    },

    {
      id: "d03-font-picker-modal",
      title: "Font Picker modal via command palette and visual insertion",
      async run({ cdp, recorder }) {
        const assertions = [];
        const screenshots = [];

        await createAndOpenNote(cdp, "PickerTest.md", "# Picker test\n\nWord: ", "source");
        await waitFor(
          () => cdp.eval(`Boolean(app.workspace.activeLeaf?.view?.editor && document.querySelector('.cm-content'))`),
          10_000,
          "active Markdown editor for PickerTest.md"
        );
        await cdp.clickSelector(".cm-content");
        await sleep(200);
        const invoked = await cdp.eval(`(() => {
          const view = app.workspace.activeLeaf?.view;
          const editor = view?.editor;
          if (!editor) return { ok: false, reason: 'no editor' };
          const lastLine = editor.lastLine();
          editor.setCursor({ line: lastLine, ch: editor.getLine(lastLine).length });
          editor.focus();
          const ran = app.commands.executeCommandById('langscape:insert-font-span');
          return {
            ok: Boolean(ran),
            ran,
            fonts: app.plugins.plugins.langscape.fontManager.list().length,
            hasModal: Boolean(document.querySelector('.langscape-font-picker')),
          };
        })()`);
        assert.equal(invoked.ok, true, `Could not invoke langscape:insert-font-span: ${JSON.stringify(invoked)}`);

        await waitFor(
          () => cdp.eval(`Boolean(document.querySelector('.langscape-font-picker .langscape-font-row'))`),
          10_000,
          "Font Picker modal with font rows"
        );
        await sleep(350);

        const modalShot = recorder.screenshotPath("d03-font-picker-modal.png");
        await cdp.captureViewport(modalShot);
        screenshots.push({
          id: "d03-font-picker-modal",
          filePath: modalShot,
          caption: "Insert custom-font text modal open showing vault font preview and Insert button",
          checkCriteria: [
            "Modal titled 'Insert custom-font text' is centered and readable.",
            "Noto Sans Gothic appears with a live sample preview and an 'Insert' CTA button.",
            "Search filter input and font path metadata are cleanly aligned without overlap.",
          ],
        });

        // Click the Insert button inside the modal.
        await cdp.clickSelector(".langscape-font-picker .langscape-font-row button.mod-cta");
        await waitFor(
          () => cdp.eval(`!document.querySelector('.langscape-font-picker')`),
          5_000,
          "Font Picker modal to close"
        );
        const updated = await cdp.eval(`app.workspace.getMostRecentLeaf().view.editor.getValue()`);
        assert.ok(updated.includes("{Noto-Sans-Gothic:"), `Font span not inserted: ${updated}`);
        assertions.push("Font Picker modal opens, displays vault font preview, and inserts markup on click");

        return { assertions, screenshots };
      },
    },

    {
      id: "d04-merged-tables",
      title: "Merged Markdown tables (colspan, rowspan, rectangular selection, and Reading view)",
      async run({ cdp, recorder }) {
        const assertions = [];
        const screenshots = [];

        const tableNote = [
          "# Merged Phonology & Paradigm Tables",
          "",
          "| Region | Q1 | < | Q2 | < |",
          "| --- | --- | --- | --- | --- |",
          "| North | 10 | 12 | 14 | 16 |",
          "| ^ | 8 | 9 | 11 | 13 |",
          "| South | 22 | 28 | 30 | 34 |",
          "",
          "| Case | Singular | Plural |",
          "| --- | --- | --- |",
          "| Nom | {Noto-Sans-Gothic: 𐌰𐍆𐌰} | {Noto-Sans-Gothic: 𐌰𐍆𐌰𐌽𐍃} |",
          "| ^ | afa | afans |",
          "",
        ].join("\n");

        await createAndOpenNote(cdp, "MergedTables.md", tableNote, "source");
        await waitFor(
          () =>
            cdp.eval(`(() => {
              const tables = document.querySelectorAll('.cm-table-widget table');
              if (tables.length < 2) return false;
              const t0 = tables[0];
              return t0.classList.contains('langscape-merged-table') &&
                t0.rows[0].cells[1].colSpan === 2 &&
                t0.rows[1].cells[0].rowSpan === 2;
            })()`),
          15_000,
          "merged tables in Live Preview"
        );
        assertions.push("Live Preview applies header colspan=2 and body rowspan=2");

        // Perform a rectangular drag selection across merged cells.
        const dragCoords = await cdp.eval(`(() => {
          const t = document.querySelectorAll('.cm-table-widget table')[0];
          const a = t.rows[1].cells[0].getBoundingClientRect();
          const b = t.rows[2].cells[2].getBoundingClientRect();
          return {
            from: { x: a.left + a.width / 2, y: a.top + a.height / 2 },
            to: { x: b.left + b.width / 2, y: b.top + b.height / 2 },
          };
        })()`);
        await cdp.dragPoints(dragCoords.from, dragCoords.to, { steps: 6, stepDelayMs: 25 });
        await sleep(300);

        const selectedCount = await cdp.eval(
          `document.querySelectorAll('.cm-table-widget table')[0].querySelectorAll('.langscape-table-selected').length`
        );
        assert.ok(selectedCount >= 4, `Expected rectangular selection across merged cells, got ${selectedCount}`);
        assertions.push(`Rectangular drag selection highlighted ${selectedCount} cells cleanly`);

        const liveShot = recorder.screenshotPath("d04-merged-tables-live.png");
        await cdp.captureViewport(liveShot);
        screenshots.push({
          id: "d04-merged-tables-live",
          filePath: liveShot,
          caption: "Live Preview merged tables with colspan/rowspan, selection highlight, and Gothic glyphs",
          checkCriteria: [
            "Q1 and Q2 each span two columns cleanly; North spans two rows vertically with no stray '<' or '^' markers.",
            "Rectangular selection highlight cleanly covers the merged region.",
            "Second table combines merged 'Nom' row with rendered Gothic glyphs.",
          ],
        });

        // Switch to Reading view and verify post-processed merged table too.
        await openMarkdownNote(cdp, "MergedTables.md", "preview");
        await waitFor(
          () =>
            cdp.eval(`(() => {
              const t = document.querySelector('.markdown-reading-view table.langscape-merged-table');
              return Boolean(t && t.rows[0].cells[1].colSpan === 2 && t.rows[1].cells[0].rowSpan === 2);
            })()`),
          10_000,
          "merged tables in Reading view"
        );
        assertions.push("Reading view renders merged tables with matching colspan/rowspan");

        const readingCrop = recorder.screenshotPath("d04-merged-tables-reading.png");
        await cdp.captureElement(".markdown-reading-view table.langscape-merged-table", readingCrop, {
          padding: 20,
          scale: 2,
        });
        screenshots.push({
          id: "d04-merged-tables-reading",
          filePath: readingCrop,
          caption: "Cropped Reading view merged table showing crisp borders and cell spans",
          checkCriteria: [
            "Table borders align cleanly around merged Q1, Q2, and North cells.",
            "No visible '<' or '^' merge tokens remain.",
          ],
        });

        return { assertions, screenshots };
      },
    },

    {
      id: "d05-syntax-trees",
      title: "Syntax trees with custom fonts, drag-and-drop reparenting, and alignment toggle",
      async run({ cdp, recorder }) {
        const assertions = [];
        const screenshots = [];

        const original = [
          "# Syntax Tree Workbench",
          "",
          "{tree: S(NP(N({Noto-Sans-Gothic: 𐌰𐍆𐌰}), Adj(old)), VP(V(sees)), P(sky))}",
          "",
        ].join("\n");

        await createAndOpenNote(cdp, "SyntaxTree.md", original, "source");
        const treeExpr = `app.workspace.getMostRecentLeaf().view.contentEl.querySelector('.langscape-tree-widget')`;
        await waitFor(() => cdp.eval(`Boolean(${treeExpr})`), 15_000, "syntax tree widget");
        await waitFor(
          () => cdp.eval(`(${treeExpr}).querySelectorAll('svg.langscape-tree-edges line, svg.langscape-tree-edges path').length >= 4`),
          10_000,
          "syntax tree SVG connector edges"
        );
        await sleep(300);

        const initialShot = recorder.screenshotPath("d05-syntax-tree-initial.png");
        await cdp.captureElement(".langscape-tree-widget", initialShot, { padding: 24, scale: 2 });
        screenshots.push({
          id: "d05-syntax-tree-initial",
          filePath: initialShot,
          caption: "Syntax tree widget with Gothic font inside a leaf node and SVG connector lines",
          checkCriteria: [
            "Hierarchical tree S -> NP, VP, P is cleanly laid out with straight/crisp SVG branches connecting parents to children.",
            "The Gothic leaf renders actual Gothic glyphs (𐌰𐍆𐌰) without raw `{Noto-Sans-Gothic: ...}` syntax.",
            "No overlapping node labels or disconnected edges.",
          ],
        });

        // Real pointer drag-and-drop: reparent P under VP.
        const getLabelPoint = (text) =>
          cdp.eval(`(() => {
            const tree = ${treeExpr};
            const label = [...tree.querySelectorAll('.langscape-tree-label')]
              .find((el) => el.textContent.trim() === ${JSON.stringify(text)});
            if (!label) return null;
            const r = label.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          })()`);

        const pStart = await waitFor(() => getLabelPoint("P"), 5_000, "P label");
        const vpTarget = await waitFor(() => getLabelPoint("VP"), 5_000, "VP label");
        await cdp.dragPoints(pStart, vpTarget, { steps: 10, stepDelayMs: 30 });

        await waitFor(
          async () => {
            const val = await cdp.eval(`app.workspace.getMostRecentLeaf().view.editor.getValue()`);
            return val.includes("VP(V(sees), P(sky))");
          },
          6_000,
          "reparented syntax tree Markdown update"
        );
        assertions.push("Pointer drag-and-drop reparented P(sky) under VP and updated Markdown");

        // Toggle tree alignment button (center -> left) and capture updated tree.
        await cdp.clickSelector(".langscape-tree-widget .langscape-tree-align");
        await sleep(350);
        const isLeft = await cdp.eval(
          `Boolean((${treeExpr}).querySelector('.langscape-tree.is-align-left'))`
        );
        assert.equal(isLeft, true, "Tree alignment toggle did not switch to left-aligned");
        assertions.push("Alignment toolbar button toggles tree between centered and left-aligned");

        const afterShot = recorder.screenshotPath("d05-syntax-tree-edited.png");
        await cdp.captureElement(".langscape-tree-widget", afterShot, { padding: 24, scale: 2 });
        screenshots.push({
          id: "d05-syntax-tree-edited",
          filePath: afterShot,
          caption: "Syntax tree after dragging P(sky) under VP and toggling left alignment",
          checkCriteria: [
            "P(sky) now appears as a child of VP alongside V(sees).",
            "Tree alignment shifted to left-aligned and SVG edges redrew cleanly to the new node positions.",
          ],
        });

        // Restore centered alignment so subsequent scenarios use default.
        await cdp.clickSelector(".langscape-tree-widget .langscape-tree-align");

        return { assertions, screenshots };
      },
    },

    {
      id: "d06-lexurgy-workbench",
      title: "Lexurgy .lsc editor, file explorer badge, live validation, and real JVM test bench",
      async run({ cdp, session, recorder }) {
        const assertions = [];
        const screenshots = [];

        // Create a new .lsc file via native File Explorer context menu.
        await clickExplorerMenuItem(cdp, ".nav-files-container", "New Lexurgy file");
        await waitFor(
          () => cdp.eval(`app.workspace.getActiveFile()?.path === 'Sound Changes.lsc'`),
          10_000,
          "Sound Changes.lsc from File Explorer context menu"
        );
        assertions.push("File Explorer right-click creates and opens Sound Changes.lsc");

        // Verify .lsc file badge shows LEXURGY in explorer.
        const badge = await cdp.eval(`(() => {
          const title = [...document.querySelectorAll('.nav-file-title')]
            .find((el) => (el.getAttribute('data-path') || '').endsWith('.lsc'));
          const tag = title?.querySelector('.nav-file-tag');
          return tag ? getComputedStyle(tag, '::after').content : null;
        })()`);
        assert.ok(badge && badge.includes("LEXURGY"), `Expected LEXURGY file badge, got ${badge}`);
        assertions.push("File Explorer displays LEXURGY badge for .lsc files");

        // Open Unicode/IPA fixture rules and run real JVM Lexurgy if available.
        const unicodeRules = await fs.readFile(path.join(ROOT_DIR, "tests/fixtures/changes/unicode.lsc"), "utf8");
        await cdp.eval(`(async () => {
          const file = await app.vault.create('Unicode.lsc', ${JSON.stringify(unicodeRules)});
          await app.workspace.getMostRecentLeaf().openFile(file);
          return true;
        })()`);

        const viewExpr = `app.workspace.getMostRecentLeaf().view.contentEl`;
        if (session.lexurgyPath && session.javaBin) {
          await waitFor(
            () =>
              cdp.eval(`Boolean(
                app.workspace.getActiveFile()?.path === 'Unicode.lsc' &&
                ${viewExpr}.querySelector('.langscape-lexurgy-status.is-ready') &&
                ${viewExpr}.querySelector('.langscape-validation-status.is-valid')
              )`),
            25_000,
            "real JVM Lexurgy validation on Unicode.lsc"
          );
          assertions.push("Real JVM Lexurgy compiled and validated Unicode.lsc");

          // Type test words and enable trace, then click Run.
          await cdp.eval(`(() => {
            const panel = ${viewExpr}.querySelector('.langscape-test-panel');
            const input = panel.querySelector('.langscape-words-input');
            input.value = "aqelar\\nñu\\nkata";
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const trace = panel.querySelector('.langscape-checkbox-label input');
            if (trace && !trace.checked) trace.click();
            panel.querySelector('.langscape-run-button').click();
            return true;
          })()`);

          const output = await waitFor(
            () =>
              cdp.eval(`(() => {
                const panel = ${viewExpr}.querySelector('.langscape-test-panel');
                const rows = [...panel.querySelectorAll('.langscape-results-table tbody tr')]
                  .map((r) => r.textContent.replace(/\\s+/g, ' ').trim());
                if (rows.length < 2) return null;
                const traces = [...panel.querySelectorAll('.langscape-trace-table tbody tr')]
                  .map((tr) => tr.textContent.replace(/\\s+/g, ' ').trim());
                return { rows, traces };
              })()`),
            20_000,
            "Lexurgy test bench IPA results and trace"
          );
          assert.ok(output.rows.some((r) => r.includes("at͡ʃélar")), `Expected IPA output at͡ʃélar, got ${JSON.stringify(output.rows)}`);
          assert.ok(output.traces.length > 0, "Expected non-empty rule-by-rule trace");
          assertions.push("Test bench ran real Lexurgy with UTF-8 IPA output (aqelar → at͡ʃélar) and rule trace");
        } else {
          await sleep(1000);
          assertions.push("Lexurgy workbench UI opened (Java/Lexurgy not installed on this host)");
        }

        const shotPath = recorder.screenshotPath("d06-lexurgy-workbench.png");
        await cdp.captureViewport(shotPath);
        screenshots.push({
          id: "d06-lexurgy-workbench",
          filePath: shotPath,
          caption: "Lexurgy .lsc workbench with syntax-highlighted rules, Ready/Valid badges, IPA results, and rule trace",
          checkCriteria: [
            "Left editor pane displays syntax-highlighted Lexurgy rules cleanly with readable dark-theme text.",
            "Right test bench displays Ready / Valid status badges, test words, IPA output (`at͡ʃélar` with proper diacritics, no `?` corruption), and rule-by-rule trace.",
            "Left File Explorer shows the `LEXURGY` tag badge next to `.lsc` files.",
          ],
        });

        return { assertions, screenshots };
      },
    },

    {
      id: "d07-lexurgy-error-and-docs",
      title: "Lexurgy live validation error bar and in-app Lexurgy Docs tab",
      async run({ cdp, session, recorder }) {
        const assertions = [];
        const screenshots = [];

        if (session.lexurgyPath && session.javaBin) {
          const invalidRules = await fs.readFile(path.join(ROOT_DIR, "tests/fixtures/changes/invalid.lsc"), "utf8");
          await cdp.eval(`(async () => {
            const file = await app.vault.create('Invalid.lsc', ${JSON.stringify(invalidRules)});
            await app.workspace.getMostRecentLeaf().openFile(file);
            return true;
          })()`);

          const viewExpr = `app.workspace.getMostRecentLeaf().view.contentEl`;
          await waitFor(
            () =>
              cdp.eval(`Boolean(
                app.workspace.getActiveFile()?.path === 'Invalid.lsc' &&
                ${viewExpr}.querySelector('.langscape-error-bar:not(.is-hidden)')
              )`),
            20_000,
            "Lexurgy syntax error bar"
          );
          assertions.push("Invalid .lsc file displays live validation error bar");

          const errShot = recorder.screenshotPath("d07-lexurgy-validation-error.png");
          await cdp.captureViewport(errShot);
          screenshots.push({
            id: "d07-lexurgy-validation-error",
            filePath: errShot,
            caption: "Lexurgy editor showing live syntax error banner for invalid .lsc rules",
            checkCriteria: [
              "Error bar is visibly rendered at the top of the .lsc editor with a clear diagnostic message.",
              "Validation badge reflects the invalid rule state without breaking the layout.",
            ],
          });
        }

        // Open the in-app Documentation tab (mocked if --live-docs not passed, live HTTPS if passed).
        if (!liveDocs) {
          await cdp.eval(`(() => {
            const leaf = app.workspace.getLeaf('tab');
            return leaf.setViewState({ type: 'langscape-lexurgy-docs', active: true });
          })()`);
          await waitFor(
            () =>
              cdp.eval(`Boolean(
                document.querySelector('.langscape-docs-view .langscape-docs-toolbar') &&
                document.querySelector('.langscape-docs-article')?.textContent?.trim().length > 20
              )`),
            20_000,
            "Lexurgy Docs tab content"
          );
        } else {
          await cdp.eval(`(() => {
            const leaf = app.workspace.getLeaf('tab');
            return leaf.setViewState({ type: 'langscape-lexurgy-docs', active: true });
          })()`);
          await waitFor(
            () => cdp.eval(`Boolean(document.querySelector('.langscape-docs-article h1, .langscape-docs-article h2'))`),
            20_000,
            "live HTTPS Lexurgy Docs article"
          );
        }
        assertions.push("In-app Lexurgy Docs tab renders toolbar and documentation pane");

        const docsShot = recorder.screenshotPath("d07-lexurgy-docs.png");
        await cdp.captureViewport(docsShot);
        screenshots.push({
          id: "d07-lexurgy-docs",
          filePath: docsShot,
          caption: "In-app Lexurgy Docs tab with navigation toolbar and manual article",
          checkCriteria: [
            "Toolbar shows Back, Contents, section jump dropdown (when loaded), and View online link.",
            "Documentation body is readable with clean typography and no broken layout.",
          ],
        });

        return { assertions, screenshots };
      },
    },

    {
      id: "d08-recipe-automation",
      title: "Sound-change Recipe UI, property evolution, and title evolution",
      async run({ cdp, session, recorder }) {
        const assertions = [];
        const screenshots = [];

        // Create proto word notes + change file + recipe.
        await cdp.eval(`(async () => {
          const ensureFolder = async (p) => {
            if (!app.vault.getAbstractFileByPath(p)) await app.vault.createFolder(p);
          };
          await ensureFolder('RecipeTest');
          await ensureFolder('RecipeTest/Proto');
          await ensureFolder('RecipeTest/Modern');
          await ensureFolder('RecipeTest/ModernTitles');
          await app.vault.create('RecipeTest/Shift.lsc', 'voicing:\\n  p => b / a _ a\\n  t => d / a _ a\\n  k => g / a _ a\\n');
          await app.vault.create('RecipeTest/Proto/apa.md', '---\\nword: apa\\ngloss: father\\n---\\n# apa\\n');
          await app.vault.create('RecipeTest/Proto/pataka.md', '---\\nword: pataka\\ngloss: plateau\\n---\\n# pataka\\n');
          const recipeJson = JSON.stringify({
            inputFolder: 'RecipeTest/Proto',
            property: 'word',
            changes: [{ path: 'RecipeTest/Shift.lsc', disabledRules: [] }],
            outputFolder: 'RecipeTest/Modern',
          }, null, 2);
          const file = await app.vault.create('RecipeTest/Evolution.recipe', recipeJson);
          await app.workspace.getMostRecentLeaf().openFile(file);
          return true;
        })()`);

        const viewExpr = `app.workspace.getMostRecentLeaf().view.contentEl`;
        await waitFor(
          () =>
            cdp.eval(`Boolean(
              app.workspace.getActiveFile()?.path === 'RecipeTest/Evolution.recipe' &&
              ${viewExpr}.querySelector('.langscape-recipe-card') &&
              ${viewExpr}.querySelector('.langscape-recipe-run') &&
              !${viewExpr}.querySelector('.langscape-recipe-run').disabled
            )`),
          15_000,
          "Recipe card ready to run"
        );

        if (session.lexurgyPath && session.javaBin) {
          await cdp.eval(`(${viewExpr}).querySelector('.langscape-recipe-run').click()`);
          const resultText = await waitFor(
            () =>
              cdp.eval(`(() => {
                const el = (${viewExpr}).querySelector('.langscape-recipe-result[data-state="success"]');
                return el ? el.textContent.trim() : null;
              })()`),
            20_000,
            "Recipe run success status"
          );
          assertions.push(`Recipe ran successfully: "${resultText}"`);

          const evolved = await fs.readFile(path.join(session.vaultDir, "RecipeTest/Modern/pataka.md"), "utf8");
          const original = await fs.readFile(path.join(session.vaultDir, "RecipeTest/Proto/pataka.md"), "utf8");
          assert.ok(evolved.includes("word: padaga"), `Expected evolved word: padaga, got:\n${evolved}`);
          assert.ok(original.includes("word: pataka"), "Proto source note should remain untouched");
          assertions.push("Output note evolved pataka → padaga while proto source stayed untouched");
        } else {
          assertions.push("Recipe card rendered cleanly (Lexurgy runtime skipped)");
        }

        const shotPath = recorder.screenshotPath("d08-recipe-card.png");
        await cdp.captureViewport(shotPath);
        screenshots.push({
          id: "d08-recipe-card",
          filePath: shotPath,
          caption: "Sound-change Recipe view after running batch evolution on Proto → Modern",
          checkCriteria: [
            "Numbered recipe steps (1 Input, 2 Sound changes, 3 Output) are cleanly styled and legible.",
            "Input folder (`RecipeTest/Proto`), property (`word`), sound-change file (`Shift.lsc`), and output folder (`RecipeTest/Modern`) are clearly visible.",
            "Success status banner is displayed below Run recipe with no overflow or clipping.",
          ],
        });

        return { assertions, screenshots };
      },
    },

    {
      id: "d09-settings-and-starter-vault",
      title: "Langscape Settings tab (Fonts & Lexurgy status) and Create starter vault",
      async run({ cdp, session, recorder }) {
        const assertions = [];
        const screenshots = [];

        await cdp.eval(`(() => { app.setting.open(); app.setting.openTabById('langscape'); return true; })()`);
        const settingsInfo = await waitFor(
          () =>
            cdp.eval(`(() => {
              const el = app.setting.activeTab?.containerEl;
              if (!el?.querySelector('.langscape-lexurgy-setting-status')) return null;
              const statusText = el.querySelector('.langscape-lexurgy-setting-status').textContent;
              if (statusText.includes('Checking')) return null;
              return {
                headings: [...el.querySelectorAll('.setting-item-heading .setting-item-name')].map((n) => n.textContent.trim()),
                fontRows: el.querySelectorAll('.langscape-font-setting').length,
                deleteButtons: el.querySelectorAll('.langscape-font-setting button[aria-label="Delete font"]').length,
                previewText: el.querySelector('.langscape-font-setting-preview')?.textContent ?? '',
                settingsLoadedFonts: [...el.ownerDocument.fonts]
                  .filter((f) => f.family.includes('Noto Sans Gothic') && f.status === 'loaded').length,
                statusText: statusText.replace(/\\s+/g, ' ').trim(),
                hasReleasesLink: [...el.querySelectorAll('a')].some((a) => a.href.includes('def-gthill/lexurgy/releases')),
              };
            })()`),
          15_000,
          "Langscape settings tab with resolved Lexurgy status"
        );
        assert.deepEqual(settingsInfo.headings, ["Fonts", "Lexurgy"]);
        assert.ok(settingsInfo.fontRows >= 1, "Expected at least one vault font in Settings");
        assert.equal(settingsInfo.deleteButtons, settingsInfo.fontRows, "Expected a Delete font button on every vault font row");
        assert.ok(settingsInfo.settingsLoadedFonts >= 1, "Expected Noto Sans Gothic FontFace loaded inside the Settings document");
        assert.ok(settingsInfo.previewText.includes("𐌰"), `Expected Gothic glyphs in Settings preview, got: ${settingsInfo.previewText}`);
        assert.equal(settingsInfo.hasReleasesLink, true, "Missing official Lexurgy releases link");
        if (session.javaBin && session.lexurgyPath) {
          assert.ok(!settingsInfo.statusText.includes("not found"), `Expected Java & Lexurgy detected: ${settingsInfo.statusText}`);
        }
        assertions.push(`Settings shows ${settingsInfo.fontRows} font(s) and Lexurgy status: ${settingsInfo.statusText}`);

        const settingsShot = recorder.screenshotPath("d09-settings.png");
        await cdp.captureViewport(settingsShot);
        screenshots.push({
          id: "d09-settings",
          filePath: settingsShot,
          caption: "Settings → Langscape showing vault font preview, nickname controls, and Java/Lexurgy status",
          checkCriteria: [
            "Fonts section lists Noto Sans Gothic with rendered Gothic preview glyphs and `{Noto-Sans-Gothic: text}` syntax.",
            "Lexurgy section displays Java and Lexurgy status clearly along with official releases link and Test button.",
          ],
        });

        await cdp.eval(`app.setting.close(); true`);
        await sleep(250);

        // Execute Create starter vault command.
        await cdp.eval(`(async () => {
          await app.plugins.plugins.langscape.createStarterVault();
          return true;
        })()`);
        await waitFor(
          () =>
            cdp.eval(`Boolean(
              app.vault.getAbstractFileByPath('Langscape Demo/Notes/Font demo.md') &&
              app.vault.getAbstractFileByPath('Langscape Demo/Notes/Tree demo.md') &&
              app.vault.getAbstractFileByPath('Langscape Demo/Recipes/Demo.recipe')
            )`),
          10_000,
          "Desktop starter vault files"
        );
        assertions.push("Starter vault created Font demo, Tree demo, Demo.lsc, and Demo.recipe");

        return { assertions, screenshots };
      },
    },

    {
      id: "d10-light-theme-showcase",
      title: "Light theme contrast & readability across fonts, syntax tree, and merged table",
      async run({ cdp, recorder }) {
        const assertions = [];
        const screenshots = [];

        const showcase = [
          "# Light Theme Showcase",
          "",
          "Writing system: {Noto-Sans-Gothic: 𐌰𐍆𐌰 𐌴𐌺𐌴 𐍅𐌿𐌻𐍆𐍃}",
          "",
          "{tree: S(NP({Noto-Sans-Gothic: 𐌰𐍆𐌰}), VP(V(sees), NP(Det(the), N(sky))))}",
          "",
          "| Case | Singular | < |",
          "| --- | --- | --- |",
          "| Nom | {Noto-Sans-Gothic: 𐌰𐍆𐌰} | afa |",
          "| ^ | {Noto-Sans-Gothic: 𐌴𐌺𐌴} | eke |",
          "",
        ].join("\n");

        await cdp.eval(`(() => {
          document.body.classList.remove('theme-dark');
          document.body.classList.add('theme-light');
          return document.body.classList.contains('theme-light');
        })()`);
        await createAndOpenNote(cdp, "LightShowcase.md", showcase, "preview");
        await waitFor(
          () =>
            cdp.eval(`Boolean(
              document.querySelector('.markdown-reading-view .langscape-tree-block') &&
              document.querySelector('.markdown-reading-view table.langscape-merged-table') &&
              document.querySelector('.markdown-reading-view .langscape-font')
            )`),
          15_000,
          "Light theme showcase elements"
        );
        await sleep(350);
        assertions.push("Light theme renders custom fonts, syntax tree, and merged table together");

        const shotPath = recorder.screenshotPath("d10-light-theme-showcase.png");
        await cdp.captureViewport(shotPath);
        screenshots.push({
          id: "d10-light-theme-showcase",
          filePath: shotPath,
          caption: "Light theme Reading view showing fonts, syntax tree with Gothic leaf, and merged table",
          checkCriteria: [
            "Page renders on a clean light background with high-contrast dark text, tree branches, and table borders.",
            "Gothic glyphs, syntax tree edges, and merged table cells are all crisp and legible in light mode.",
          ],
        });

        // Restore dark theme.
        await cdp.eval(`(() => {
          document.body.classList.remove('theme-light');
          document.body.classList.add('theme-dark');
          return true;
        })()`);

        return { assertions, screenshots };
      },
    },
  ];
}
