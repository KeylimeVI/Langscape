# Architecture

Langscape is a single Obsidian plugin written in TypeScript and bundled to CommonJS with esbuild. The code is split so that the parts that can be reasoned about without Obsidian are testable in isolation.

## Runtime layers

```
main.ts
  ├─ FontManager ── font-name.ts / css.ts / spans.ts / render.ts / clipboard.ts / dom.ts / modal.ts
  ├─ LexurgyService ── locator.ts / server.ts / protocol.ts / installer.ts / release.ts
  ├─ SoundChangeView ── editor.ts / language.ts / outline.ts / panel.ts
  ├─ merged tables ── model.ts / render.ts / live-preview.ts / postprocess.ts / actions.ts
  ├─ syntax trees ── model.ts / render.ts / editor.ts / postprocess.ts
  ├─ pipeline + canvas ── model.ts / words.ts / runner.ts / writer.ts / code-block.ts / block-edit.ts
  └─ shared UI ── modals.ts / path-picker.ts / utils/
```

### Fonts

- `FontManager.refresh()` scans the whole vault for supported font extensions, reads each file, parses the OpenType `name` table, and caches by path + mtime + size. Nicknames and aliases are stored in plugin settings; lookup matches nickname, family, display name, filename-derived name, and generated class/id.
- `buildFontCss()` emits one `@font-face` per font URL plus a CSS class per font. The stylesheet is injected into a single `<style>` element and regenerated after a rescan. URL fonts and custom font entries are supported alongside vault files; custom entries keep their settings id independent of the generated record id.
- Reading view uses a Markdown post-processor that walks text nodes, so links/emphasis outside a span keep working. Live Preview uses CodeMirror decorations. A separate editor extension handles note-level `langscape-font` frontmatter by marking the document text. Table-cell editors are separate CodeMirror views; they receive the same extension through Obsidian's editor configuration and detect their table-cell host so font spans stay rendered while a cell is being edited.
- `FontDomDecorator` watches Bases views and applies the same text-node decoration outside the Markdown post-processor pipeline. Bases metadata cells are contenteditable even while idle; the decorator restores original markup on focus and re-decorates after blur so the syntax is not saved away.
- `fonts/clipboard.ts` intercepts copy only when the current selection contains a rendered font span. It reconstructs the selection using the nearest font record and writes inline `{nickname: text}` markup to `text/plain`; plain text, code, and source selections are left alone. A source-mode selection that already contains font syntax is copied verbatim.
- Font markup is parsed without touching the Markdown AST: the preferred `{nickname: text}` form (plus the earlier `'''nickname text'''` and legacy `{font:Name|text}` forms) survives Markdown rendering and is rewritten in text nodes. Spans stay inline and cannot cross a line break.

### Merged table cells

- A regular Markdown table stores merges as cell content: `<` joins left, `^` joins up, and `>` joins right. The model parses the table, resolves marker components with union-find, rejects non-rectangular groups, and computes the `rowspan`/`colspan` layout. Source formatting (padding, alignment row, escaped pipes) is preserved when a row is rewritten.
- Reading view uses an async Markdown post-processor. It prefers the note's source lines (so escaped markers are not mistaken for merges) and falls back to one DOM-to-table builder for embeds. Text in a `>` group is moved into the top-left anchor because HTML `colspan` can only grow rightwards.
- Live Preview is a CodeMirror `ViewPlugin`. It locates the source table for each `.cm-table-widget` table, applies spans to the existing cells, and hides covered cells with CSS instead of removing them. Keeping every cell in the DOM preserves Obsidian's cell-to-source mapping and editing behaviour. A layout signature avoids touching the DOM while the user is typing, and a rescan after cell blur re-decorates a static wrapper that came back with raw font markup.
- Cell selection is pointer-based (drag or Shift-click). Selections are normalized to a filled rectangle and expanded over existing merge groups. Obsidian does not emit `editor-menu` for Live Preview table cells, so the native table menu is augmented by wrapping `Menu.showAtMouseEvent`/`showAtPosition` while a table context is pending; the wrapper is restored on unload. Its two actions are **Merge cells** and **Split cells**.
- Source mode uses ordinary `editor-menu` actions and command-palette commands. Typing `<`, `^`, or `>` in an empty Live Preview cell performs the same edit immediately and moves focus to the merged cell. `>` source is normalized to `<` for formats that arrive from pasted text. All edits are ordinary Markdown changes, so undo and file history work normally.

### Syntax trees

- `trees/model.ts` parses one `{tree: ...}` line into a recursive node tree. The parser understands nested braces, commas, parentheses, and inline font spans, so labels can contain custom-font text.
- Reading view and exports use `trees/postprocess.ts` + `trees/render.ts` to render nodes and draw parent/child edges with SVG/CSS. The renderer keeps wide trees at full size with a horizontal scroll container instead of shrinking nodes.
- Live Preview uses a CodeMirror widget (`trees/editor.ts`) that replaces a complete tree line with the interactive tree and keeps the source mapping intact. Hover controls add/delete children; drag and drop moves a subtree or inserts it before/after a sibling; clicking a label renames it; the alignment toggle is persisted. The widget is refreshed after a font rescan so label measurements stay correct.
- Tree markup is intentionally line-based: one tree per line and no surrounding prose. The source remains portable Markdown.

### Lexurgy

- `LexurgyServer` owns one `lexurgy server` JVM process. Requests are serialized and matched to responses by order; the server protocol has no request IDs. Start/exit/timeout errors carry the stderr tail and exit information to the caller.
- `LexurgyService` caches installation detection (`java -version`, managed folder, configured path, PATH), lazily starts the server, and exposes `validate`, `apply`, `testConnection`, and `installLexurgy`.
- The managed installer downloads the official release zip with Obsidian's `requestUrl` (no CORS problems), extracts only `lib/*.jar` with `fflate`, stages the extraction, and swaps it into place. It explicitly records the GPL attribution. Lexurgy is a separate GPL-3.0 program and is not bundled with Langscape.

### Sound-change editor

- `SoundChangeView` extends Obsidian's `TextFileView`, so file loading, dirty tracking, and saving are handled by Obsidian.
- The editor is a CodeMirror 6 instance built from the same modules Obsidian provides. Lexurgy colouring is a decoration-based tokenizer (not a CodeMirror language extension), so it works without depending on the Markdown parser. Lexurgy itself remains the validator.
- Validation is automatic: the linter runs after a short typing pause and on save. There are no separate Validate/Run buttons in the editor header. The test bench keeps words per vault path in plugin data.

### Canvas pipelines

- A canvas is a JSON file. `parseCanvasPipeline()` extracts fenced `langscape` blocks from text nodes, maps canvas edges to data-flow edges, validates the DAG, and returns a `PipelineGraph`. Validation returns a fresh issue list rather than mutating the graph, so parsing and running use the same rules without accumulating duplicates.
- `runPipeline()` is Obsidian-independent orchestration: a source callback, a file reader, an apply callback, and an output writer are injected. This makes it possible to add a future non-Lexurgy phonology engine without changing the graph model. It accepts an optional `targetOutputId` and runs only that output's ancestor branch.
- `writePipelineOutput()` renders Markdown notes containing only `source`, `original`, the evolved-word property, and `pipeline`. The pipeline name defaults to the output folder name and can be overridden with `name:`. Notes are identified as generated by their `pipeline`/`original` properties (or the old `langscape: word` marker); human notes are never overwritten. Collision handling is bounded and never falls through to a colliding path. Output inside a source folder is rejected during graph validation.
- Canvas text cards are rendered by a Markdown code-block processor. Cards stay compact: only output cards get a Run button. Card-level config and connection errors are rendered on the card itself. The canvas view's runtime API is used by the header's Langscape menu to add nodes and auto-connect them to the selected card. Source/output cards expose their word `field` inline, and output cards expose an editable pipeline name. Double-clicks on card metadata are intercepted; path names open an anchored file/folder picker and sound-change cards open their `.lsc` file.

### Release and testing

- `npm run build` typechecks and bundles `main.js`; `npm run package:release` validates that `package.json` and `manifest.json` versions agree, removes stale `dist/langscape-*.zip` bundles, and writes the release zip.
- `npm test` covers parsing, CSS generation, OpenType name tables, span rendering, clipboard reconstruction, graph validation, word extraction, output collision rules, trace parsing, merged-table layout/merge/split/serialization, and the Lexurgy wire protocol. Real-JVM integration tests run when Lexurgy and Java are available.
- `npm run test:obsidian` launches the extracted Obsidian build in headless Chromium (`--headless --ozone-platform=headless`) with a disposable vault/profile under `.tools/headless-obsidian`. It checks merged tables, active font cells, clipboard font markup, and rectangular table selection, and writes `.tools/headless-obsidian/last-run.png`. It needs no display server or system writes.
- `scripts/e2e-obsidian.mjs` is the larger desktop end-to-end suite: starter vault, pipeline runs, canvas menu, fonts, trees, `.lsc` editor/test bench, and settings. It is intentionally outside `npm test` because it needs the Obsidian binary and optionally a real Lexurgy installation.

## Deliberate boundaries

- The plugin does not implement its own sound-change applier. Lexurgy is the engine.
- Canvas has no public node-editing API, so the plugin uses the canvas view's runtime API for its own menu actions rather than promising a general canvas mutation API.
- Fonts are loaded from vault resources or configured URLs; mobile support is deferred along with the JVM dependency.
- The font and tree markup purposely stay inline/line-based Markdown so files remain readable and portable in other editors.
