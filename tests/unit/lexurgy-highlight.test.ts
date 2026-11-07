import { describe, expect, it } from "vitest";
import {
  tokenizeLexurgyLine,
  type LexurgyHighlightState,
  type LexurgyToken,
} from "../../src/soundchange/language";

function state(): LexurgyHighlightState {
  return { decl: undefined, matrixDepth: 0, featureListDepth: 0, braceDepth: 0 };
}

function tags(tokens: LexurgyToken[]): string[] {
  return tokens.map((token) => token.tag);
}

function text(line: string, tokens: LexurgyToken[]): string[] {
  return tokens.map((token) => line.slice(token.from, token.to));
}

describe("Lexurgy tokenizer", () => {
  it("highlights declarations, feature names, and feature values", () => {
    const line = "Feature place (labial, dental, alveolar)";
    const tokens = tokenizeLexurgyLine(line, state());
    expect(text(line, tokens)).toEqual([
      "Feature",
      "place",
      "(",
      "labial",
      ",",
      "dental",
      ",",
      "alveolar",
      ")",
    ]);
    expect(tags(tokens)).toEqual([
      "keyword",
      "featureName",
      "punctuation",
      "featureValue",
      "punctuation",
      "featureValue",
      "punctuation",
      "featureValue",
      "punctuation",
    ]);
  });

  it("highlights plain-feature declarations, symbols, and matrices", () => {
    const line = "Symbol t' [voiceless alveolar stop +consonant]";
    const tokens = tokenizeLexurgyLine(line, state());
    expect(text(line, tokens)).toEqual([
      "Symbol",
      "t'",
      "[",
      "voiceless",
      "alveolar",
      "stop",
      "+consonant",
      "]",
    ]);
    expect(tags(tokens)).toEqual([
      "keyword",
      "symbol",
      "punctuation",
      "featureValue",
      "featureValue",
      "featureValue",
      "featureValue",
      "punctuation",
    ]);
  });

  it("highlights feature values in a declaration", () => {
    const line = "Feature +vowel, +consonant";
    const tokens = tokenizeLexurgyLine(line, state());
    expect(text(line, tokens)).toEqual(["Feature", "+vowel", ",", "+consonant"]);
    expect(tags(tokens)).toEqual(["keyword", "featureValue", "punctuation", "featureValue"]);
  });

  it("highlights rule names and arrows", () => {
    const line = "Lenition:";
    expect(tags(tokenizeLexurgyLine(line, state()))).toEqual(["ruleName", "punctuation"]);
    const rule = " p => b / [+vowel] _ [+vowel]";
    const tokens = tokenizeLexurgyLine(rule, state());
    expect(tags(tokens)).toEqual([
      "operator",
      "operator",
      "punctuation",
      "featureValue",
      "punctuation",
      "operator",
      "punctuation",
      "featureValue",
      "punctuation",
    ]);
  });

  it("highlights Then/Else blocks and modifiers", () => {
    const line = " Then: [+stress] => [-stress]";
    const tokens = tokenizeLexurgyLine(line, state());
    expect(tokens[0]).toMatchObject({ tag: "keyword" });
    expect(tokens[1]).toMatchObject({ tag: "punctuation" });
    expect(tags(tokenizeLexurgyLine("Propagate:", state()))).toContain("ruleName");
    expect(tags(tokenizeLexurgyLine("Syllables:", state()))).toEqual([
      "keyword",
      "punctuation",
    ]);
  });

  it("highlights class/element declarations and references", () => {
    const classLine = "Class stop {p, b, t}";
    const classTokens = tokenizeLexurgyLine(classLine, state());
    expect(text(classLine, classTokens)).toEqual([
      "Class",
      "stop",
      "{",
      "p",
      ",",
      "b",
      ",",
      "t",
      "}",
    ]);
    expect(classTokens.filter((token) => token.tag === "elementName")).toHaveLength(4);
    const ref = tokenizeLexurgyLine(" @stop => r", state());
    expect(ref[0]).toMatchObject({ tag: "elementRef" });
  });

  it("highlights captures, repeaters, and boundaries", () => {
    const line = " {b, d}$1 => * / _ $1";
    const tokens = tokenizeLexurgyLine(line, state());
    expect(tokens.some((token) => token.tag === "capture")).toBe(true);
    expect(text(line, tokens)).toContain("$1");
    expect(tags(tokenizeLexurgyLine(" a => e / _ $", state()))).toContain("operator");
    expect(tags(tokenizeLexurgyLine(" b => v / _ (an)* a $", state()))).toContain("operator");
  });

  it("highlights romanizers and comments", () => {
    const line = "Romanizer-Literal: a => á # comment";
    const tokens = tokenizeLexurgyLine(line, state());
    expect(tokens.map((token) => token.tag)).toContain("ruleName");
    expect(tokens.map((token) => token.tag)).toContain("keyword");
    expect(tokens[tokens.length - 1].tag).toBe("comment");
  });

  it("ignores escaped hashes and leaves conlang text uncoloured", () => {
    const line = "# just a comment";
    expect(tags(tokenizeLexurgyLine(line, state()))).toEqual(["comment"]);
    const word = " pata";
    expect(tags(tokenizeLexurgyLine(word, state()))).toEqual([]);
  });
});
