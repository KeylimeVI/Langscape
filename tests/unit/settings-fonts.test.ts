// @vitest-environment jsdom
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { TFile, TFolder } from "obsidian";
import { FontManager } from "../../src/fonts/manager";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { LangscapeSettingTab } from "../../src/settings-ui";
import * as modals from "../../src/ui/modals";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fontBytes = await fs.readFile(
  path.join(root, "tests/fixtures/fonts/NotoSansGothic-Regular.ttf")
);

class TestFontFace {
  status = "unloaded";
  constructor(readonly family: string, readonly source: string | ArrayBuffer) {}
  async load(): Promise<this> {
    this.status = "loaded";
    return this;
  }
}

function installFontSet(doc: Document): Set<TestFontFace> {
  const faces = new Set<TestFontFace>();
  Object.defineProperty(doc.defaultView, "FontFace", {
    configurable: true,
    value: TestFontFace,
  });
  Object.defineProperty(doc, "fonts", { configurable: true, value: faces });
  const targetProto = (doc.defaultView as any)?.Element?.prototype;
  const sourceProto = Element.prototype as any;
  if (targetProto && targetProto !== sourceProto) {
    for (const helper of [
      "createEl",
      "createDiv",
      "createSpan",
      "empty",
      "addClass",
      "removeClass",
      "toggleClass",
      "setCssProps",
      "setText",
      "setAttr",
      "detach",
      "hasClass",
    ]) {
      targetProto[helper] = sourceProto[helper];
    }
  }
  return faces;
}

describe("LangscapeSettingTab fonts UI", () => {
  it("attaches a secondary Settings document so previews get FontFaces and shows the delete button for vault fonts", async () => {
    const rootFolder = new (TFolder as any)("/") as TFolder;
    const fontsFolder = new (TFolder as any)("Fonts") as TFolder;
    const fontFile = new (TFile as any)("Fonts/Reedline-Regular.ttf") as TFile;
    fontFile.stat.mtime = 1;
    fontFile.stat.size = fontBytes.length;
    fontFile.parent = fontsFolder;
    fontsFolder.parent = rootFolder;
    fontsFolder.children.push(fontFile);
    rootFolder.children.push(fontsFolder);

    const files = new Map<string, TFile | TFolder>([
      ["/", rootFolder],
      ["Fonts", fontsFolder],
      [fontFile.path, fontFile],
    ]);

    const trashFile = vi.fn(async (file: TFile) => {
      files.delete(file.path);
      fontsFolder.children = fontsFolder.children.filter((c) => c !== file);
    });

    const app: any = {
      vault: {
        configDir: ".obsidian",
        adapter: { getResourcePath: (p: string) => `app://local/${p}` },
        getRoot: () => rootFolder,
        getAbstractFileByPath: (p: string) => files.get(p) ?? null,
        readBinary: async () =>
          fontBytes.buffer.slice(
            fontBytes.byteOffset,
            fontBytes.byteOffset + fontBytes.byteLength
          ),
      },
      fileManager: { trashFile },
    };

    const settings = {
      ...DEFAULT_SETTINGS,
      fontNicknames: { [fontFile.path]: "rl" },
      fontAliases: { [fontFile.path]: "Reedline" },
      customFonts: [],
    };
    const fontManager = new FontManager(app, () => settings);
    installFontSet(document);
    fontManager.attachDocument(document);
    await fontManager.refresh();

    // Simulate Obsidian 1.15 opening Settings in its own window/Document.
    const frame = document.body.appendChild(document.createElement("iframe"));
    const settingsDoc = frame.contentDocument!;
    const settingsFaces = installFontSet(settingsDoc);

    const plugin: any = {
      app,
      manifest: { version: "1.0.3" },
      settings,
      fontManager,
      saveSettings: vi.fn(async () => {}),
      refreshFonts: vi.fn(async () => {
        await fontManager.refresh();
      }),
    };

    const tab = new LangscapeSettingTab(plugin);
    tab.containerEl = settingsDoc.createElement("div");
    settingsDoc.body.appendChild(tab.containerEl);
    tab.display();

    expect(settingsFaces.size).toBe(1);
    expect([...settingsFaces][0].family).toBe("Reedline");

    const preview = tab.containerEl.querySelector(".langscape-font-setting-preview") as HTMLElement;
    expect(preview).toBeTruthy();
    expect(preview.style.getPropertyValue("--langscape-font-family")).toBe('"Reedline"');

    const deleteButton = tab.containerEl.querySelector(
      'button[aria-label="Delete font"]'
    ) as HTMLButtonElement;
    expect(deleteButton).toBeTruthy();

    // Confirm deleting the vault font moves it to trash and cleans up settings.
    const confirmSpy = vi.spyOn(modals, "confirmAction").mockResolvedValueOnce(true);
    deleteButton.click();
    await vi.waitFor(() => expect(trashFile).toHaveBeenCalledWith(fontFile));
    expect(settings.fontNicknames[fontFile.path]).toBeUndefined();
    expect(settings.fontAliases[fontFile.path]).toBeUndefined();
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(plugin.refreshFonts).toHaveBeenCalled();
    expect(fontManager.list()).toHaveLength(0);
    confirmSpy.mockRestore();

    tab.hide();
    frame.remove();
    fontManager.unload();
  });

  it("renders an inline error when a font fails to decode", async () => {
    const plugin: any = {
      app: { vault: {}, fileManager: {} },
      manifest: { version: "1.0.3" },
      settings: { ...DEFAULT_SETTINGS },
      fontManager: {
        attachDocument: vi.fn(),
        onChange: vi.fn(() => () => {}),
        list: () => [
          {
            id: "broken-1",
            family: "Broken Font",
            displayName: "Broken Font",
            className: "langscape-font-broken-1",
            source: "vault",
            path: "Fonts/Broken.ttf",
            loadStatus: "error",
            loadError: "Invalid font data in ArrayBuffer.",
          },
        ],
        sampleFor: () => "The quick brown fox — 1234567890",
      },
    };

    const tab = new LangscapeSettingTab(plugin);
    document.body.appendChild(tab.containerEl);
    tab.display();

    const errorEl = tab.containerEl.querySelector(".langscape-font-setting-error");
    expect(errorEl?.textContent).toContain("Invalid font data in ArrayBuffer.");
    expect(tab.containerEl.querySelector('button[aria-label="Delete font"]')).toBeTruthy();

    tab.hide();
    tab.containerEl.remove();
  });
});
