# Architecture

Langscape is a single Obsidian plugin written in TypeScript and bundled to CommonJS with esbuild. The code is split so that the parts that can be reasoned about without Obsidian are testable in isolation.

## Runtime layers

```
main.ts
  ├─ FontManager ── font-name.ts / css.ts / spans.ts / render.ts / modal.ts
  ├─ LexurgyService ── locator.ts / server.ts / protocol.ts / installer.ts / release.ts
  ├─ SoundChangeView ── editor.ts / language.ts / outline.ts / panel.ts
  ├─ merged tables ── model.ts / render.ts / live-preview.ts / postprocess.ts / actions.ts
  └─ code block + canvas menu ── model.ts / words.ts / runner.ts / writer.ts
```

### Fonts

- `FontManager.refresh()` always scans the whole vault for font extensions, reads each file, parses the OpenType `name` table, and caches the result by path + mtime + size. Vault paths can have a user-defined nickname; lookup matches the nickname, family, display name, and filename-derived name.
- `buildFontCss()` emits `@font-face` and per-font classes. The CSS is injected into a single `<style>` element and regenerated on refresh. Reading view uses a Markdown post-processor that walks text nodes; Live Preview uses CodeMirror decorations. A separate editor extension handles note-level `langscape-font` frontmatter by marking the document text.
- `FontDomDecorator` watches Bases views and applies the same text-node decoration outside the Markdown post-processor pipeline. Bases metadata cells are contenteditable even while idle; the decorator restores the original markup on focus and re-decorates after blur so the font syntax is not lost when the cell is saved.
- Font markup is intentionally parsed without touching the Markdown AST: the preferred `{nickname: text}` form (plus the earlier `'''nickname text'''` and legacy `{font:Name|text}` forms) survives Markdown rendering and is rewritten in text nodes, so links/emphasis outside the span keep working. Spans stay inline and cannot cross a line break.

### Merged table cells

- A regular Markdown table stores merges as cell content: `<` joins left, `^` joins up, and `>` joins right. The model parses the table, resolves marker components with union-find, rejects non-rectangular groups, and computes the `rowspan`/`colspan` layout. Source formatting (padding, alignment row, escaped pipes) is preserved when a row is rewritten.
- Reading view uses an async Markdown post-processor. It prefers the note's source lines (so escaped markers are not mistaken for merges) and falls back to the rendered cells for embeds. Text in a `>` group is moved into the top-left anchor because HTML `colspan` can only grow rightwards.
- Live Preview is a CodeMirror `ViewPlugin`. It locates the source table for each `.cm-table-widget` table, applies spans to the existing cells, and hides covered cells with CSS instead of removing them. Keeping every cell in the DOM preserves Obsidian's cell-to-source mapping and editing behaviour. A layout signature avoids touching the DOM while the user is typing.
- Cell selection is pointer-based (drag or Shift-click). Obsidian does not emit `editor-menu` for Live Preview table cells, so the native table menu is augmented by wrapping `Menu.showAtMouseEvent`/`showAtPosition` while a table context is pending. Its merge actions write markers back to the source through a CM transaction; typing `<`, `^`, or `>` in an empty cell performs the same edit immediately and moves focus to the merged cell. `>` source is normalized to `<` for formats that arrive from pasted text.
- Commands and the editor context menu cover Source mode: merge selection, split cell, and insert table. All edits are ordinary Markdown changes, so undo and file history work normally.

### Lexurgy

- `LexurgyServer` owns one `lexurgy server` JVM process. Requests are serialized and matched to responses by order; the server protocol has no request IDs.
- `LexurgyService` caches installation detection (`java -version`, managed folder, configured path, PATH), lazily starts the server, and exposes high-level `validate`, `apply`, `testConnection`, and `installLexurgy` methods.
- The managed installer downloads the official release zip with Obsidian's `requestUrl` (no CORS problems), extracts only `lib/*.jar` with `fflate`, stages the extraction, and swaps it into place. It explicitly records the GPL attribution.
- The server is desktop-only because it needs Node's `child_process`; the manifest has `isDesktopOnly: true`.

### Sound-change editor

- `SoundChangeView` extends Obsidian's `TextFileView`, so file loading, dirty tracking, and saving are handled by Obsidian.
- The editor is a CodeMirror 6 instance built from the same modules Obsidian provides. Lexurgy colouring is a decoration-based tokenizer (not a CodeMirror language extension), so it works without depending on the Markdown parser. Lexurgy itself remains the validator.
- Validation is automatic: the linter runs after a short typing pause and on save. There are no separate Validate/Run buttons in the editor header. The test bench keeps words per vault path in plugin data.

### Canvas pipelines

- A canvas is a JSON file. `parseCanvasPipeline()` extracts fenced `langscape` blocks from text nodes, maps canvas edges to data-flow edges, validates the DAG, and returns a `PipelineGraph`.
- `runPipeline()` is Obsidian-independent orchestration: a source callback, a file reader, an apply callback, and an output writer are injected. This is what makes it possible to add a future non-Lexurgy phonology engine without changing the graph model. It accepts an optional `targetOutputId` and runs only that output's ancestor branch.
- `writePipelineOutput()` renders Markdown notes containing only `source`, `original`, the evolved-word property, and `pipeline`. The pipeline name defaults to the output folder name (the final language) and can be overridden with `name:`. Notes are identified as generated by their `pipeline`/`original` properties (or the old `langscape: word` marker); human notes are never overwritten. Output inside a source folder is rejected during graph validation.
- Canvas text cards are rendered by a Markdown code-block processor. Cards stay compact: only output cards get a Run button. Card-level config and connection errors are rendered on the card itself. The canvas view's runtime API is used by the header's Langscape menu to add nodes and auto-connect them to the selected card. Source/output cards expose their word `field` inline, and output cards expose an editable pipeline name. Double-clicks on card metadata are intercepted; path names open an anchored folder/file picker and sound-change cards open their `.lsc` file. The picker is a Bases-style search popover, not an OS dialog; output accepts a typed new folder path.
- There is no separate pipeline sidebar. The canvas header menu provides Add source / Add sound changes / Add output and Run all.

## Testing strategy

- Unit tests cover parsing, CSS generation, OpenType name tables, span rendering, graph validation, word extraction, output rendering, file collision rules, trace grouping/stage parsing, merged-table layout/merge/split/serialization, and the Lexurgy wire protocol.
- Integration tests launch the real Lexurgy 1.7.7 JVM when `.tools/lexurgy.zip` and Java are available, exercising extraction, detection, loading, applying, tracing, and error reporting.
- `scripts/e2e-obsidian.mjs` launches a disposable real Obsidian vault through Electron's devtools protocol, loads the built plugin, creates the starter vault, runs the pipeline and a single-output branch, exercises the canvas add-step menu, checks generated notes and card errors, verifies font and syntax rendering, opens the `.lsc` view/test bench, and inspects the settings tab. It is intentionally outside `npm test` because it needs a desktop session and a downloaded Obsidian build.

## Deliberate boundaries

- The plugin does not implement its own sound-change applier. Lexurgy is the engine.
- Canvas has no public node-editing API, so the plugin reads and runs canvases rather than mutating them.
- Fonts are loaded from vault resources; mobile support is deferred along with the JVM dependency.
