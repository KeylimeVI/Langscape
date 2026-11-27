import { TFile, type App } from "obsidian";
import { listVaultFiles } from "../utils/vault";
import { humanizeFontFilename, inspectFontData, sanitizeFamilyName } from "./font-name";
import {
  classNameForId,
  fontFaceSource,
  fontFormatFromPath,
  isFontFile,
  makeFontId,
  type FontLoadStatus,
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
  detectedFormat?: string;
  autoSample?: string;
  bytes?: Uint8Array;
  error?: string;
}

interface DocumentFontState {
  faces: Map<string, FontFace>;
  cleanup?: () => void;
}

const DEFAULT_SAMPLE = "The quick brown fox — 1234567890";

export class FontManager {
  private records: FontRecord[] = [];
  private cache = new Map<string, CacheEntry>();
  private payloadByRecordId = new Map<string, { version: string; bytes?: Uint8Array }>();
  private refreshToken = 0;
  private revision = 0;
  private readonly docs = new Map<Document, DocumentFontState>();
  private readonly listeners = new Set<() => void>();
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

  /** Subscribe to font list or async load-status updates (e.g. Settings tab). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  find(name: string): FontRecord | undefined {
    const needle = name.trim().toLowerCase();
    if (!needle) return undefined;
    const compact = stripSpaces(needle);

    return (
      this.records.find((r) => (r.nickname ?? "").toLowerCase() === needle) ??
      this.records.find(
        (r) =>
          r.id.toLowerCase() === needle ||
          r.className.replace(/^langscape-font-/, "") === needle
      ) ??
      this.records.find(
        (r) => r.displayName.toLowerCase() === needle || r.family.toLowerCase() === needle
      ) ??
      this.records.find((r) => Boolean(r.nickname && stripSpaces(r.nickname) === compact)) ??
      this.records.find(
        (r) => stripSpaces(r.displayName) === compact || stripSpaces(r.family) === compact
      )
    );
  }

  get(id: string): FontRecord | undefined {
    return this.records.find((record) => record.id === id);
  }

  sampleFor(record: FontRecord): string {
    const settings = this.getSettings();
    const customId = record.customId ?? record.id;
    const config = settings.customFonts.find((font) => font.id === customId);
    return config?.sample?.trim() || record.autoSample || DEFAULT_SAMPLE;
  }

  async refresh(): Promise<FontRecord[]> {
    if (this.disposed) return this.list();
    const token = ++this.refreshToken;
    const settings = this.getSettings();
    const records: FontRecord[] = [];
    const warnings: string[] = [];
    const payloads = new Map<string, { version: string; bytes?: Uint8Array }>();
    const usedFamilies = new Map<string, number>();
    const seenPaths = new Set<string>();

    const addRecord = (record: FontRecord, payload?: { version: string; bytes?: Uint8Array }): void => {
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
      if (payload) payloads.set(record.id, payload);
    };

    const customByPath = new Map(
      settings.customFonts
        .filter(
          (config): config is CustomFontConfig & { path: string } =>
            config.enabled && Boolean(config.path)
        )
        .map((config) => [config.path, config] as const)
    );
    const files = await listVaultFiles(this.app.vault, (file) => isFontFile(file.path));
    for (const file of files) {
      if (seenPaths.has(file.path)) continue;
      seenPaths.add(file.path);
      const custom = customByPath.get(file.path);
      const built = await this.recordForVaultFile(
        file,
        settings,
        warnings,
        custom?.name,
        custom?.id
      );
      if (built) addRecord(built.record, built.payload);
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
        const built = await this.recordForVaultFile(
          file,
          settings,
          warnings,
          config.name,
          config.id
        );
        if (built) addRecord(built.record, built.payload);
        continue;
      }
      if (config.url) {
        const displayName = sanitizeFamilyName(config.name) || humanizeFontFilename(config.url);
        const id = makeFontId(config.url, displayName);
        addRecord(
          {
            id,
            family: displayName,
            displayName,
            className: classNameForId(id),
            source: "url",
            url: config.url,
            format: fontFormatFromPath(config.url),
            nickname: settings.fontNicknames[config.id]?.trim() || undefined,
            customId: config.id,
            loadStatus: "unloaded",
          },
          { version: config.url }
        );
      }
    }

    // Prune cached binary data for vault font files that were deleted.
    for (const cachedPath of this.cache.keys()) {
      if (!seenPaths.has(cachedPath)) this.cache.delete(cachedPath);
    }

    records.sort((a, b) => a.displayName.localeCompare(b.displayName));
    if (token !== this.refreshToken) return this.records;
    this.records = records;
    this.payloadByRecordId = payloads;
    this.lastWarnings = warnings;
    this.revision++;

    const syncTasks: Promise<void>[] = [];
    for (const doc of [...this.docs.keys()]) {
      syncTasks.push(this.syncFonts(doc));
    }
    await Promise.all(syncTasks);
    this.notify();
    return this.list();
  }

  /**
   * FontFaceSets belong to each Document — including Obsidian popout windows
   * and Obsidian 1.15+'s separate Settings window.
   */
  attachDocument(doc: Document | null | undefined): void {
    if (this.disposed || !doc || !doc.defaultView?.FontFace || !doc.fonts) return;
    this.pruneClosedDocuments();
    if (this.docs.has(doc)) return;

    const win = doc.defaultView;
    const state: DocumentFontState = { faces: new Map() };
    if (typeof document === "undefined" || doc !== document) {
      const onClose = () => this.detachDocument(doc);
      win.addEventListener("unload", onClose, { once: true });
      win.addEventListener("pagehide", onClose, { once: true });
      state.cleanup = () => {
        win.removeEventListener("unload", onClose);
        win.removeEventListener("pagehide", onClose);
      };
    }
    this.docs.set(doc, state);
    void this.syncFonts(doc);
  }

  detachDocument(doc: Document): void {
    const state = this.docs.get(doc);
    if (!state) return;
    state.cleanup?.();
    try {
      for (const face of state.faces.values()) doc.fonts?.delete(face);
    } catch {
      // Closed secondary windows may throw when touching their FontFaceSet.
    }
    this.docs.delete(doc);
  }

  unload(): void {
    this.disposed = true;
    this.refreshToken++;
    this.listeners.clear();
    for (const doc of [...this.docs.keys()]) this.detachDocument(doc);
    this.cache.clear();
    this.payloadByRecordId.clear();
  }

  private pruneClosedDocuments(): void {
    for (const doc of [...this.docs.keys()]) {
      const win = doc.defaultView;
      if (!win || win.closed) this.detachDocument(doc);
    }
  }

  private async syncFonts(doc: Document): Promise<void> {
    const state = this.docs.get(doc);
    const win = doc.defaultView;
    if (!state || !win || win.closed) {
      if (state) this.detachDocument(doc);
      return;
    }

    const { faces } = state;
    const wanted = new Set<string>();
    const pendingVaultLoads: Promise<void>[] = [];

    for (const record of this.records) {
      const payload = this.payloadByRecordId.get(record.id);
      const resourceUrl =
        record.source === "url"
          ? record.url
          : record.path
            ? this.safeResourcePath(record.path)
            : undefined;
      const hasBytes = Boolean(payload?.bytes && payload.bytes.byteLength > 0);
      if (!hasBytes && !resourceUrl) {
        if (!record.loadError) {
          this.setRecordStatus(record, "error", "Font source could not be read.");
        }
        continue;
      }

      const version = payload?.version ?? resourceUrl ?? "";
      const key = JSON.stringify([record.family, version, hasBytes ? "bin" : "url"]);
      wanted.add(key);
      if (faces.has(key)) continue;

      let face: FontFace | undefined;
      let createError: unknown;
      if (hasBytes && payload?.bytes) {
        try {
          // Slice a fresh ArrayBuffer copy per Document so Chromium never
          // shares or detaches a buffer across windows.
          const copy = payload.bytes.slice().buffer;
          face = new win.FontFace(record.family, copy, { display: "swap" });
        } catch (err) {
          createError = err;
        }
      }
      if (!face && resourceUrl) {
        try {
          const source = fontFaceSource(resourceUrl, record.format);
          face = new win.FontFace(record.family, source, { display: "swap" });
          createError = undefined;
        } catch (err) {
          createError = err;
        }
      }

      if (!face) {
        this.setRecordStatus(record, "error", formatFontError(createError));
        continue;
      }

      try {
        doc.fonts.add(face);
        faces.set(key, face);
      } catch (err) {
        this.setRecordStatus(record, "error", formatFontError(err));
        continue;
      }

      if (typeof face.load === "function") {
        if (record.loadStatus !== "loaded") {
          record.loadStatus = "loading";
        }
        const activeFace = face;
        const loadPromise = Promise.resolve()
          .then(() => activeFace.load())
          .then(() => {
            this.setRecordStatus(record, "loaded", undefined);
          })
          .catch((err: unknown) => {
            this.setRecordStatus(record, "error", formatFontError(err));
          });
        // Await local binary/vault font loads immediately so fonts are ready
        // before refresh() returns; remote URLs settle asynchronously.
        if (record.source === "vault") pendingVaultLoads.push(loadPromise);
      } else {
        this.setRecordStatus(record, "loaded", undefined);
      }
    }

    for (const [key, face] of [...faces]) {
      if (wanted.has(key)) continue;
      try {
        doc.fonts.delete(face);
      } catch {
        // Ignore if document is tearing down.
      }
      faces.delete(key);
    }

    if (pendingVaultLoads.length > 0) {
      await Promise.all(pendingVaultLoads);
    }
  }

  private setRecordStatus(
    record: FontRecord,
    status: FontLoadStatus,
    error: string | undefined
  ): void {
    const changed = record.loadStatus !== status || record.loadError !== error;
    record.loadStatus = status;
    record.loadError = error;
    if (changed) this.notify();
  }

  private notify(): void {
    if (this.disposed) return;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // Listener failures must not break font management.
      }
    }
  }

  private safeResourcePath(vaultPath: string): string | undefined {
    try {
      return this.app.vault.adapter.getResourcePath(vaultPath);
    } catch {
      return undefined;
    }
  }

  private async recordForVaultFile(
    file: TFile,
    settings: FontManagerSettings,
    warnings: string[],
    forcedName?: string,
    customId?: string
  ): Promise<{ record: FontRecord; payload: { version: string; bytes?: Uint8Array } } | undefined> {
    let entry = this.cache.get(file.path);
    if (!entry || entry.mtime !== file.stat.mtime || entry.size !== file.stat.size) {
      let bytes: Uint8Array | undefined;
      let parsedFamily: string | undefined;
      let detectedFormat: string | undefined;
      let autoSample: string | undefined;
      let error: string | undefined;
      try {
        const buffer = await this.app.vault.readBinary(file);
        bytes = new Uint8Array(buffer);
        const inspection = inspectFontData(bytes);
        parsedFamily = sanitizeFamilyName(inspection.names.family ?? "");
        detectedFormat = inspection.detectedFormat;
        autoSample = inspection.autoSample;
      } catch (err) {
        error = `Could not read ${file.path}: ${formatFontError(err)}`;
      }
      entry = {
        mtime: file.stat.mtime,
        size: file.stat.size,
        family: parsedFamily || humanizeFontFilename(file.path),
        detectedFormat,
        autoSample,
        bytes,
        error,
      };
      this.cache.set(file.path, entry);
    }
    if (entry.error) warnings.push(entry.error);

    const alias = settings.fontAliases[file.path]?.trim();
    const resolvedFamily = sanitizeFamilyName(
      forcedName || alias || entry.family || humanizeFontFilename(file.path)
    );
    if (!resolvedFamily) return undefined;
    const id = makeFontId(file.path, resolvedFamily);
    const record: FontRecord = {
      id,
      family: resolvedFamily,
      displayName: resolvedFamily,
      className: classNameForId(id),
      source: "vault",
      path: file.path,
      format: entry.detectedFormat ?? fontFormatFromPath(file.path),
      nickname: settings.fontNicknames[file.path]?.trim() || undefined,
      customId,
      autoSample: entry.autoSample,
      loadStatus: entry.error ? "error" : "unloaded",
      loadError: entry.error,
    };
    return {
      record,
      payload: {
        version: `${file.stat.mtime}:${file.stat.size}`,
        bytes: entry.bytes,
      },
    };
  }
}

function formatFontError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error || "Unknown font error");
}

function stripSpaces(value: string): string {
  return value.replace(/[\s_-]+/g, "").toLowerCase();
}
