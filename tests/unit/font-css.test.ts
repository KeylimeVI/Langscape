import { describe, expect, it } from "vitest";
import {
  fontFaceSource,
  fontFamilyAttribute,
  classNameForId,
  escapeCssString,
  fontFormatFromPath,
  makeFontId,
  slugify,
  type FontRecord,
} from "../../src/fonts/css";

function record(overrides: Partial<FontRecord> = {}): FontRecord {
  return {
    id: "tengwar-abc",
    family: "Tengwar",
    displayName: "Tengwar",
    className: "langscape-font-tengwar-abc",
    source: "vault",
    path: "Fonts/tengwar.ttf",
    format: "truetype",
    ...overrides,
  };
}

describe("font CSS generation", () => {
  it("builds a FontFace source with an optional format", () => {
    expect(fontFaceSource('app://local/Fonts/tengwar.ttf', 'truetype'))
      .toBe('url("app://local/Fonts/tengwar.ttf") format("truetype")');
    expect(fontFaceSource('x.ttf')).toBe('url("x.ttf")');
  });

  it("escapes family and source strings", () => {
    expect(escapeCssString('Foo"Bar\\Baz\nQux')).toBe('Foo\\"Bar\\\\Baz Qux');
    expect(fontFamilyAttribute(record({ family: 'Bad"Font' }))).toBe('--langscape-font-family: "Bad\\"Font"');
  });

  it("maps extensions and builds stable, safe ids", () => {
    expect(fontFormatFromPath("a.ttf")).toBe("truetype");
    expect(fontFormatFromPath("a.OTF")).toBe("opentype");
    expect(fontFormatFromPath("a.woff2")).toBe("woff2");
    expect(fontFormatFromPath("a.png")).toBeUndefined();
    expect(makeFontId("Fonts/Foo.ttf", "Foo Bar")).toBe(makeFontId("Fonts/Foo.ttf", "Foo Bar"));
    expect(makeFontId("a", "Foo")).not.toBe(makeFontId("b", "Foo"));
    expect(classNameForId("Foo Bar!")).toBe("langscape-font-foo-bar-");
    expect(slugify("Þingvellir — 2026")).toBe("ingvellir-2026");
  });
});
