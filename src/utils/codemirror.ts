import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/** True when a document position is inside a Markdown code block or inline code. */
export function isInCode(state: EditorState, position: number): boolean {
  try {
    let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null =
      syntaxTree(state).resolveInner(position, 1);
    while (node) {
      if (/code/i.test(node.name)) return true;
      node = node.parent;
    }
  } catch {
    return false;
  }
  return false;
}
