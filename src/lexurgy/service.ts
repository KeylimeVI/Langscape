import { requestUrl } from "obsidian";
import * as path from "node:path";
import { FileSystemAdapter } from "obsidian";
import type LangscapePlugin from "../main";
import { detectLexurgyEnvironment, type LexurgyEnvironment } from "./locator";
import { LexurgyServer, LexurgyError, type LexurgyApplyResult } from "./server";
import { extractErrorLine } from "./protocol";
import { extractLexurgyArchive } from "./installer";
import {
  fetchLatestLexurgyRelease,
  type FetchBinaryResponse,
  type FetchTransport,
} from "./release";
import { promises as fs } from "node:fs";

export interface ValidationResult {
  valid: boolean;
  error?: LexurgyError;
  line?: number;
}

export interface InstallResult {
  version: string;
  path: string;
  jarCount: number;
}

export class LexurgyService {
  private server: LexurgyServer | null = null;
  private serverKey = "";
  private environment: LexurgyEnvironment | null = null;
  private environmentAt = 0;
  private detecting: Promise<LexurgyEnvironment> | null = null;
  private installing: Promise<InstallResult> | null = null;
  private lastError: string | undefined;

  constructor(private readonly plugin: LangscapePlugin) {}

  get lastServerError(): string | undefined {
    return this.lastError;
  }

  get isRunning(): boolean {
    return Boolean(this.server?.isRunning);
  }

  get managedDir(): string | undefined {
    const adapter = this.plugin.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return undefined;
    const pluginDir =
      this.plugin.manifest.dir ??
      `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
    return path.join(adapter.getBasePath(), pluginDir, "lexurgy");
  }

  async getEnvironment(force = false): Promise<LexurgyEnvironment> {
    const now = Date.now();
    if (!force && this.environment && now - this.environmentAt < 15_000) {
      return this.environment;
    }
    if (this.detecting) return this.detecting;
    this.detecting = (async () => {
      try {
        const env = await detectLexurgyEnvironment({
          configuredPath: this.plugin.settings.lexurgyPath,
          javaPath: this.plugin.settings.javaPath,
          managedDir: this.managedDir,
        });
        this.environment = env;
        this.environmentAt = Date.now();
        return env;
      } finally {
        this.detecting = null;
      }
    })();
    return this.detecting;
  }

  async ensureServer(): Promise<LexurgyServer> {
    const env = await this.getEnvironment();
    if (!env.installation) {
      throw new LexurgyError(
        env.error ??
          "Lexurgy is not installed. Install it from Langscape settings to run sound changes."
      );
    }
    const launch = env.installation.launch;
    const key = [launch.command, ...launch.args, launch.cwd ?? ""].join("\u0000");
    if (this.server?.isRunning && this.serverKey === key) return this.server;

    await this.server?.stop();
    this.server = new LexurgyServer(launch, {
      requestTimeoutMs: 45_000,
      onExit: () => {
        this.server = null;
        this.serverKey = "";
      },
    });
    this.serverKey = key;
    try {
      await this.server.start();
    } catch (error) {
      this.server = null;
      this.serverKey = "";
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
    this.lastError = undefined;
    return this.server;
  }

  async validate(changes: string): Promise<ValidationResult> {
    if (!changes.trim()) {
      return { valid: false, error: new LexurgyError("The sound-change file is empty.") };
    }
    try {
      const server = await this.ensureServer();
      await server.load(changes);
      return { valid: true };
    } catch (error) {
      const lexurgyError =
        error instanceof LexurgyError
          ? error
          : new LexurgyError(error instanceof Error ? error.message : String(error));
      if (!errorIsLexurgyError(error)) {
        this.lastError = lexurgyError.message;
      }
      return {
        valid: false,
        error: lexurgyError,
        line: lexurgyError.line ?? locateErrorLine(changes, lexurgyError.message),
      };
    }
  }

  async apply(
    changes: string,
    words: string[],
    options: { startAt?: string; stopBefore?: string; traceWords?: string[] } = {}
  ): Promise<LexurgyApplyResult> {
    if (words.length === 0) {
      return { words: [], intermediates: {}, traceLines: [] };
    }
    const server = await this.ensureServer();
    return server.run(changes, words, {
      startAt: options.startAt,
      stopBefore: options.stopBefore,
      traceWords: options.traceWords,
      romanize: true,
    });
  }

  async testConnection(): Promise<{ version: string; words: string[] }> {
    const sample = ["Symbol a", "Symbol b", "", "Test:", " a => b"].join("\n");
    const env = await this.getEnvironment(true);
    if (!env.installation) {
      throw new LexurgyError(env.error ?? "Lexurgy is not installed.");
    }
    const result = await this.apply(sample, ["a"]);
    return {
      version: env.installation.version ?? env.installation.label,
      words: result.words,
    };
  }

  async installLexurgy(): Promise<InstallResult> {
    if (this.installing) return this.installing;
    const dir = this.managedDir;
    if (!dir) {
      throw new Error(
        "Langscape can only install Lexurgy with a desktop (filesystem) vault."
      );
    }
    this.installing = (async () => {
      const release = await fetchLatestLexurgyRelease(obsidianTransport);
      const extracted = await extractLexurgyArchive(release.bytes, dir);
      const notice = [
        "Lexurgy is a separate program by Graham Thomas Hill (def-gthill).",
        "It is licensed under GPL-3.0 and is downloaded from the official GitHub releases page:",
        "https://github.com/def-gthill/lexurgy",
        "",
        `Installed version: ${release.version}`,
        `Source archive: ${release.zipUrl}`,
        "",
        "Langscape invokes this program as a separate process; Lexurgy's code is not",
        "bundled into the Langscape plugin.",
        "",
      ].join("\n");
      await fs.writeFile(path.join(dir, "NOTICE.txt"), notice, "utf8");
      if (release.licenseText) {
        await fs.writeFile(path.join(dir, "LICENSE-lexurgy.txt"), release.licenseText, "utf8");
      }
      this.environment = null;
      this.environmentAt = 0;
      await this.server?.stop();
      this.server = null;
      this.serverKey = "";
      await this.getEnvironment(true);
      return {
        version: release.version,
        path: dir,
        jarCount: extracted.jarCount,
      };
    })();
    try {
      return await this.installing;
    } finally {
      this.installing = null;
    }
  }

  async restart(): Promise<void> {
    await this.server?.stop();
    this.server = null;
    this.serverKey = "";
    this.environment = null;
    this.environmentAt = 0;
  }

  async dispose(): Promise<void> {
    await this.server?.stop();
    this.server = null;
  }
}

function errorIsLexurgyError(error: unknown): boolean {
  return error instanceof LexurgyError;
}

/**
 * Lexurgy sometimes names the failing rule without a source line (for example
 * `Error in expression 2 of rule "Umlaut"`). Point the editor at that rule's
 * header so the diagnostic is still useful.
 */
export function locateErrorLine(changes: string, message: string): number | undefined {
  const direct = extractErrorLine(message);
  if (direct) return direct;
  const quoted = /\brule\s+"([^"]+)"/i.exec(message) ?? /\brule\s+'([^']+)'/i.exec(message);
  if (!quoted) return undefined;
  const name = quoted[1].trim();
  const lines = changes.split(/\r?\n/);
  const index = lines.findIndex((line) => {
    const match = /^\s{0,3}([^#\s][^:]*?)\s*:\s*(?:#.*)?$/.exec(line);
    return Boolean(match && match[1].trim() === name);
  });
  return index >= 0 ? index + 1 : undefined;
}

/**
 * Obsidian's requestUrl bypasses CORS and follows GitHub's redirects. The zip
 * is binary, so avoid decoding it as text.
 */
const obsidianTransport: FetchTransport = {
  async get(url: string): Promise<FetchBinaryResponse> {
    const response = await requestUrl({ url, method: "GET", throw: false });
    const contentType = Object.entries(response.headers ?? {}).find(
      ([key]) => key.toLowerCase() === "content-type"
    )?.[1];
    const isText =
      !contentType ||
      /text|json|xml|javascript|license/i.test(contentType) ||
      /\.(txt|json|md)$/i.test(url);
    const bytes = new Uint8Array(response.arrayBuffer);
    return {
      status: response.status,
      headers: response.headers,
      text: isText ? response.text : "",
      bytes,
    };
  },
};

export { LexurgyServer };
