import { describe, expect, it } from "vitest";
import {
  buildFontCss,
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
  it("builds @font-face and class rules", () => {
    const css = buildFontCss([record()], () => 'app://local/Fonts/tengwar.ttf');
    expect(css).toContain('@font-face');
    expect(css).toContain('font-family: "Tengwar"');
    expect(css).toContain('src: url("app://local/Fonts/tengwar.ttf") format("truetype")');
    expect(css).toContain(".langscape-font-tengwar-abc");
    expect(css).toContain('font-family: "Tengwar", var(--font-text)');
  });

  it("omits records without a usable URL and deduplicates faces", () => {
    const css = buildFontCss(
      [record(), record({ className: "langscape-font-second" }), record({ id: "other", path: "other.ttf" })],
      (font) => (font.path === "other.ttf" ? undefined : "app://local/tengwar.ttf")
    );
    expect(css.match(/@font-face/g)).toHaveLength(1);
    expect(css).not.toContain("other.ttf");
    expect(css).toContain(".langscape-font-second");
  });

  it("escapes dangerous CSS strings", () => {
    expect(escapeCssString('Foo"Bar\\Baz\nQux')).toBe('Foo\\"Bar\\\\Baz Qux');
    const css = buildFontCss([record({ family: 'Bad"Font' })], () => "x.ttf");
    expect(css).toContain('font-family: "Bad\\"Font"');
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
