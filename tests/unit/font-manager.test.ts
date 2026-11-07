// @vitest-environment jsdom
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { TFile, TFolder } from "obsidian";
import { FontManager, type FontManagerSettings } from "../../src/fonts/manager";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fontBytes = await fs.readFile(path.join(root, "tests/fixtures/fonts/NotoSansGothic-Regular.ttf"));

class Vault {
  files: TFile[] = [];
  folders = new Set<string>();
  adapter = {
    getResourcePath: (p: string) => `app://local/${p}`,
  };
  getFiles(): TFile[] {
    return this.files;
  }
  getAbstractFileByPath(p: string): TFile | TFolder | null {
    return this.files.find((file) => file.path === p) ?? (this.folders.has(p) ? new (TFolder as any)(p) : null);
  }
  async readBinary(): Promise<ArrayBuffer> {
    return fontBytes.buffer.slice(
      fontBytes.byteOffset,
      fontBytes.byteOffset + fontBytes.byteLength
    ) as ArrayBuffer;
  }
}

function settings(overrides: Partial<FontManagerSettings> = {}): FontManagerSettings {
  return {
    autoDiscoverFonts: true,
    fontFolder: "",
    fontAliases: {},
    customFonts: [],
    ...overrides,
  };
}

function file(path: string): TFile {
  const f = new (TFile as any)(path) as TFile;
  f.stat.mtime = 1;
  f.stat.size = fontBytes.length;
  return f;
}

describe("FontManager", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  it("discovers TTF files, reads their family, and injects CSS", async () => {
    const vault = new Vault();
    vault.files.push(file("Fonts/NotoSansGothic-Regular.ttf"));
    const manager = new FontManager({ vault } as any, () => settings());
    const fonts = await manager.refresh();
    expect(fonts).toHaveLength(1);
    expect(fonts[0]).toMatchObject({
      family: "Noto Sans Gothic",
      displayName: "Noto Sans Gothic",
      source: "vault",
      path: "Fonts/NotoSansGothic-Regular.ttf",
    });
    expect(document.getElementById("langscape-font-faces")?.textContent).toContain(
      '@font-face'
    );
    expect(document.getElementById("langscape-font-faces")?.textContent).toContain(
      "Noto Sans Gothic"
    );
    expect(manager.find("noto sans gothic")?.path).toBe("Fonts/NotoSansGothic-Regular.ttf");
    expect(manager.find("missing")).toBeUndefined();
  });

  it("honours the font folder and aliases", async () => {
    const vault = new Vault();
    vault.files.push(file("Fonts/A.ttf"), file("Other/B.ttf"));
    const manager = new FontManager({ vault } as any, () =>
      settings({
        fontFolder: "Fonts",
        fontAliases: { "Fonts/A.ttf": "Tengwar" },
      })
    );
    const fonts = await manager.refresh();
    expect(fonts).toHaveLength(1);
    expect(fonts[0].displayName).toBe("Tengwar");
    expect(manager.find("tengwar")?.path).toBe("Fonts/A.ttf");
  });

  it("loads pinned fonts when auto-discovery is off", async () => {
    const vault = new Vault();
    vault.files.push(file("Elsewhere/Script.ttf"));
    const manager = new FontManager({ vault } as any, () =>
      settings({
        autoDiscoverFonts: false,
        customFonts: [
          {
            id: "pinned",
            name: "Script",
            path: "Elsewhere/Script.ttf",
            enabled: true,
          },
        ],
      })
    );
    const fonts = await manager.refresh();
    expect(fonts).toHaveLength(1);
    expect(fonts[0].path).toBe("Elsewhere/Script.ttf");
    expect(fonts[0].displayName).toBe("Script");
  });

  it("adds web fonts by URL and builds their @font-face", async () => {
    const vault = new Vault();
    const manager = new FontManager({ vault } as any, () =>
      settings({
        autoDiscoverFonts: false,
        customFonts: [
          {
            id: "web",
            name: "Webfont",
            url: "https://example.com/font.woff2",
            enabled: true,
          },
        ],
      })
    );
    const fonts = await manager.refresh();
    expect(fonts[0]).toMatchObject({
      family: "Webfont",
      source: "url",
      format: "woff2",
    });
    expect(document.getElementById("langscape-font-faces")?.textContent).toContain(
      "https://example.com/font.woff2"
    );
  });

  it("disambiguates duplicate family names", async () => {
    const vault = new Vault();
    vault.files.push(file("Fonts/A.ttf"), file("Fonts/B.ttf"));
    const manager = new FontManager({ vault } as any, () =>
      settings({ fontAliases: { "Fonts/A.ttf": "Script", "Fonts/B.ttf": "Script" } })
    );
    const fonts = await manager.refresh();
    expect(fonts.map((font) => font.family)).toEqual(["Script", "Script (2)"]);
  });
});
