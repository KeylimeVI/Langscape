export type FontSourceKind = "vault" | "url";
export type FontLoadStatus = "unloaded" | "loading" | "loaded" | "error";

export interface FontRecord {
  id: string;
  /** CSS font-family value. */
  family: string;
  /** Name shown in the picker / settings. */
  displayName: string;
  /** Optional short code used by the inline font syntax. */
  nickname?: string;
  /** Generated CSS class carrying the font-family rule. */
  className: string;
  source: FontSourceKind;
  /** Vault-relative path for source === "vault". */
  path?: string;
  /** Remote font URL for source === "url". */
  url?: string;
  /** CSS format() hint, e.g. "truetype". */
  format?: string;
  /** Settings entry id when this font was added as a custom font. */
  customId?: string;
  /** Auto-detected preview sample for scripts that do not map lowercase ASCII. */
  autoSample?: string;
  /** Current browser FontFace load status. */
  loadStatus?: FontLoadStatus;
  /** Human-readable error when the font file could not be read or decoded. */
  loadError?: string;
}

export function fontFormatFromPath(filePath: string): string | undefined {
  const clean = filePath.split(/[?#]/, 1)[0];
  const ext = clean.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ttf":
    case "ttc":
      return "truetype";
    case "otf":
      return "opentype";
    case "woff":
      return "woff";
    case "woff2":
      return "woff2";
    default:
      return undefined;
  }
}

export function isFontFile(filePath: string): boolean {
  return /\.(ttf|otf|woff2?|ttc)$/i.test(filePath);
}

export function escapeCssString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, " ")
    .trim();
}

export function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return slug || "font";
}

export function fontFaceSource(url: string, format?: string): string {
  return `url("${escapeCssString(url)}")${format ? ` format("${escapeCssString(format)}")` : ""}`;
}

export function fontFamilyValue(record: FontRecord): string {
  return `"${escapeCssString(record.family)}"`;
}

export function fontFamilyAttribute(record: FontRecord): string {
  return `--langscape-font-family: ${fontFamilyValue(record)}`;
}

export function makeFontId(pathOrUrl: string, family: string): string {
  let hash = 0x811c9dc5;
  const input = `${pathOrUrl}\u0000${family}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${slugify(family)}-${(hash >>> 0).toString(36)}`;
}

export function classNameForId(id: string): string {
  return `langscape-font-${id.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`;
}
