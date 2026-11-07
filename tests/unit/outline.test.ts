import { describe, expect, it } from "vitest";
import {
  lineRange,
  lineToOffset,
  parseOutline,
  ruleAtLine,
} from "../../src/soundchange/outline";
import { NEW_LSC_TEMPLATE } from "../../src/soundchange/template";

describe("Lexurgy outline parser", () => {
  const source = `# comment
Feature +vowel
Feature place (labial, alveolar)
Symbol a [+vowel]
Class vowels {a, e}
Element batman (na)+
Romanizer:
  a => á

Lenition:
 p => b / [+vowel] _ [+vowel]
 Then:
  t => d

Vowel-Shift:
 a => e

Final devoicing:
 b => p / _ $
`;

  it("finds rules and declaration counts", () => {
    const outline = parseOutline(source);
    expect(outline.rules.map((rule) => rule.name)).toEqual([
      "Lenition",
      "Vowel-Shift",
      "Final devoicing",
    ]);
    expect(outline.features).toBe(2);
    expect(outline.symbols).toBe(1);
    expect(outline.classes).toBe(1);
    expect(outline.elements).toBe(1);
    expect(outline.romanizers).toBe(1);
    expect(outline.rules[0]).toMatchObject({ line: 10, thenCount: 1 });
    expect(outline.rules[0].endLine).toBe(14);
    expect(outline.rules[1].line).toBe(15);
  });

  it("handles the starter template", () => {
    const outline = parseOutline(NEW_LSC_TEMPLATE);
    expect(outline.rules.map((rule) => rule.name)).toEqual(["Lenition", "Raising"]);
    expect(outline.symbols).toBe(9);
  });

  it("ignores comments and inline colons", () => {
    const outline = parseOutline(
      ["# Fake:", "Feature x", "Real rule:", " # indented comment", " a => b"].join("\n")
    );
    expect(outline.rules.map((rule) => rule.name)).toEqual(["Real rule"]);
  });

  it("maps lines to offsets and back", () => {
    const doc = "one\ntwo\nthree";
    expect(lineToOffset(doc, 1)).toBe(0);
    expect(lineToOffset(doc, 2)).toBe(4);
    expect(lineToOffset(doc, 3)).toBe(8);
    expect(lineToOffset(doc, 99)).toBe(8);
    expect(lineRange(doc, 2)).toEqual({ from: 4, to: 7 });
  });

  it("finds the rule containing a line", () => {
    const outline = parseOutline(source);
    expect(ruleAtLine(outline, 11)?.name).toBe("Lenition");
    expect(ruleAtLine(outline, 16)?.name).toBe("Vowel-Shift");
    expect(ruleAtLine(outline, 1)).toBeUndefined();
  });
});
