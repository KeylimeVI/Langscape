// @vitest-environment jsdom
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { FileSystemAdapter, Platform, TFile, TFolder } from "obsidian";
import { FontManager, type FontManagerSettings } from "../../src/fonts/manager";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fontBytes = await fs.readFile(path.join(root, "tests/fixtures/fonts/NotoSansGothic-Regular.ttf"));

class Vault {
  private readonly rootFolder = new (TFolder as any)("/") as TFolder;
  private readonly entries = new Map<string, TFile | TFolder>([["/", this.rootFolder]]);
  files: TFile[] = [];
  folders = new Set<string>(["/"]);
  configDir = ".obsidian";
  adapter: Record<string, any> = {
    getResourcePath: (p: string) => `app://local/${p}`,
  };
  add(...items: TFile[]): void {
    for (const item of items) {
      const parent = this.ensureFolder(parentPath(item.path));
      item.parent = parent;
      parent.children.push(item);
      this.entries.set(item.path, item);
      this.files.push(item);
    }
  }
  private ensureFolder(folderPath: string): TFolder {
    const existing = this.entries.get(folderPath);
    if (existing instanceof TFolder) return existing;
    const parent = this.ensureFolder(parentPath(folderPath));
    const folder = new (TFolder as any)(folderPath) as TFolder;
    folder.parent = parent;
    parent.children.push(folder);
    this.entries.set(folderPath, folder);
    this.folders.add(folderPath);
    return folder;
  }
  getRoot(): TFolder {
    return this.rootFolder;
  }
  getFiles(): TFile[] {
    return this.files;
  }
  getAbstractFileByPath(p: string): TFile | TFolder | null {
    return this.entries.get(p) ?? (this.folders.has(p) ? new (TFolder as any)(p) : null);
  }
  async readBinary(): Promise<ArrayBuffer> {
    return fontBytes.buffer.slice(
      fontBytes.byteOffset,
      fontBytes.byteOffset + fontBytes.byteLength
    ) as ArrayBuffer;
  }
}

function parentPath(p: string): string {
  const slash = p.lastIndexOf("/");
  return slash > 0 ? p.slice(0, slash) : "/";
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

class TestFontFace {
  status: FontFaceLoadStatus = "unloaded";
  constructor(readonly family: string, readonly source: string | ArrayBuffer) {}
  async load(): Promise<this> {
    this.status = "loaded";
    return this;
  }
}

function fontSet(doc: Document) {
  const faces = new Set<TestFontFace>();
  Object.defineProperty(doc.defaultView, "FontFace", { configurable: true, value: TestFontFace });
  Object.defineProperty(doc, "fonts", { configurable: true, value: faces });
  return faces;
}

describe("FontManager", () => {
  beforeEach(() => {
    document.head.replaceChildren();
  });

  it("discovers TTF files and registers FontFaces without stylesheets", async () => {
    const vault = new Vault();
    vault.add(file("Fonts/NotoSansGothic-Regular.ttf"));
    const manager = new FontManager({ vault } as any, () => settings());
    const faces = fontSet(document);
    manager.attachDocument(document);
    const fonts = await manager.refresh();
    expect(fonts).toHaveLength(1);
    expect(fonts[0]).toMatchObject({
      family: "Noto Sans Gothic",
      displayName: "Noto Sans Gothic",
      source: "vault",
      path: "Fonts/NotoSansGothic-Regular.ttf",
    });
    expect([...faces]).toEqual([expect.objectContaining({ family: "Noto Sans Gothic" })]);
    expect(document.head.querySelector("style")).toBeNull();
    const frame = document.body.appendChild(document.createElement("iframe"));
    const popout = frame.contentDocument!;
    const popupFaces = fontSet(popout);
    manager.attachDocument(popout);
    manager.attachDocument(popout);
    expect(popupFaces.size).toBe(1);
    manager.detachDocument(popout);
    expect(popupFaces.size).toBe(0);
    frame.remove();
    manager.unload();
    expect(faces.size).toBe(0);
    expect(manager.find("noto sans gothic")?.path).toBe("Fonts/NotoSansGothic-Regular.ttf");
    expect(manager.find("missing")).toBeUndefined();
  });

  it("scans every folder, honours aliases, and exposes nicknames", async () => {
    const vault = new Vault();
    vault.add(file("Fonts/A.ttf"), file("Other/B.ttf"));
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

  it("registers existing configured web fonts by URL", async () => {
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
    const faces = fontSet(document);
    manager.attachDocument(document);
    const fonts = await manager.refresh();
    expect(fonts[0]).toMatchObject({
      family: "Webfont",
      source: "url",
      format: "woff2",
      customId: "web",
      nickname: "webby",
    });
    expect([...faces][0].source).toBe('url("https://example.com/font.woff2") format("woff2")');
  });

  it("applies custom path metadata and keeps the settings entry id", async () => {
    const vault = new Vault();
    vault.add(file("Fonts/A.ttf"));
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
    vault.add(file("Fonts/A.ttf"), file("Fonts/B.ttf"));
    const manager = new FontManager({ vault } as any, () =>
      settings({ fontAliases: { "Fonts/A.ttf": "Script", "Fonts/B.ttf": "Script" } })
    );
    const fonts = await manager.refresh();
    expect(fonts.map((font) => font.family)).toEqual(["Script", "Script (2)"]);
  });

  it.skipIf(process.platform === "win32")(
    "omits nested vaults, symlinked files, and repeated paths through a root link",
    async () => {
      const disk = await fs.mkdtemp(path.join(tmpdir(), "langscape-fonts-"));
      try {
        const realFiles = [
          "Fonts/Tengwar.ttf",
          "Notes/Obsidian Vault/Legit.ttf",
          "Backup/Fonts/Tengwar.ttf",
        ];
        await Promise.all(
          realFiles.map(async (rel) => {
            await fs.mkdir(path.dirname(path.join(disk, rel)), { recursive: true });
            await fs.writeFile(path.join(disk, rel), fontBytes);
          })
        );
        await fs.mkdir(path.join(disk, "Backup", ".obsidian"), { recursive: true });
        await fs.symlink(disk, path.join(disk, "Obsidian Vault"), "dir");
        await fs.symlink(path.join(disk, "Fonts/Tengwar.ttf"), path.join(disk, "Linked.ttf"), "file");

        const vault = new Vault();
        Object.setPrototypeOf(vault.adapter, FileSystemAdapter.prototype);
        vault.adapter.getFullPath = (vaultPath: string) => path.join(disk, vaultPath);
        vault.add(
          ...realFiles.map((rel) => file(rel)),
          file("Obsidian Vault/Fonts/Tengwar.ttf"),
          file("Obsidian Vault/Obsidian Vault/Fonts/Tengwar.ttf"),
          file("Obsidian Vault/Obsidian Vault/Obsidian Vault/Fonts/Tengwar.ttf"),
          file("Linked.ttf")
        );

        const manager = new FontManager({ vault } as any, () => settings());
        const fonts = await manager.refresh();
        expect(fonts.map((font) => font.path)).toEqual([
          "Fonts/Tengwar.ttf",
          "Notes/Obsidian Vault/Legit.ttf",
        ]);
      } finally {
        await fs.rm(disk, { recursive: true, force: true });
      }
    }
  );

  it("omits nested vaults via adapter.stat when desktop fs access is unavailable", async () => {
    const previousDesktop = Platform.isDesktopApp;
    Platform.isDesktopApp = false;
    try {
      const vault = new Vault();
      vault.adapter.stat = async (p: string) =>
        p === "Obsidian Vault/.obsidian" || p === "Backup/.obsidian"
          ? { type: "folder", ctime: 0, mtime: 0, size: 0 }
          : null;
      vault.add(
        file("Fonts/Tengwar.ttf"),
        file("Notes/Obsidian Vault/Legit.ttf"),
        file("Backup/Fonts/Tengwar.ttf"),
        file("Obsidian Vault/Fonts/Tengwar.ttf"),
        file("Obsidian Vault/Obsidian Vault/Fonts/Tengwar.ttf")
      );

      const manager = new FontManager({ vault } as any, () => settings());
      const fonts = await manager.refresh();
      expect(fonts.map((font) => font.path)).toEqual([
        "Fonts/Tengwar.ttf",
        "Notes/Obsidian Vault/Legit.ttf",
      ]);
    } finally {
      Platform.isDesktopApp = previousDesktop;
    }
  });

  it("loads vault fonts from ArrayBuffer, reloads when modified, and records decode errors", async () => {
    const vault = new Vault();
    const fontFile = file("Fonts/Reedline-Regular.ttf");
    vault.add(fontFile);

    let shouldFail = false;
    class FailingAwareFontFace {
      status = "unloaded";
      constructor(readonly family: string, readonly source: string | ArrayBuffer) {}
      async load(): Promise<this> {
        if (shouldFail) {
          this.status = "error";
          throw new SyntaxError("Invalid font data in ArrayBuffer.");
        }
        this.status = "loaded";
        return this;
      }
    }

    const faces = new Set<FailingAwareFontFace>();
    Object.defineProperty(document.defaultView, "FontFace", {
      configurable: true,
      value: FailingAwareFontFace,
    });
    Object.defineProperty(document, "fonts", { configurable: true, value: faces });

    const manager = new FontManager({ vault } as any, () =>
      settings({
        fontAliases: { "Fonts/Reedline-Regular.ttf": "Reedline" },
        fontNicknames: { "Fonts/Reedline-Regular.ttf": "rl" },
      })
    );
    manager.attachDocument(document);
    const loaded = await manager.refresh();
    expect(loaded[0].loadStatus).toBe("loaded");
    expect(loaded[0].loadError).toBeUndefined();
    expect([...faces]).toHaveLength(1);
    expect([...faces][0].source).toBeInstanceOf(ArrayBuffer);
    expect(manager.find("rl")?.family).toBe("Reedline");

    // Simulate editing the font file in place with invalid bytes.
    shouldFail = true;
    fontFile.stat.mtime = 2;
    fontFile.stat.size = fontBytes.length + 1;
    const reloaded = await manager.refresh();
    expect(reloaded[0].loadStatus).toBe("error");
    expect(reloaded[0].loadError).toContain("Invalid font data");
    expect([...faces]).toHaveLength(1);
  });

  it("uses auto-detected cmap glyphs for non-ASCII fonts like Noto Sans Gothic", async () => {
    const vault = new Vault();
    vault.add(file("Fonts/NotoSansGothic-Regular.ttf"));
    const manager = new FontManager({ vault } as any, () => settings());
    const [gothic] = await manager.refresh();
    expect(manager.sampleFor(gothic)).toContain("𐌰");
  });
});
