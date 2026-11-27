# Changelog

## 1.0.5

- Add declarative setting definitions (`getSettingDefinitions`) so Langscape settings appear in Obsidian's settings search.
- Address Obsidian store review warnings: use Obsidian DOM helpers (`createEl`/`createDiv`/`createSpan`/`createSvg`/`createFragment`), remove `!important` and `:has()` from plugin styles, guard desktop-only `node:*` imports behind `Platform.isDesktopApp`, use cross-window `.instanceOf(...)` checks, and tighten TypeScript type narrowing.
- Move the Remotion trailer project to a dedicated `trailer` branch.

## 1.0.4

- Enable a mobile reading preview for vault fonts, syntax trees, and merged tables. The Lexurgy workbench and sound-change recipes remain desktop-only.
- Fix vault font discovery repeatedly listing fonts under symlinked directories or nested `.obsidian` vaults.
- Rebuild font loading to register vault fonts from binary `ArrayBuffer` data across all windows (fixing Settings font previews in Obsidian 1.15), update open notes live on font or nickname changes, pick valid preview glyphs from each font's `cmap`, surface font decode errors inline, and allow deleting vault fonts from Settings.

## 1.0.3

- Fix IPA and accented characters turning into question marks in Lexurgy results and rule traces on systems with a non-UTF-8 console.

## 1.0.2

- Remove the duplicate plugin-name heading in settings.

## 1.0.1

- Register vault fonts without injecting stylesheets, including in popout windows.
- Render Lexurgy documentation without assigning remote HTML to the DOM.
- Preserve tab placement on unload and save tree alignment and workbench width per vault.
- Use Obsidian settings headings and stylesheet rules for tree editing.
- Attest the three plugin release assets. The beta installer still uses the repository ZIP.

## 1.0.0 — first stable release

- Custom writing-system fonts discovered anywhere in the vault, with inline
  `{nickname: text}` spans, note-level `langscape-font` frontmatter, Live
  Preview, Reading view, exported HTML, and Bases support.
- Font-aware clipboard: copying rendered font text includes the inline font
  markup so pasting it back into a note keeps the font.
- Merged Markdown table cells with `<`, `^`, and `>` markers, rectangular
  drag/Shift selections, native merge/split menus, and a Source-mode command
  menu.
- Table-cell font rendering while editing, including after leaving a cell.
- Syntax trees rendered and edited in Live Preview, with font labels, drag and
  drop, sibling insertion, alignment, and horizontal scrolling.
- Lexurgy integration with a native `.lsc` editor, syntax highlighting, live
  validation, test bench, and rule traces. Install the official Lexurgy CLI separately or keep using an existing installation.
- Native `.recipe` cards for applying ordered Lexurgy changes to a property on
  Markdown notes and saving or refreshing copies in a separate folder.
- Guided starter vault with a demo recipe, font, syntax tree, and Lexurgy
  changes.
- Desktop-only Obsidian 1.15+ build; package, install, and headless test scripts.

## 0.1.0

- Initial development release.
