/**
 * Minimal OpenType/TrueType `name` table reader.
 *
 * We only need the human-readable family name so that dropping a .ttf into the
 * vault gives a sensible font picker entry. WOFF2 is compressed and is skipped
 * here (the filename fallback is used instead).
 */

export interface ParsedFontNames {
  family?: string;
  subfamily?: string;
  fullName?: string;
  postScriptName?: string;
  version?: string;
}

interface SfntTable {
  offset: number;
  length: number;
}

const NAME_IDS = {
  family: 1,
  subfamily: 2,
  fullName: 4,
  version: 5,
  postScriptName: 6,
  typographicFamily: 16,
  typographicSubfamily: 17,
} as const;

export function parseFontNames(data: Uint8Array): ParsedFontNames {
  if (data.byteLength < 12) return {};
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const signature = readTag(view, 0);

  if (signature === "wOFF" || signature === "wOF2") {
    // WOFF1 would need zlib decompression; WOFF2 uses Brotli. The filename
    // fallback is good enough there, so don't pretend to parse them.
    return {};
  }

  if (
    signature !== "\u0000\u0001\u0000\u0000" &&
    signature !== "OTTO" &&
    signature !== "true" &&
    signature !== "typ1"
  ) {
    return {};
  }

  const numTables = view.getUint16(4, false);
  if (numTables <= 0 || numTables > 512) return {};

  let nameTable: SfntTable | undefined;
  for (let i = 0; i < numTables; i++) {
    const offset = 12 + i * 16;
    if (offset + 16 > data.byteLength) return {};
    const tag = readTag(view, offset);
    const tableOffset = view.getUint32(offset + 8, false);
    const tableLength = view.getUint32(offset + 12, false);
    if (tableOffset + tableLength > data.byteLength) continue;
    if (tag === "name") {
      nameTable = { offset: tableOffset, length: tableLength };
      break;
    }
  }
  if (!nameTable) return {};

  return parseNameTable(view, nameTable.offset, nameTable.length);
}

function parseNameTable(
  view: DataView,
  tableOffset: number,
  tableLength: number
): ParsedFontNames {
  if (tableLength < 6) return {};
  const format = view.getUint16(tableOffset, false);
  const count = view.getUint16(tableOffset + 2, false);
  const stringOffset = view.getUint16(tableOffset + 4, false);
  if (count > 4096) return {};
  const stringsStart = tableOffset + stringOffset;
  const stringsEnd = tableOffset + tableLength;

  const records: Array<{
    platform: number;
    encoding: number;
    language: number;
    nameId: number;
    text: string;
    score: number;
  }> = [];

  for (let i = 0; i < count; i++) {
    const recordOffset = tableOffset + 6 + i * 12;
    if (recordOffset + 12 > tableOffset + tableLength) break;
    const platform = view.getUint16(recordOffset, false);
    const encoding = view.getUint16(recordOffset + 2, false);
    const language = view.getUint16(recordOffset + 4, false);
    const nameId = view.getUint16(recordOffset + 6, false);
    const length = view.getUint16(recordOffset + 8, false);
    const offset = view.getUint16(recordOffset + 10, false);
    const start = stringsStart + offset;
    const end = start + length;
    if (start < tableOffset || end > stringsEnd) continue;

    // Name IDs are stable between format 0 and 1; the language-tag records in
    // format 1 come after the standard records and can be ignored here.
    const text = decodeName(view, start, length, platform, encoding).replace(
      /\u0000/g,
      ""
    ).trim();
    if (!text) continue;
    records.push({
      platform,
      encoding,
      language,
      nameId,
      text,
      score: scoreNameRecord(platform, encoding, language),
    });
  }

  const best = (id: number): string | undefined => {
    const matches = records.filter((record) => record.nameId === id);
    if (matches.length === 0) return undefined;
    matches.sort((a, b) => b.score - a.score);
    return matches[0].text;
  };

  return {
    family: best(NAME_IDS.typographicFamily) ?? best(NAME_IDS.family),
    subfamily: best(NAME_IDS.typographicSubfamily) ?? best(NAME_IDS.subfamily),
    fullName: best(NAME_IDS.fullName),
    version: best(NAME_IDS.version),
    postScriptName: best(NAME_IDS.postScriptName),
  };
}

function decodeName(
  view: DataView,
  offset: number,
  length: number,
  platform: number,
  encoding: number
): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  if (platform === 3 || (platform === 0 && encoding !== 3)) {
    // Windows and Unicode names are UTF-16BE.
    return decodeUtf16Be(bytes);
  }
  if (platform === 1 && encoding === 0) {
    // Mac Roman is close enough to Latin-1 for font family names.
    return new TextDecoder("latin1").decode(bytes);
  }
  return decodeUtf16Be(bytes);
}

function decodeUtf16Be(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-16be").decode(bytes);
  } catch {
    let out = "";
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return out;
  }
}

function scoreNameRecord(platform: number, encoding: number, language: number): number {
  let score = 0;
  if (platform === 3) score += 100;
  else if (platform === 0) score += 60;
  else if (platform === 1) score += 20;
  if (language === 0x0409) score += 40; // English (US)
  if (language === 0) score += 10;
  if (platform === 3 && (encoding === 1 || encoding === 10)) score += 10;
  return score;
}

function readTag(view: DataView, offset: number): string {
  let out = "";
  for (let i = 0; i < 4; i++) {
    const code = view.getUint8(offset + i);
    out += code === 0 ? "\u0000" : String.fromCharCode(code);
  }
  return out;
}

/** Turn `NotoSansRunic-Regular.ttf` into `Noto Sans Runic Regular`. */
export function humanizeFontFilename(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  const withoutExtension = base.replace(/\.[^.]+$/, "");
  const spaced = withoutExtension
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return spaced || "Untitled Font";
}

export function sanitizeFamilyName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}
