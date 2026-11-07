import { describe, expect, it } from "vitest";
import {
  findFontSpans,
  formatFontSpan,
  parseFontSpanSegments,
} from "../../src/fonts/spans";

describe("font span syntax", () => {
  it("finds inline triple-quote spans with a nickname", () => {
    const text = "Say '''tengwar elen síla''' and '''runic ᚠᚢ'''.";
    const spans = findFontSpans(text);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({ name: "tengwar", content: "elen síla" });
    expect(text.slice(spans[0].contentStart, spans[0].contentEnd)).toBe("elen síla");
    expect(spans[1].name).toBe("runic");
    expect(text.slice(spans[1].start, spans[1].end)).toBe("'''runic ᚠᚢ'''");
  });

  it("finds legacy spans and their content offsets", () => {
    const text = "Say {font:Tengwar|elen síla} and {font:Runic|ᚠᚢ}.";
    const spans = findFontSpans(text);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({ name: "Tengwar", content: "elen síla" });
    expect(text.slice(spans[0].contentStart, spans[0].contentEnd)).toBe("elen síla");
    expect(spans[1].name).toBe("Runic");
    expect(text.slice(spans[1].start, spans[1].end)).toBe("{font:Runic|ᚠᚢ}");
  });

  it("supports spaces and punctuation in legacy font names", () => {
    const spans = findFontSpans("{font:Noto Sans Gothic|𐌰𐌱}");
    expect(spans[0]?.name).toBe("Noto Sans Gothic");
  });

  it("ignores malformed spans", () => {
    expect(findFontSpans("{font:Tengwar}")).toEqual([]);
    expect(findFontSpans("{font:|x}")).toEqual([]);
    expect(findFontSpans("{font:Tengwar|x")).toEqual([]);
    expect(findFontSpans("{font:Tengwar|x\ny}")).toEqual([]);
    expect(findFontSpans("'''tengwar'''")).toEqual([]);
    expect(findFontSpans("'''tengwar elen")).toEqual([]);
    expect(findFontSpans("'''tengwar elen\nsíla'''")).toEqual([]);
  });

  it("supports escaping the opening marker", () => {
    expect(findFontSpans("\\'''tengwar elen'''")).toEqual([]);
    expect(findFontSpans("\\{font:Tengwar|x}")).toEqual([]);
    expect(parseFontSpanSegments("\\'''tengwar elen'''", () => true)).toEqual([
      { type: "text", text: "'''tengwar elen'''" },
    ]);
    expect(parseFontSpanSegments("\\{font:Tengwar|x}", () => true)).toEqual([
      { type: "text", text: "{font:Tengwar|x}" },
    ]);
  });

  it("leaves unknown fonts as visible text", () => {
    expect(parseFontSpanSegments("a {font:Missing|x} b", () => false)).toEqual([
      { type: "text", text: "a {font:Missing|x} b" },
    ]);
    expect(parseFontSpanSegments("a '''missing x''' b", () => false)).toEqual([
      { type: "text", text: "a '''missing x''' b" },
    ]);
  });

  it("splits known spans into segments", () => {
    expect(parseFontSpanSegments("a {font:Foo|x} b", (name) => name === "Foo")).toEqual([
      { type: "text", text: "a " },
      { type: "span", text: "x", name: "Foo" },
      { type: "text", text: " b" },
    ]);
    expect(parseFontSpanSegments("a '''foo x''' b", (name) => name === "foo")).toEqual([
      { type: "text", text: "a " },
      { type: "span", text: "x", name: "foo" },
      { type: "text", text: " b" },
    ]);
  });

  it("formats the preferred triple-quote span for insertion", () => {
    expect(formatFontSpan("Noto Sans", "hello")).toBe("'''Noto-Sans hello'''");
    expect(formatFontSpan("Bad|Name", "a'b\nc")).toBe("'''BadName a'b c'''");
  });
});
