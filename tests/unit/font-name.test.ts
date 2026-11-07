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
