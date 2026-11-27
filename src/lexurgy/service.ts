import { FileSystemAdapter, Platform } from "obsidian";
import type LangscapePlugin from "../main";
import { detectLexurgyEnvironment, type LexurgyEnvironment } from "./locator";
import { LexurgyServer, LexurgyError, type LexurgyApplyResult } from "./server";
import { extractErrorLine } from "./protocol";
export interface ValidationResult {
  valid: boolean;
  error?: LexurgyError;
  line?: number;
}

export class LexurgyService {
  private server: LexurgyServer | null = null;
  private serverKey = "";
  private environment: LexurgyEnvironment | null = null;
  private environmentAt = 0;
  private detecting: Promise<LexurgyEnvironment> | null = null;
  private ensuringServer: Promise<LexurgyServer> | null = null;

  constructor(private readonly plugin: LangscapePlugin) {}

  get isRunning(): boolean {
    return Boolean(this.server?.isRunning);
  }

  private async getLegacyInstallDir(): Promise<string | undefined> {
    if (!Platform.isDesktopApp) return undefined;
    const adapter = this.plugin.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return undefined;
    const pluginDir =
      this.plugin.manifest.dir ??
      `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
    const pathMod = await import("node:path");
    return pathMod.join(adapter.getBasePath(), pluginDir, "lexurgy");
  }

  async getEnvironment(force = false): Promise<LexurgyEnvironment> {
    const now = Date.now();
    if (!force && this.environment && now - this.environmentAt < 15_000) {
      return this.environment;
    }
    if (this.detecting) return this.detecting;
    this.detecting = (async () => {
      try {
        const managedDir = await this.getLegacyInstallDir();
        const env = await detectLexurgyEnvironment({
          configuredPath: this.plugin.settings.lexurgyPath,
          javaPath: this.plugin.settings.javaPath,
          managedDir,
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

  ensureServer(): Promise<LexurgyServer> {
    return (this.ensuringServer ??= this.startServer().finally(() => {
      this.ensuringServer = null;
    }));
  }

  private async startServer(): Promise<LexurgyServer> {
    const env = await this.getEnvironment();
    if (!env.installation) {
      throw new LexurgyError(
        env.error ??
          "Lexurgy is not installed. Download it separately, then configure its path in Langscape settings."
      );
    }
    const launch = env.installation.launch;
    const key = [launch.command, ...launch.args, launch.cwd ?? ""].join("\u0000");
    if (this.server?.isRunning && this.serverKey === key) return this.server;

    await this.server?.stop();
    const server = new LexurgyServer(launch, {
      requestTimeoutMs: 45_000,
      onExit: () => {
        if (this.server !== server) return;
        this.server = null;
        this.serverKey = "";
      },
    });
    this.server = server;
    this.serverKey = key;
    try {
      await server.start();
    } catch (error) {
      if (this.server === server) {
        this.server = null;
        this.serverKey = "";
      }
      throw error;
    }
    return server;
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
