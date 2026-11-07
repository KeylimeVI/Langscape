import { describe, expect, it } from "vitest";
import {
  findFontSpans,
  formatFontSpan,
  parseFontSpanSegments,
} from "../../src/fonts/spans";

describe("font span syntax", () => {
  it("finds multiple spans and their content offsets", () => {
    const text = "Say {font:Tengwar|elen síla} and {font:Runic|ᚠᚢ}.";
    const spans = findFontSpans(text);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({ name: "Tengwar", content: "elen síla" });
    expect(text.slice(spans[0].contentStart, spans[0].contentEnd)).toBe("elen síla");
    expect(spans[1].name).toBe("Runic");
    expect(text.slice(spans[1].start, spans[1].end)).toBe("{font:Runic|ᚠᚢ}");
  });

  it("supports spaces and punctuation in font names", () => {
    const spans = findFontSpans("{font:Noto Sans Gothic|𐌰𐌱}");
    expect(spans[0]?.name).toBe("Noto Sans Gothic");
  });

  it("ignores malformed spans", () => {
    expect(findFontSpans("{font:Tengwar}")).toEqual([]);
    expect(findFontSpans("{font:|x}")).toEqual([]);
    expect(findFontSpans("{font:Tengwar|x")).toEqual([]);
    expect(findFontSpans("{font:Tengwar|x\ny}")).toEqual([]);
  });

  it("supports escaping the opening marker", () => {
    expect(findFontSpans("\\{font:Tengwar|x}")).toEqual([]);
    const segments = parseFontSpanSegments(
      "\\{font:Tengwar|x}",
      () => true
    );
    expect(segments).toEqual([{ type: "text", text: "{font:Tengwar|x}" }]);
  });

  it("leaves unknown fonts as visible text", () => {
    const segments = parseFontSpanSegments("a {font:Missing|x} b", () => false);
    expect(segments).toEqual([{ type: "text", text: "a {font:Missing|x} b" }]);
  });

  it("splits known spans into segments", () => {
    const segments = parseFontSpanSegments("a {font:Foo|x} b", (name) => name === "Foo");
    expect(segments).toEqual([
      { type: "text", text: "a " },
      { type: "span", text: "x", name: "Foo" },
      { type: "text", text: " b" },
    ]);
  });

  it("formats a span for insertion", () => {
    expect(formatFontSpan("Noto Sans", "hello")).toBe("{font:Noto Sans|hello}");
    expect(formatFontSpan("Bad|Name", "a}b")).toBe("{font:BadName|a b}");
  });
});
