import { TFile, type App } from "obsidian";
import { parseFontNames, humanizeFontFilename, sanitizeFamilyName } from "./font-name";
import {
  fontFaceSource,
  classNameForId,
  fontFormatFromPath,
  isFontFile,
  makeFontId,
  type FontRecord,
} from "./css";

export interface CustomFontConfig {
  id: string;
  name: string;
  path?: string;
  url?: string;
  enabled: boolean;
  sample?: string;
}

export interface FontManagerSettings {
  fontNicknames: Record<string, string>;
  fontAliases: Record<string, string>;
  customFonts: CustomFontConfig[];
}

interface CacheEntry {
  mtime: number;
  size: number;
  family?: string;
  error?: string;
}

const DEFAULT_SAMPLE = "The quick brown fox — 1234567890";

export class FontManager {
  private records: FontRecord[] = [];
  private cache = new Map<string, CacheEntry>();
  private refreshToken = 0;
  private revision = 0;
  private readonly facesByDocument = new Map<Document, Map<string, FontFace>>();
  private disposed = false;
  private lastWarnings: string[] = [];

  constructor(
    private readonly app: App,
    private readonly getSettings: () => FontManagerSettings
  ) {}

  list(): FontRecord[] {
    return this.records.slice();
  }

  /** Increases after a successful refresh so editor widgets can rerender. */
  get version(): number {
    return this.revision;
  }

  get warnings(): string[] {
    return this.lastWarnings.slice();
  }

  find(name: string): FontRecord | undefined {
    const needle = name.trim().toLowerCase();
    if (!needle) return undefined;
    return this.records.find((record) => {
      const className = record.className.replace(/^langscape-font-/, "");
      return (
        record.id.toLowerCase() === needle ||
        (record.nickname ?? "").toLowerCase() === needle ||
        record.displayName.toLowerCase() === needle ||
        record.family.toLowerCase() === needle ||
        className === needle ||
        stripSpaces(record.displayName) === stripSpaces(needle) ||
        stripSpaces(record.nickname ?? "") === stripSpaces(needle)
      );
    });
  }

  get(id: string): FontRecord | undefined {
    return this.records.find((record) => record.id === id);
  }

  sampleFor(record: FontRecord): string {
    const settings = this.getSettings();
    const customId = record.customId ?? record.id;
    const config = settings.customFonts.find((font) => font.id === customId);
    return config?.sample?.trim() || DEFAULT_SAMPLE;
  }

  async refresh(): Promise<FontRecord[]> {
    if (this.disposed) return this.list();
    const token = ++this.refreshToken;
    const settings = this.getSettings();
    const records: FontRecord[] = [];
    const warnings: string[] = [];
    const usedFamilies = new Map<string, number>();
    const seenPaths = new Set<string>();

    const addRecord = (record: FontRecord): void => {
      const familyKey = record.family.toLowerCase();
      const count = usedFamilies.get(familyKey) ?? 0;
      usedFamilies.set(familyKey, count + 1);
      if (count > 0) {
        const suffix = ` (${count + 1})`;
        record.family += suffix;
        record.displayName += suffix;
        record.id = `${record.id}-${count + 1}`;
        record.className = classNameForId(record.id);
      }
      records.push(record);
    };

    const customByPath = new Map(
      settings.customFonts
        .filter((config) => config.enabled && Boolean(config.path))
        .map((config) => [config.path as string, config] as const)
    );
    const files = this.app.vault.getFiles().filter((file) => isFontFile(file.path));
    for (const file of files) {
      if (seenPaths.has(file.path)) continue;
      seenPaths.add(file.path);
      const custom = customByPath.get(file.path);
      const record = await this.recordForVaultFile(
        file,
        settings,
        warnings,
        custom?.name,
        custom?.id
      );
      if (record) addRecord(record);
    }

    for (const config of settings.customFonts) {
      if (!config.enabled) continue;
      if (config.path) {
        const file = this.app.vault.getAbstractFileByPath(config.path);
        if (!(file instanceof TFile)) {
          warnings.push(`Custom font file not found: ${config.path}`);
          continue;
        }
        if (seenPaths.has(file.path)) continue;
        seenPaths.add(file.path);
        const record = await this.recordForVaultFile(
          file,
          settings,
          warnings,
          config.name,
          config.id
        );
        if (record) addRecord(record);
        continue;
      }
      if (config.url) {
        const displayName = sanitizeFamilyName(config.name) || humanizeFontFilename(config.url);
        const id = makeFontId(config.url, displayName);
        addRecord({
          id,
          family: displayName,
          displayName,
          className: classNameForId(id),
          source: "url",
          url: config.url,
          format: fontFormatFromPath(config.url),
          nickname: settings.fontNicknames[config.id]?.trim() || undefined,
          customId: config.id,
        });
      }
    }

    records.sort((a, b) => a.displayName.localeCompare(b.displayName));
    if (token !== this.refreshToken) return this.records;
    this.records = records;
    this.lastWarnings = warnings;
    this.revision++;
    for (const doc of this.facesByDocument.keys()) this.syncFonts(doc);
    return this.list();
  }

  /** FontFaceSets belong to each document, including Obsidian popouts. */
  attachDocument(doc: Document): void {
    if (this.disposed || !doc.defaultView?.FontFace || !doc.fonts || this.facesByDocument.has(doc)) return;
    this.facesByDocument.set(doc, new Map());
    this.syncFonts(doc);
  }

  detachDocument(doc: Document): void {
    const faces = this.facesByDocument.get(doc);
    if (!faces) return;
    for (const face of faces.values()) doc.fonts.delete(face);
    this.facesByDocument.delete(doc);
  }

  private syncFonts(doc: Document): void {
    const faces = this.facesByDocument.get(doc);
    const win = doc.defaultView;
    if (!faces || !win) return;
    const wanted = new Set<string>();
    for (const record of this.records) {
      try {
        const url = record.source === "url" ? record.url
          : record.path ? this.app.vault.adapter.getResourcePath(record.path) : undefined;
        if (!url) continue;
        const family = record.family;
        const source = fontFaceSource(url, record.format);
        const key = JSON.stringify([family, source]);
        wanted.add(key);
        if (faces.has(key)) continue;
        const face = new win.FontFace(family, source, { display: "swap" });
        doc.fonts.add(face);
        faces.set(key, face);
      } catch {
        // An unavailable source should not prevent the other fonts from loading.
      }
    }
    for (const [key, face] of faces) {
      if (wanted.has(key)) continue;
      doc.fonts.delete(face);
      faces.delete(key);
    }
  }

  unload(): void {
    this.disposed = true;
    this.refreshToken++;
    for (const doc of this.facesByDocument.keys()) this.detachDocument(doc);
  }

  private async recordForVaultFile(
    file: TFile,
    settings: FontManagerSettings,
    warnings: string[],
    forcedName?: string,
    customId?: string
  ): Promise<FontRecord | undefined> {
    let family: string | undefined = settings.fontAliases[file.path]?.trim();
    if (!family) {
      const cached = this.cache.get(file.path);
      if (cached && cached.mtime === file.stat.mtime && cached.size === file.stat.size) {
        family = cached.family;
        if (cached.error) warnings.push(cached.error);
      } else {
        let parsedFamily: string | undefined;
        let error: string | undefined;
        try {
          const buffer = await this.app.vault.readBinary(file);
          parsedFamily = sanitizeFamilyName(
            parseFontNames(new Uint8Array(buffer)).family ?? ""
          );
        } catch (err) {
          error = `Could not read ${file.path}: ${
            err instanceof Error ? err.message : String(err)
          }`;
        }
        family = parsedFamily || humanizeFontFilename(file.path);
        this.cache.set(file.path, {
          mtime: file.stat.mtime,
          size: file.stat.size,
          family,
          error,
        });
        if (error) warnings.push(error);
      }
    }

    const resolvedFamily = sanitizeFamilyName(
      forcedName || family || humanizeFontFilename(file.path)
    );
    if (!resolvedFamily) return undefined;
    const id = makeFontId(file.path, resolvedFamily);
    return {
      id,
      family: resolvedFamily,
      displayName: resolvedFamily,
      className: classNameForId(id),
      source: "vault",
      path: file.path,
      format: fontFormatFromPath(file.path),
      nickname: settings.fontNicknames[file.path]?.trim() || undefined,
      customId,
    };
  }
}

function stripSpaces(value: string): string {
  return value.replace(/[\s_-]+/g, "").toLowerCase();
}
