import { describe, expect, it } from "vitest";
import {
  cleanLexurgyMessage,
  encodeRequest,
  extractErrorLine,
  parseResponseLine,
} from "../../src/lexurgy/protocol";

describe("Lexurgy wire protocol", () => {
  it("encodes exactly one newline-terminated JSON request", () => {
    const encoded = encodeRequest({ type: "apply", words: ["apa", "eke"] });
    expect(encoded.endsWith("\n")).toBe(true);
    expect(encoded.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(encoded)).toEqual({ type: "apply", words: ["apa", "eke"] });
  });

  it("parses changed responses and normalizes missing intermediates", () => {
    const response = parseResponseLine(
      JSON.stringify({ type: "changed", words: ["aba"], traceLines: [] })
    );
    expect(response).toEqual({
      type: "changed",
      words: ["aba"],
      intermediates: {},
      traceLines: [],
    });
  });

  it("rejects malformed responses", () => {
    expect(() => parseResponseLine("")).toThrow(/empty/i);
    expect(() => parseResponseLine("not json")).toThrow(/invalid JSON/i);
    expect(() => parseResponseLine(JSON.stringify({ type: "wat" }))).toThrow(
      /unrecognised/i
    );
  });

  it("extracts Lexurgy line numbers", () => {
    expect(extractErrorLine('The rules are incomplete (line 6)')).toBe(6);
    expect(extractErrorLine("error at line 12: nope")).toBe(12);
    expect(extractErrorLine("no location")).toBeUndefined();
  });

  it("cleans parser fragments from messages", () => {
    expect(cleanLexurgyMessage('"\\n " doesn\'t make sense (line 4)')).toBe(
      "doesn't make sense (line 4)"
    );
  });
});

describe("error line location", () => {
  it("finds a rule header named in a Lexurgy error", async () => {
    const { locateErrorLine } = await import("../../src/lexurgy/service");
    const source = ["Feature +vowel", "Symbol a [+vowel]", "", "Umlaut:", " a => e", "", "Other:", " e => i"].join("\n");
    expect(
      locateErrorLine(
        source,
        'Error in expression 2 ("a => e") of rule "Umlaut"\nThe feature value "x" is not defined'
      )
    ).toBe(4);
  });

  it("prefers an explicit line number", async () => {
    const { locateErrorLine } = await import("../../src/lexurgy/service");
    expect(locateErrorLine("A:\n a => b", "Bad (line 2)")).toBe(2);
  });
});
