# Changelog

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
