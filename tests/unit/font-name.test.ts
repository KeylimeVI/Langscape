import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  humanizeFontFilename,
  parseFontNames,
  sanitizeFamilyName,
} from "../../src/fonts/font-name";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fontPath = path.join(root, "tests/fixtures/fonts/NotoSansGothic-Regular.ttf");

describe("OpenType name table parser", () => {
  it("reads the family and subfamily from a real TTF", async () => {
    const data = new Uint8Array(await fs.readFile(fontPath));
    const names = parseFontNames(data);
    expect(names.family).toBe("Noto Sans Gothic");
    expect(names.subfamily?.toLowerCase()).toContain("regular");
    expect(names.postScriptName).toBeTruthy();
  });

  it("reads a format-1 name table", () => {
    const family = "Test Font";
    const encoded = new Uint8Array(family.length * 2);
    for (let i = 0; i < family.length; i++) {
      encoded[i * 2] = family.charCodeAt(i) >> 8;
      encoded[i * 2 + 1] = family.charCodeAt(i) & 0xff;
    }
    const nameTable = new Uint8Array(20 + encoded.length);
    const table = new DataView(nameTable.buffer);
    table.setUint16(0, 1, false); // format 1
    table.setUint16(2, 1, false); // one name record
    table.setUint16(4, 20, false); // strings start at 20
    table.setUint16(6, 0, false); // no language-tag records
    table.setUint16(8, 3, false); // Windows
    table.setUint16(10, 1, false); // Unicode BMP
    table.setUint16(12, 0x409, false); // en-US
    table.setUint16(14, 1, false); // family
    table.setUint16(16, encoded.length, false);
    table.setUint16(18, 0, false);
    nameTable.set(encoded, 20);

    const font = new Uint8Array(12 + 16 + nameTable.length);
    const header = new DataView(font.buffer);
    header.setUint32(0, 0x00010000, false);
    header.setUint16(4, 1, false);
    font.set(new TextEncoder().encode("name"), 12);
    header.setUint32(20, 28, false);
    header.setUint32(24, nameTable.length, false);
    font.set(nameTable, 28);

    expect(parseFontNames(font).family).toBe(family);
  });

  it("rejects non-font data and truncated fonts", () => {
    expect(parseFontNames(new Uint8Array([1, 2, 3, 4]))).toEqual({});
    expect(parseFontNames(new Uint8Array(12))).toEqual({});
    expect(parseFontNames(new Uint8Array([0x77, 0x4f, 0x46, 0x46, 1, 0, 0, 0, 0, 0, 0, 0]))).toEqual(
      {}
    );
  });

  it("humanizes filenames for use as a fallback", () => {
    expect(humanizeFontFilename("Fonts/NotoSansRunic-Regular.ttf")).toBe(
      "Noto Sans Runic Regular"
    );
    expect(humanizeFontFilename("tengwar_annatar.otf")).toBe("tengwar annatar");
    expect(humanizeFontFilename(".ttf")).toBe("Untitled Font");
  });

  it("sanitizes control characters", () => {
    expect(sanitizeFamilyName("  Foo\u0000 Bar \n Baz ")).toBe("Foo Bar Baz");
  });
});
