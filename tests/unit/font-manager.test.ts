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
    fontNicknames: {},
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

  it("discovers TTF files in any vault folder and injects CSS", async () => {
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
    expect(document.getElementById("langscape-font-faces")?.textContent).toContain('@font-face');
    expect(document.getElementById("langscape-font-faces")?.textContent).toContain("Noto Sans Gothic");
    expect(manager.find("noto sans gothic")?.path).toBe("Fonts/NotoSansGothic-Regular.ttf");
    expect(manager.find("missing")).toBeUndefined();
  });

  it("scans every folder, honours aliases, and exposes nicknames", async () => {
    const vault = new Vault();
    vault.files.push(file("Fonts/A.ttf"), file("Other/B.ttf"));
    const manager = new FontManager({ vault } as any, () =>
      settings({
        fontAliases: { "Fonts/A.ttf": "Tengwar" },
        fontNicknames: { "Fonts/A.ttf": "teng" },
      })
    );
    const fonts = await manager.refresh();
    expect(fonts).toHaveLength(2);
    const tengwar = fonts.find((font) => font.path === "Fonts/A.ttf");
    expect(tengwar?.displayName).toBe("Tengwar");
    expect(tengwar?.nickname).toBe("teng");
    expect(manager.find("tengwar")?.path).toBe("Fonts/A.ttf");
    expect(manager.find("teng")?.path).toBe("Fonts/A.ttf");
    expect(manager.find("other")).toBeUndefined();
  });

  it("adds web fonts by URL and builds their @font-face", async () => {
    const vault = new Vault();
    const manager = new FontManager({ vault } as any, () =>
      settings({
        fontNicknames: { web: "webby" },
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
      customId: "web",
      nickname: "webby",
    });
    expect(document.getElementById("langscape-font-faces")?.textContent).toContain(
      "https://example.com/font.woff2"
    );
  });

  it("applies custom path metadata and keeps the settings entry id", async () => {
    const vault = new Vault();
    vault.files.push(file("Fonts/A.ttf"));
    const manager = new FontManager({ vault } as any, () =>
      settings({
        customFonts: [
          {
            id: "local",
            name: "Renamed Script",
            path: "Fonts/A.ttf",
            enabled: true,
            sample: "sample text",
          },
        ],
      })
    );
    const fonts = await manager.refresh();
    expect(fonts[0]).toMatchObject({
      displayName: "Renamed Script",
      source: "vault",
      path: "Fonts/A.ttf",
      customId: "local",
    });
    expect(manager.sampleFor(fonts[0])).toBe("sample text");
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
