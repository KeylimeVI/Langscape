// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createLexurgyHighlightExtension } from "../../src/soundchange/language";

describe("Lexurgy editor highlighting", () => {
  it("adds syntax decoration classes", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: "Feature +vowel\n\nLenition:\n p => b / [+vowel] _ [+vowel]\n",
        extensions: [createLexurgyHighlightExtension()],
      }),
      parent,
    });
    const spans = [...parent.querySelectorAll(".cm-content span")].map((span) => ({
      text: span.textContent,
      cls: span.className,
    }));
    expect(spans.some((span) => span.text === "Feature" && span.cls.includes("langscape-syntax-keyword"))).toBe(true);
    expect(spans.some((span) => span.text === "Lenition" && span.cls.includes("langscape-syntax-ruleName"))).toBe(true);
    expect(spans.some((span) => span.text === "+vowel" && span.cls.includes("langscape-syntax-featureValue"))).toBe(true);
    expect(spans.some((span) => span.text === "=>" && span.cls.includes("langscape-syntax-operator"))).toBe(true);
    view.destroy();
  });
});
