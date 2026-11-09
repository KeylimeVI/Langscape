import type { FontManager } from "../fonts/manager";
import { parseSyntaxTreeLine } from "./model";
import { renderSyntaxTree } from "./render";

/** Replace complete `{tree: ...}` paragraphs in Reading view/exported HTML. */
export function createSyntaxTreePostProcessor(manager: FontManager) {
  return (el: HTMLElement, _context: unknown): void => {
    const blocks = [...el.querySelectorAll<HTMLElement>("p")];
    if (el.matches("p")) blocks.unshift(el);
    for (const block of blocks) {
      if (block.querySelector("code, pre")) continue;
      const text = block.textContent?.trim() ?? "";
      if (!text.startsWith("{tree:")) continue;
      const tree = parseSyntaxTreeLine(text);
      if (!tree) continue;
      block.replaceWith(
        renderSyntaxTree(tree, manager, block.ownerDocument)
      );
    }
  };
}
