import { describe, expect, it } from "vitest";
import {
  extractMarkdownWords,
  inlineWords,
  parseWli,
  splitFrontmatter,
} from "../../src/pipeline/words";

describe("word extraction", () => {
  it("reads a word from frontmatter", () => {
    const source = ["---", "word: kata", "gloss: stone", "---", "# kata", "Body"].join("\n");
    const words = extractMarkdownWords(source, "Words/Proto/kata.md");
    expect(words).toHaveLength(1);
    expect(words[0]).toMatchObject({
      word: "kata",
      sourcePath: "Words/Proto/kata.md",
      meta: { word: "kata", gloss: "stone" },
    });
  });

  it("reads arrays and custom fields", () => {
    const source = ["---", "lexeme: [apa, eke]", "---"].join("\n");
    const words = extractMarkdownWords(source, "Words/Proto/list.md", "lexeme");
    expect(words.map((entry) => entry.word)).toEqual(["apa", "eke"]);
  });

  it("reads a langscape-words code block and deduplicates", () => {
    const source = [
      "---",
      "word: kata",
      "---",
      "```langscape-words",
      "kata",
      "katu",
      "",
      "```",
    ].join("\n");
    expect(extractMarkdownWords(source, "Words/Proto/kata.md").map((entry) => entry.word)).toEqual([
      "kata",
      "katu",
    ]);
  });

  it("does not treat an empty frontmatter as an error", () => {
    expect(splitFrontmatter("no frontmatter").data).toEqual({});
    expect(extractMarkdownWords("no frontmatter", "a.md")).toEqual([]);
  });

  it("parses .wli lines and comments", () => {
    expect(parseWli("# comment\napa\n\n eke \n", "Words/list.wli")).toEqual([
      { word: "apa", sourcePath: "Words/list.wli", meta: {} },
      { word: "eke", sourcePath: "Words/list.wli", meta: {} },
    ]);
  });

  it("creates inline entries", () => {
    expect(inlineWords([" apa ", "", "eke"]).map((entry) => entry.word)).toEqual(["apa", "eke"]);
  });
});
