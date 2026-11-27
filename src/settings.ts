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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") result[key] = entry;
  }
  return result;
}

export function mergeSettings(raw: unknown): LangscapeSettings {
  const loaded = isRecord(raw) ? raw : undefined;
  return {
    ...DEFAULT_SETTINGS,
    javaPath: typeof loaded?.javaPath === "string" ? loaded.javaPath : DEFAULT_SETTINGS.javaPath,
    lexurgyPath:
      typeof loaded?.lexurgyPath === "string" ? loaded.lexurgyPath : DEFAULT_SETTINGS.lexurgyPath,
    traceByDefault:
      typeof loaded?.traceByDefault === "boolean"
        ? loaded.traceByDefault
        : DEFAULT_SETTINGS.traceByDefault,
    treeAlignment: loaded?.treeAlignment === "left" ? "left" : "center",
    lexurgyPanelWidth:
      typeof loaded?.lexurgyPanelWidth === "number" && Number.isFinite(loaded.lexurgyPanelWidth)
        ? Math.max(280, loaded.lexurgyPanelWidth)
        : DEFAULT_SETTINGS.lexurgyPanelWidth,
    fontNicknames: { ...DEFAULT_SETTINGS.fontNicknames, ...stringMap(loaded?.fontNicknames) },
    fontAliases: { ...DEFAULT_SETTINGS.fontAliases, ...stringMap(loaded?.fontAliases) },
    testWords: { ...DEFAULT_SETTINGS.testWords, ...stringMap(loaded?.testWords) },
    customFonts: Array.isArray(loaded?.customFonts)
      ? loaded.customFonts
          .filter((font): font is Record<string, unknown> => isRecord(font))
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
