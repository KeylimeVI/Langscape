/**
 * Minimal OpenType/TrueType metadata inspector (`name` and `cmap` tables).
 *
 * Reads the human-readable family name, detects the actual binary container
 * format, and inspects Unicode coverage so fonts without lowercase ASCII
 * glyphs (e.g. Gothic, Runic, uppercase-only, or PUA conlang scripts) still
 * render real glyphs in preview panes.
 */

export interface ParsedFontNames {
  family?: string;
  subfamily?: string;
  fullName?: string;
  postScriptName?: string;
  version?: string;
}

export interface FontInspection {
  names: ParsedFontNames;
  detectedFormat?: string;
  autoSample?: string;
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

const UPPERCASE_ASCII_SAMPLE = "THE QUICK BROWN FOX — 1234567890";

export function inspectFontData(data: Uint8Array): FontInspection {
  if (data.byteLength < 12) return { names: {} };
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const signature = readTag(view, 0);

  if (signature === "wOFF") {
    return { names: {}, detectedFormat: "woff" };
  }
  if (signature === "wOF2") {
    return { names: {}, detectedFormat: "woff2" };
  }
  if (signature === "ttcf") {
    // TrueType collection: inspect the first font's offset table when valid.
    if (data.byteLength >= 16) {
      const firstOffset = view.getUint32(12, false);
      if (firstOffset >= 12 && firstOffset + 12 <= data.byteLength) {
        const inner = inspectSfnt(view, firstOffset, data.byteLength);
        return { ...inner, detectedFormat: "truetype" };
      }
    }
    return { names: {}, detectedFormat: "truetype" };
  }

  const detectedFormat = sfntFormat(signature);
  if (!detectedFormat) return { names: {} };
  const result = inspectSfnt(view, 0, data.byteLength);
  return { ...result, detectedFormat };
}

export function parseFontNames(data: Uint8Array): ParsedFontNames {
  return inspectFontData(data).names;
}

function sfntFormat(signature: string): string | undefined {
  if (signature === "\u0000\u0001\u0000\u0000" || signature === "true" || signature === "typ1") {
    return "truetype";
  }
  if (signature === "OTTO") return "opentype";
  return undefined;
}

function inspectSfnt(
  view: DataView,
  sfntOffset: number,
  byteLength: number
): Omit<FontInspection, "detectedFormat"> {
  if (sfntOffset + 12 > byteLength) return { names: {} };
  const signature = readTag(view, sfntOffset);
  if (!sfntFormat(signature)) return { names: {} };

  const numTables = view.getUint16(sfntOffset + 4, false);
  if (numTables <= 0 || numTables > 512) return { names: {} };

  let nameTable: SfntTable | undefined;
  let cmapTable: SfntTable | undefined;
  for (let i = 0; i < numTables; i++) {
    const offset = sfntOffset + 12 + i * 16;
    if (offset + 16 > byteLength) return { names: {} };
    const tag = readTag(view, offset);
    const tableOffset = view.getUint32(offset + 8, false);
    const tableLength = view.getUint32(offset + 12, false);
    if (tableOffset + tableLength > byteLength) continue;
    if (tag === "name") nameTable = { offset: tableOffset, length: tableLength };
    else if (tag === "cmap") cmapTable = { offset: tableOffset, length: tableLength };
    if (nameTable && cmapTable) break;
  }

  const names = nameTable ? parseNameTable(view, nameTable.offset, nameTable.length) : {};
  const autoSample = cmapTable ? detectSampleFromCmap(view, cmapTable.offset, cmapTable.length) : undefined;
  return { names, autoSample };
}

function parseNameTable(
  view: DataView,
  tableOffset: number,
  tableLength: number
): ParsedFontNames {
  if (tableLength < 6) return {};
  const format = view.getUint16(tableOffset, false);
  if (format !== 0 && format !== 1) return {};
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

  // In both format 0 and format 1, nameRecord[count] begins immediately at
  // offset 6. Format 1 places langTagCount after the name records.
  const recordsStart = tableOffset + 6;
  for (let i = 0; i < count; i++) {
    const recordOffset = recordsStart + i * 12;
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

    const text = decodeName(view, start, length, platform, encoding)
      .replace(/\u0000/g, "")
      .trim();
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

function detectSampleFromCmap(
  view: DataView,
  tableOffset: number,
  tableLength: number
): string | undefined {
  if (tableLength < 4) return undefined;
  const numSubtables = view.getUint16(tableOffset + 2, false);
  if (numSubtables === 0 || numSubtables > 256) return undefined;

  let bestSubtableOffset = -1;
  let bestFormat = -1;
  let bestScore = -1;

  for (let i = 0; i < numSubtables; i++) {
    const rec = tableOffset + 4 + i * 8;
    if (rec + 8 > tableOffset + tableLength) break;
    const platform = view.getUint16(rec, false);
    const encoding = view.getUint16(rec + 2, false);
    const subOffset = view.getUint32(rec + 4, false);
    const abs = tableOffset + subOffset;
    if (abs + 4 > tableOffset + tableLength) continue;
    const format = view.getUint16(abs, false);
    if (format !== 4 && format !== 12) continue;

    let score = 0;
    if (format === 12) score += 100;
    else if (format === 4) score += 50;
    if (platform === 3 && encoding === 10) score += 40;
    else if (platform === 0 && encoding >= 3) score += 35;
    else if (platform === 3 && encoding === 1) score += 30;
    else if (platform === 0) score += 20;
    else continue;

    if (score > bestScore) {
      bestScore = score;
      bestSubtableOffset = abs;
      bestFormat = format;
    }
  }

  if (bestSubtableOffset < 0) return undefined;
  const tableEnd = tableOffset + tableLength;
  const codePoints =
    bestFormat === 12
      ? readCmapFormat12(view, bestSubtableOffset, tableEnd)
      : readCmapFormat4(view, bestSubtableOffset, tableEnd);

  if (codePoints.size === 0) return undefined;

  let lowerCount = 0;
  for (let cp = 0x61; cp <= 0x7a; cp++) {
    if (codePoints.has(cp)) lowerCount++;
  }
  // Standard ASCII-mapped font (including Latin-mapped conlang fonts like Tengwar Annatar).
  if (lowerCount >= 10) return undefined;

  let upperCount = 0;
  for (let cp = 0x41; cp <= 0x5a; cp++) {
    if (codePoints.has(cp)) upperCount++;
  }
  if (upperCount >= 10) return UPPERCASE_ASCII_SAMPLE;

  const preferredPoints: number[] = [];
  const fallbackPoints: number[] = [];
  for (const cp of codePoints) {
    if (!isDisplayableSamplePoint(cp)) continue;
    const ch = String.fromCodePoint(cp);
    if (isSampleLetterOrPua(cp, ch)) {
      preferredPoints.push(cp);
      if (preferredPoints.length >= 18) break;
    } else if (fallbackPoints.length < 18) {
      fallbackPoints.push(cp);
    }
  }
  const samplePoints = preferredPoints.length > 0 ? preferredPoints : fallbackPoints;
  if (samplePoints.length === 0) return undefined;

  // Group into short word-like chunks so previews read like running script text.
  const chunks: string[] = [];
  for (let i = 0; i < samplePoints.length; i += 5) {
    chunks.push(String.fromCodePoint(...samplePoints.slice(i, i + 5)));
  }
  return chunks.join(" ");
}

function readCmapFormat4(view: DataView, offset: number, tableEnd: number): Set<number> {
  const out = new Set<number>();
  if (offset + 14 > tableEnd) return out;
  const segCountX2 = view.getUint16(offset + 6, false);
  const segCount = segCountX2 >> 1;
  if (segCount <= 0 || segCount > 4096) return out;

  const endCodesStart = offset + 14;
  const startCodesStart = endCodesStart + segCountX2 + 2;
  const idDeltasStart = startCodesStart + segCountX2;
  const idRangeOffsetsStart = idDeltasStart + segCountX2;
  if (idRangeOffsetsStart + segCountX2 > tableEnd) return out;

  for (let i = 0; i < segCount; i++) {
    const endCode = view.getUint16(endCodesStart + i * 2, false);
    const startCode = view.getUint16(startCodesStart + i * 2, false);
    if (startCode === 0xffff && endCode === 0xffff) break;
    if (startCode > endCode) continue;
    const idDelta = view.getInt16(idDeltasStart + i * 2, false);
    const idRangeOffsetPos = idRangeOffsetsStart + i * 2;
    const idRangeOffset = view.getUint16(idRangeOffsetPos, false);

    // Cap per-segment scan once we have ASCII + plenty of sample points.
    const limit = Math.min(endCode, startCode + 256);
    for (let cp = startCode; cp <= limit; cp++) {
      let glyphId = 0;
      if (idRangeOffset === 0) {
        glyphId = (cp + idDelta) & 0xffff;
      } else {
        const glyphPos = idRangeOffsetPos + idRangeOffset + (cp - startCode) * 2;
        if (glyphPos + 2 > tableEnd) break;
        const raw = view.getUint16(glyphPos, false);
        glyphId = raw === 0 ? 0 : (raw + idDelta) & 0xffff;
      }
      if (glyphId !== 0) {
        out.add(cp);
        if (out.size >= 160 && cp > 0x7a) return out;
      }
    }
  }
  return out;
}

function readCmapFormat12(view: DataView, offset: number, tableEnd: number): Set<number> {
  const out = new Set<number>();
  if (offset + 16 > tableEnd) return out;
  const numGroups = view.getUint32(offset + 12, false);
  if (numGroups > 65536) return out;

  for (let i = 0; i < numGroups; i++) {
    const groupPos = offset + 16 + i * 12;
    if (groupPos + 12 > tableEnd) break;
    const startChar = view.getUint32(groupPos, false);
    const endChar = view.getUint32(groupPos + 4, false);
    const startGlyph = view.getUint32(groupPos + 8, false);
    if (startChar > endChar || startChar > 0x10ffff) continue;

    const limit = Math.min(endChar, startChar + 256, 0x10ffff);
    for (let cp = startChar; cp <= limit; cp++) {
      const glyphId = startGlyph + (cp - startChar);
      if (glyphId !== 0) {
        out.add(cp);
        if (out.size >= 160 && cp > 0x7a) return out;
      }
    }
  }
  return out;
}

function isDisplayableSamplePoint(cp: number): boolean {
  if (cp <= 0x20) return false;
  if (cp >= 0x7f && cp <= 0xa0) return false;
  if (cp >= 0xd800 && cp <= 0xdfff) return false;
  if (cp >= 0xfdd0 && cp <= 0xfdef) return false;
  if ((cp & 0xffff) >= 0xfffe) return false;
  if (cp === 0xfeff || cp === 0x00ad || cp === 0x25cc) return false;
  return true;
}

function isSampleLetterOrPua(cp: number, ch: string): boolean {
  // Prefer Private Use Area (common for conlang scripts) and Unicode letters/numbers,
  // avoiding standalone combining marks (e.g. U+0300..U+036F) in previews.
  if (
    (cp >= 0xe000 && cp <= 0xf8ff) ||
    (cp >= 0xf0000 && cp <= 0xffffd) ||
    (cp >= 0x100000 && cp <= 0x10fffd)
  ) {
    return true;
  }
  return /^[\p{L}\p{N}]$/u.test(ch);
}

function decodeName(
  view: DataView,
  offset: number,
  length: number,
  platform: number,
  encoding: number
): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  if (platform === 3 || platform === 0) {
    // Windows and Unicode platform strings are UTF-16BE.
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
