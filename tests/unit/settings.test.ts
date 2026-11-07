import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "../../src/settings";

describe("settings", () => {
  it("returns defaults for an empty data file", () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("merges nested maps without losing defaults", () => {
    const settings = mergeSettings({
      fontFolder: "Fonts",
      fontAliases: { "Fonts/a.ttf": "A" },
      testWords: { "Changes/a.lsc": "apa" },
    });
    expect(settings.fontFolder).toBe("Fonts");
    expect(settings.fontAliases["Fonts/a.ttf"]).toBe("A");
    expect(settings.testWords["Changes/a.lsc"]).toBe("apa");
    expect(settings.traceByDefault).toBe(DEFAULT_SETTINGS.traceByDefault);
  });

  it("sanitizes malformed custom font entries", () => {
    const settings = mergeSettings({
      customFonts: [
        { id: "a", name: "A", path: "Fonts/a.ttf", enabled: false },
        null as any,
        { name: 42 },
      ],
    });
    expect(settings.customFonts).toHaveLength(2);
    expect(settings.customFonts[0]).toMatchObject({ id: "a", enabled: false });
    expect(settings.customFonts[1]).toMatchObject({ id: "font-1", name: "", enabled: true });
  });
});
