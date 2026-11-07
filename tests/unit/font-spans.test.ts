import { describe, expect, it } from "vitest";
import {
  findFontSpans,
  formatFontSpan,
  parseFontSpanSegments,
} from "../../src/fonts/spans";

describe("font span syntax", () => {
  it("finds inline nickname spans", () => {
    const text = "Say {tengwar: elen síla} and {runic: ᚠᚢ}.";
    const spans = findFontSpans(text);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({ name: "tengwar", content: "elen síla" });
    expect(text.slice(spans[0].contentStart, spans[0].contentEnd)).toBe("elen síla");
    expect(spans[1].name).toBe("runic");
    expect(text.slice(spans[1].start, spans[1].end)).toBe("{runic: ᚠᚢ}");
  });

  it("still supports the earlier triple-quote form", () => {
    const text = "Say '''tengwar elen síla'''.";
    const spans = findFontSpans(text);
    expect(spans[0]).toMatchObject({ name: "tengwar", content: "elen síla" });
  });

  it("still supports legacy {font:Name|text} spans", () => {
    const text = "Say {font:Tengwar|elen síla}.";
    const spans = findFontSpans(text);
    expect(spans[0]).toMatchObject({ name: "Tengwar", content: "elen síla" });
  });

  it("ignores malformed spans", () => {
    expect(findFontSpans("{tengwar}")).toEqual([]);
    expect(findFontSpans("{: x}")).toEqual([]);
    expect(findFontSpans("{tengwar: }")).toEqual([]);
    expect(findFontSpans("{tengwar: x")).toEqual([]);
    expect(findFontSpans("{tengwar: x\ny}")).toEqual([]);
    expect(findFontSpans("'''tengwar'''")).toEqual([]);
    expect(findFontSpans("'''tengwar elen")).toEqual([]);
    expect(findFontSpans("{font:Tengwar}")).toEqual([]);
  });

  it("supports escaping the opening marker", () => {
    expect(findFontSpans("\\{tengwar: x}")).toEqual([]);
    expect(findFontSpans("\\'''tengwar x'''")).toEqual([]);
    expect(parseFontSpanSegments("\\{tengwar: x}", () => true)).toEqual([
      { type: "text", text: "{tengwar: x}" },
    ]);
    expect(parseFontSpanSegments("\\'''tengwar x'''", () => true)).toEqual([
      { type: "text", text: "'''tengwar x'''" },
    ]);
  });

  it("leaves unknown fonts as visible text", () => {
    expect(parseFontSpanSegments("a {missing: x} b", () => false)).toEqual([
      { type: "text", text: "a {missing: x} b" },
    ]);
    expect(parseFontSpanSegments("a '''missing x''' b", () => false)).toEqual([
      { type: "text", text: "a '''missing x''' b" },
    ]);
  });

  it("splits known spans into segments", () => {
    expect(parseFontSpanSegments("a {foo: x} b", (name) => name === "foo")).toEqual([
      { type: "text", text: "a " },
      { type: "span", text: "x", name: "foo" },
      { type: "text", text: " b" },
    ]);
    expect(parseFontSpanSegments("a '''foo x''' b", (name) => name === "foo")).toEqual([
      { type: "text", text: "a " },
      { type: "span", text: "x", name: "foo" },
      { type: "text", text: " b" },
    ]);
  });

  it("formats the preferred brace span for insertion", () => {
    expect(formatFontSpan("Noto Sans", "hello")).toBe("{Noto-Sans: hello}");
    expect(formatFontSpan("Bad|Name", "a'b\nc")).toBe("{BadName: a'b c}");
  });
});
