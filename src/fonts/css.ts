export type FontSourceKind = "vault" | "url";

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
}

export function fontFormatFromPath(filePath: string): string | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase();
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

/**
 * Build the stylesheet injected into Obsidian's document head.
 * `urlFor` is injected so this is testable without a vault.
 */
export function buildFontCss(
  records: FontRecord[],
  urlFor: (record: FontRecord) => string | undefined
): string {
  const faces: string[] = [];
  const classes: string[] = [];
  const seen = new Set<string>();

  for (const record of records) {
    const family = escapeCssString(record.family);
    if (!family) continue;
    const url = urlFor(record);
    if (!url) continue;
    const format = record.format ? ` format("${escapeCssString(record.format)}")` : "";
    const faceKey = `${family}\u0000${url}`;
    if (!seen.has(faceKey)) {
      seen.add(faceKey);
      faces.push(
        `@font-face {\n` +
          `  font-family: "${family}";\n` +
          `  src: url("${escapeCssString(url)}")${format};\n` +
          `  font-display: swap;\n` +
          `}`
      );
    }
    classes.push(
      `.${record.className} {\n  font-family: "${family}", var(--font-text);\n}`
    );
  }

  return [...faces, ...classes].join("\n\n") + (faces.length ? "\n" : "");
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
