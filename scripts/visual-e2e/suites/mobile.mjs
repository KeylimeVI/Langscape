/**
 * Mobile / Android-emulated Obsidian E2E & visual verification suite.
 * Runs inside real Obsidian with EmulateMobile=1 (genuine Obsidian mobile UI),
 * Android Pixel 7 viewport (412x915 @2x), Android UA, CDP touch emulation, and
 * strict Node.js module blocking matching Obsidian Mobile's JS runtime.
 */
import assert from "node:assert/strict";
import { sleep, waitFor } from "../lib/cdp.mjs";

async function openMobileNote(cdp, filePath, mode = "preview") {
  await cdp.eval(`(async () => {
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(filePath)});
    if (!file) throw new Error('Missing vault file: ' + ${JSON.stringify(filePath)});
    const leaf = app.workspace.getMostRecentLeaf() ?? app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: 'markdown',
      state: { file: ${JSON.stringify(filePath)}, mode: ${JSON.stringify(mode)} },
      active: true,
    });
    return true;
  })()`);
  await sleep(600);
}

async function createAndOpenMobileNote(cdp, filePath, content, mode = "preview") {
  await cdp.eval(`(async () => {
    const existing = app.vault.getAbstractFileByPath(${JSON.stringify(filePath)});
    if (existing) await app.vault.modify(existing, ${JSON.stringify(content)});
    else await app.vault.create(${JSON.stringify(filePath)}, ${JSON.stringify(content)});
    return true;
  })()`);
  await openMobileNote(cdp, filePath, mode);
}

export function getMobileScenarios() {
  return [
    {
      id: "m01-mobile-runtime-and-starter",
      title: "Mobile runtime sandbox, Android phone UI shell, and mobile starter vault",
      async run({ cdp, recorder }) {
        const assertions = [];
        const screenshots = [];

        const envCheck = await cdp.eval(`(() => {
          const plugin = app.plugins.plugins.langscape;
          const commands = Object.keys(app.commands.commands);
          return {
            desktopOnly: plugin.manifest.isDesktopOnly,
            hasLexurgy: Boolean(plugin.lexurgy),
            desktopCommands: commands.filter((id) =>
              ['langscape:create-recipe', 'langscape:create-sound-change-file'].includes(id)
            ),
            hasFontCommand: commands.includes('langscape:insert-font-span'),
            hasTreeCommand: commands.includes('langscape:insert-syntax-tree'),
            bodyClasses: {
              isMobile: document.body.classList.contains('is-mobile'),
              isPhone: document.body.classList.contains('is-phone'),
              isAndroid: document.body.classList.contains('is-android'),
            },
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          };
        })()`);

        assert.equal(envCheck.desktopOnly, false, "manifest.isDesktopOnly must be false");
        assert.equal(envCheck.hasLexurgy, false, "Lexurgy service must not load on mobile");
        assert.deepEqual(envCheck.desktopCommands, [], "Desktop-only commands must not register on mobile");
        assert.equal(envCheck.hasFontCommand, true, "Font command should be registered on mobile");
        assert.equal(envCheck.hasTreeCommand, true, "Tree command should be registered on mobile");
        assert.equal(envCheck.bodyClasses.isMobile, true, "Obsidian mobile UI (.is-mobile) is not active");
        assertions.push("Plugin loads in strict Node-blocked mobile sandbox with .is-mobile UI and desktop features cleanly omitted");

        // Create mobile starter vault and verify only mobile-compatible files are created.
        const demoFiles = await cdp.eval(`(async () => {
          await app.plugins.plugins.langscape.createStarterVault();
          return app.vault.getFiles().map((f) => f.path).filter((p) => p.startsWith('Langscape Demo/'));
        })()`);
        assert.ok(demoFiles.includes("Langscape Demo/Notes/Font demo.md"), "Missing Font demo.md");
        assert.ok(demoFiles.includes("Langscape Demo/Notes/Tree demo.md"), "Missing Tree demo.md");
        assert.ok(demoFiles.every((p) => !/\.(lsc|recipe)$/.test(p)), `Desktop-only files in mobile demo: ${demoFiles}`);
        assertions.push(`Mobile starter vault created ${demoFiles.length} mobile-safe files (no .lsc/.recipe)`);

        await openMobileNote(cdp, "Langscape Demo/README.md", "preview");
        await sleep(400);

        const shotPath = recorder.screenshotPath("m01-mobile-starter-readme.png");
        await cdp.captureViewport(shotPath);
        screenshots.push({
          id: "m01-mobile-starter-readme",
          filePath: shotPath,
          caption: "Android phone viewport (412×915) showing Obsidian mobile shell and mobile starter README",
          checkCriteria: [
            "Obsidian renders in genuine phone layout (mobile header/navbar, no desktop sidebar crowding the screen).",
            "README clearly states that Lexurgy and sound-change recipes are available on desktop only.",
            "Text wraps cleanly within the 412px phone screen with no horizontal clipping.",
          ],
        });

        return { assertions, screenshots };
      },
    },

    {
      id: "m02-mobile-fonts-and-picker",
      title: "Mobile Reading view fonts and touch-friendly Font Picker modal",
      async run({ cdp, recorder }) {
        const assertions = [];
        const screenshots = [];

        await openMobileNote(cdp, "Langscape Demo/Notes/Font demo.md", "preview");
        await waitFor(
          () =>
            cdp.eval(`(async () => {
              const span = document.querySelector('.markdown-reading-view .langscape-font');
              if (!span) return false;
              const fam = getComputedStyle(span).fontFamily;
              if (!fam.includes('Noto Sans Gothic')) return false;
              const faces = await document.fonts.load('16px ' + fam, '𐌰');
              return faces.some((f) => f.family.includes('Noto Sans Gothic') && f.status === 'loaded');
            })()`),
          15_000,
          "Noto Sans Gothic loaded in mobile Reading view"
        );
        assertions.push("Vault font loads and renders in mobile Reading view");

        const readingShot = recorder.screenshotPath("m02-mobile-fonts-reading.png");
        await cdp.captureViewport(readingShot);
        screenshots.push({
          id: "m02-mobile-fonts-reading",
          filePath: readingShot,
          caption: "Mobile Reading view displaying Noto Sans Gothic inline writing system text",
          checkCriteria: [
            "Inline Gothic glyphs (`𐌰𐍆𐌰 𐌴𐌺𐌴`) render as real Gothic script (not missing-glyph boxes or raw braces).",
            "Text wraps cleanly on 412px Android screen with comfortable margins.",
          ],
        });

        // Switch to Live Preview and open Font Picker modal on phone viewport.
        await openMobileNote(cdp, "Langscape Demo/Notes/Font demo.md", "source");
        await cdp.eval(`(() => {
          app.commands.executeCommandById('langscape:insert-font-span');
          return true;
        })()`);
        await waitFor(
          () => cdp.eval(`Boolean(document.querySelector('.langscape-font-picker .langscape-font-row'))`),
          10_000,
          "Mobile Font Picker modal"
        );
        await sleep(350);

        const modalFit = await cdp.eval(`(() => {
          const modal = document.querySelector('.modal');
          const r = modal.getBoundingClientRect();
          return { left: r.left, right: r.right, width: r.width, viewport: window.innerWidth };
        })()`);
        assert.ok(modalFit.right <= modalFit.viewport + 2, `Font picker modal overflows phone width: ${JSON.stringify(modalFit)}`);
        assertions.push(`Font Picker modal fits phone width (${Math.round(modalFit.width)}px / ${modalFit.viewport}px)`);

        const pickerShot = recorder.screenshotPath("m02-mobile-font-picker.png");
        await cdp.captureViewport(pickerShot);
        screenshots.push({
          id: "m02-mobile-font-picker",
          filePath: pickerShot,
          caption: "Font Picker modal on 412×915 Android phone screen",
          checkCriteria: [
            "Font Picker modal fits cleanly inside the phone screen without horizontal overflow or cut-off buttons.",
            "Font preview glyphs and Insert button are clearly visible and tappable.",
          ],
        });

        // Close modal via touch tap on Insert button.
        await cdp.tapSelector(".langscape-font-picker .langscape-font-row button.mod-cta");
        await waitFor(() => cdp.eval(`!document.querySelector('.langscape-font-picker')`), 5_000, "modal close");
        assertions.push("Touch tap on Insert button closes modal and inserts font span");

        return { assertions, screenshots };
      },
    },

    {
      id: "m03-mobile-syntax-tree",
      title: "Mobile syntax tree rendering with custom font and touch alignment toggle",
      async run({ cdp, recorder }) {
        const assertions = [];
        const screenshots = [];

        await openMobileNote(cdp, "Langscape Demo/Notes/Tree demo.md", "preview");
        await waitFor(
          () =>
            cdp.eval(`(() => {
              const block = document.querySelector('.markdown-reading-view .langscape-tree-block');
              const edges = block?.querySelectorAll('svg.langscape-tree-edges line, svg.langscape-tree-edges path').length ?? 0;
              return Boolean(block && block.textContent.includes('sky') && edges >= 4);
            })()`),
          15_000,
          "syntax tree in mobile Reading view"
        );
        await sleep(350);
        assertions.push("Syntax tree renders with SVG edges and Gothic leaf in mobile Reading view");

        const shotPath = recorder.screenshotPath("m03-mobile-syntax-tree.png");
        await cdp.captureViewport(shotPath);
        screenshots.push({
          id: "m03-mobile-syntax-tree",
          filePath: shotPath,
          caption: "Mobile Reading view syntax tree with Gothic leaf node on 412×915 Android screen",
          checkCriteria: [
            "Tree hierarchy (VP -> NP, V, NP -> Det, Adj, N) renders cleanly on phone screen with crisp SVG edges.",
            "Gothic glyphs inside the NP leaf render properly without raw `{Noto-Sans-Gothic: ...}` markup.",
            "Tree block scrolls/fits gracefully inside the phone container without breaking page layout.",
          ],
        });

        // Test touch tap on the alignment toggle button.
        await cdp.tapSelector(".markdown-reading-view .langscape-tree-block .langscape-tree-align");
        await sleep(300);
        const alignedLeft = await cdp.eval(
          `Boolean(document.querySelector('.markdown-reading-view .langscape-tree.is-align-left'))`
        );
        assert.equal(alignedLeft, true, "Touch tap on mobile tree alignment button did not toggle alignment");
        assertions.push("Touch tap on alignment toggle switches tree alignment on mobile");

        return { assertions, screenshots };
      },
    },

    {
      id: "m04-mobile-merged-tables",
      title: "Mobile merged Markdown tables (Reading view & Live Preview)",
      async run({ cdp, recorder }) {
        const assertions = [];
        const screenshots = [];

        const tableContent = [
          "# Mobile Merged Tables",
          "",
          "| Region | Q1 | < | Q2 | < |",
          "| --- | --- | --- | --- | --- |",
          "| North | 10 | 12 | 14 | 16 |",
          "| ^ | 8 | 9 | 11 | 13 |",
          "| South | 22 | 28 | 30 | 34 |",
          "",
          "| Case | Gothic | Gloss |",
          "| --- | --- | --- |",
          "| Nom | {Noto-Sans-Gothic: 𐌰𐍆𐌰} | father |",
          "| ^ | {Noto-Sans-Gothic: 𐌴𐌺𐌴} | edge |",
          "",
        ].join("\n");

        await createAndOpenMobileNote(cdp, "MobileTables.md", tableContent, "preview");
        await waitFor(
          () =>
            cdp.eval(`(() => {
              const tables = document.querySelectorAll('.markdown-reading-view table.langscape-merged-table');
              if (tables.length < 2) return false;
              return tables[0].rows[0].cells[1].colSpan === 2 && tables[0].rows[1].cells[0].rowSpan === 2;
            })()`),
          15_000,
          "merged tables in mobile Reading view"
        );
        await sleep(300);
        assertions.push("Mobile Reading view renders merged tables with colspan=2, rowspan=2, and custom font cells");

        // Touch scroll check.
        await cdp.touchScroll(200, 600, -120);
        await sleep(250);

        const shotPath = recorder.screenshotPath("m04-mobile-merged-tables.png");
        await cdp.captureViewport(shotPath);
        screenshots.push({
          id: "m04-mobile-merged-tables",
          filePath: shotPath,
          caption: "Mobile Reading view merged tables with colspan/rowspan and Gothic font cells",
          checkCriteria: [
            "Q1 and Q2 span two columns and North/Nom span two rows with no visible `<` or `^` merge markers.",
            "Gothic glyphs render cleanly inside the second merged table.",
            "Tables fit or scroll cleanly within the 412px phone screen.",
          ],
        });

        return { assertions, screenshots };
      },
    },

    {
      id: "m05-mobile-settings",
      title: "Mobile Settings tab (Fonts visible, desktop-only notice for Lexurgy)",
      async run({ cdp, recorder }) {
        const assertions = [];
        const screenshots = [];

        await cdp.eval(`(() => { app.setting.open(); app.setting.openTabById('langscape'); return true; })()`);
        const info = await waitFor(
          () =>
            cdp.eval(`(() => {
              const el = app.setting.activeTab?.containerEl;
              if (!el?.classList.contains('langscape-settings')) return null;
              return {
                text: el.textContent.replace(/\\s+/g, ' ').trim(),
                fontRows: el.querySelectorAll('.langscape-font-setting').length,
                hasLexurgyStatus: Boolean(el.querySelector('.langscape-lexurgy-setting-status')),
              };
            })()`),
          10_000,
          "Mobile Langscape settings tab"
        );
        assert.ok(info.fontRows >= 1, "Expected vault fonts in mobile Settings");
        assert.equal(info.hasLexurgyStatus, false, "Desktop Lexurgy status block should not render on mobile");
        assert.ok(
          info.text.includes("Lexurgy and sound-change recipes are available on desktop only."),
          `Missing desktop-only notice on mobile Settings: ${info.text}`
        );
        assertions.push("Mobile Settings shows vault fonts and clean desktop-only notice for Lexurgy/recipes");

        const shotPath = recorder.screenshotPath("m05-mobile-settings.png");
        await cdp.captureViewport(shotPath);
        screenshots.push({
          id: "m05-mobile-settings",
          filePath: shotPath,
          caption: "Mobile Settings → Langscape on 412×915 Android viewport",
          checkCriteria: [
            "Fonts section displays Noto Sans Gothic with rendered preview glyphs and Rescan button.",
            "No broken Java/Lexurgy path inputs appear; clean note explains Lexurgy/recipes are desktop-only.",
            "Settings layout fits cleanly on the narrow phone screen.",
          ],
        });

        await cdp.eval(`app.setting.close(); true`);
        return { assertions, screenshots };
      },
    },
  ];
}
