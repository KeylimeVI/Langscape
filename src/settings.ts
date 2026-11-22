import type { TreeAlignment } from "./trees/render";
import type { CustomFontConfig } from "./fonts/manager";

export interface LangscapeSettings {
  // Fonts
  fontNicknames: Record<string, string>;
  fontAliases: Record<string, string>;
  customFonts: CustomFontConfig[];

  treeAlignment: TreeAlignment;

  // Lexurgy
  javaPath: string;
  lexurgyPath: string;

  // Sound-change test bench
  traceByDefault: boolean;
  lexurgyPanelWidth: number;
  testWords: Record<string, string>;
}

export const DEFAULT_SETTINGS: LangscapeSettings = {
  fontNicknames: {},
  fontAliases: {},
  customFonts: [],

  treeAlignment: "center",
  javaPath: "",
  lexurgyPath: "",

  traceByDefault: false,
  lexurgyPanelWidth: 390,
  testWords: {},
};

export function mergeSettings(
  loaded: Partial<LangscapeSettings> | null | undefined
): LangscapeSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(loaded ?? {}),
    treeAlignment: loaded?.treeAlignment === "left" ? "left" : "center",
    lexurgyPanelWidth: typeof loaded?.lexurgyPanelWidth === "number" && Number.isFinite(loaded.lexurgyPanelWidth)
      ? Math.max(280, loaded.lexurgyPanelWidth) : DEFAULT_SETTINGS.lexurgyPanelWidth,
    fontNicknames: { ...DEFAULT_SETTINGS.fontNicknames, ...(loaded?.fontNicknames ?? {}) },
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
