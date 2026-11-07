import type { CustomFontConfig } from "./fonts/manager";

export interface LangscapeSettings {
  // Fonts
  autoDiscoverFonts: boolean;
  fontFolder: string;
  fontAliases: Record<string, string>;
  customFonts: CustomFontConfig[];

  // Lexurgy
  javaPath: string;
  lexurgyPath: string;

  // Sound-change test bench
  traceByDefault: boolean;
  testWords: Record<string, string>;
}

export const DEFAULT_SETTINGS: LangscapeSettings = {
  autoDiscoverFonts: true,
  fontFolder: "",
  fontAliases: {},
  customFonts: [],

  javaPath: "",
  lexurgyPath: "",

  traceByDefault: false,
  testWords: {},
};

export function mergeSettings(
  loaded: Partial<LangscapeSettings> | null | undefined
): LangscapeSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(loaded ?? {}),
    fontAliases: { ...DEFAULT_SETTINGS.fontAliases, ...(loaded?.fontAliases ?? {}) },
    testWords: { ...DEFAULT_SETTINGS.testWords, ...(loaded?.testWords ?? {}) },
    customFonts: Array.isArray(loaded?.customFonts)
      ? loaded.customFonts
          .filter((font): font is CustomFontConfig => Boolean(font && typeof font === "object"))
          .map((font, index) => ({
            id: typeof font.id === "string" ? font.id : `font-${index}`,
            name: typeof font.name === "string" ? font.name : "",
            path: typeof font.path === "string" ? font.path : undefined,
            url: typeof font.url === "string" ? font.url : undefined,
            enabled: font.enabled !== false,
            sample: typeof font.sample === "string" ? font.sample : undefined,
          }))
      : [],
  };
}
