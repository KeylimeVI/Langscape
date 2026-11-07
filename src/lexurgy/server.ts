import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type {
  ApplyRequest,
  ChangedResponse,
  ServerRequest,
  ServerResponse,
} from "./protocol";
import { encodeRequest, extractErrorLine, parseResponseLine } from "./protocol";

export interface LaunchSpec {
  /** Executable to spawn: `java`, an installed `lexurgy` script, etc. */
  command: string;
  args: string[];
  cwd?: string;
  /** Human-readable description shown in settings. */
  label?: string;
}

export interface LexurgyServerOptions {
  /** Timeout for a single load/apply request. */
  requestTimeoutMs?: number;
  /** How long to wait for the process to spawn. */
  startTimeoutMs?: number;
  onStderr?: (text: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export interface LexurgyApplyOptions {
  startAt?: string | null;
  stopBefore?: string | null;
  traceWords?: string[];
  romanize?: boolean;
}

export interface LexurgyApplyResult {
  words: string[];
  intermediates: Record<string, string[]>;
  traceLines: string[];
}

export class LexurgyError extends Error {
  readonly detail?: string;
  readonly line?: number;

  constructor(message: string, options: { detail?: string; line?: number } = {}) {
    super(message);
    this.name = "LexurgyError";
    this.detail = options.detail;
    this.line = options.line;
  }
}

interface Pending {
  request: ServerRequest;
  resolve: (response: ServerResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * A long-lived `lexurgy server` child process.
 *
 * Requests are serialized because the JVM server itself is single-threaded;
 * serializing also means responses can be matched to requests without needing
 * request IDs in the wire format.
 */
export class LexurgyServer {
  private child: ChildProcessWithoutNullStreams | null = null;
  private reader: Interface | null = null;
  private starting: Promise<void> | null = null;
  private pending: Pending | null = null;
  private queue: Pending[] = [];
  private stopped = false;
  private stderrBuffer = "";
  private lastExit: { code: number | null; signal: NodeJS.Signals | null } | null = null;

  constructor(
    private readonly launch: LaunchSpec,
    private readonly options: LexurgyServerOptions = {}
  ) {}

  get isRunning(): boolean {
    return this.child !== null && !this.child.killed;
  }

  get lastExitInfo(): { code: number | null; signal: NodeJS.Signals | null } | null {
    return this.lastExit;
  }

  get stderrTail(): string {
    return this.stderrBuffer;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    if (this.starting) return this.starting;
    this.stopped = false;
    this.starting = new Promise<void>((resolve, reject) => {
      let settled = false;
      const startTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.killChild();
        reject(
          new LexurgyError(
            `Lexurgy did not start within ${Math.round(
              (this.options.startTimeoutMs ?? 20_000) / 1000
            )} seconds. Check the Java and Lexurgy paths in Langscape settings.`
          )
        );
      }, this.options.startTimeoutMs ?? 20_000);

      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(this.launch.command, this.launch.args, {
          cwd: this.launch.cwd,
          env: { ...process.env, LC_ALL: process.env.LC_ALL ?? "C.UTF-8" },
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        clearTimeout(startTimer);
        settled = true;
        reject(toLexurgySpawnError(error, this.launch));
        return;
      }

      this.child = child;
      this.stderrBuffer = "";

      child.once("spawn", () => {
        if (settled) return;
        settled = true;
        clearTimeout(startTimer);
        this.starting = null;
        resolve();
      });

      child.once("error", (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(startTimer);
          this.starting = null;
          this.child = null;
          reject(toLexurgySpawnError(error, this.launch));
        } else {
          this.failAll(toLexurgySpawnError(error, this.launch));
        }
      });

      child.once("exit", (code, signal) => {
        this.lastExit = { code, signal };
        this.child = null;
        this.starting = null;
        this.reader?.close();
        this.reader = null;
        const reason = this.makeExitError(code, signal);
        this.failAll(reason);
        this.options.onExit?.(code, signal);
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        this.stderrBuffer = (this.stderrBuffer + chunk).slice(-16_384);
        this.options.onStderr?.(chunk);
      });

      this.reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
      this.reader.on("line", (line) => this.handleLine(line));
    });

    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async load(changes: string): Promise<void> {
    await this.request({ type: "load_string", changes });
  }

  async apply(words: string[], options: LexurgyApplyOptions = {}): Promise<LexurgyApplyResult> {
    const request: ApplyRequest = {
      type: "apply",
      words,
      romanize: options.romanize ?? true,
    };
    if (options.startAt) request.startAt = options.startAt;
    if (options.stopBefore) request.stopBefore = options.stopBefore;
    if (options.traceWords?.length) request.traceWords = options.traceWords;

    const response = await this.request(request);
    if (response.type !== "changed") {
      throw new LexurgyError("Lexurgy returned an unexpected response to an apply request.");
    }
    return normalizeChanged(response);
  }

  /** Load changes and apply words in one call (the common path). */
  async run(
    changes: string,
    words: string[],
    options: LexurgyApplyOptions = {}
  ): Promise<LexurgyApplyResult> {
    await this.load(changes);
    return this.apply(words, options);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.failAll(new LexurgyError("Lexurgy server was stopped."));
    this.reader?.close();
    this.reader = null;
    const child = this.child;
    this.child = null;
    if (!child) return;
    if (process.platform === "win32") {
      child.kill();
    } else {
      child.kill("SIGTERM");
      // If the JVM ignores SIGTERM, don't leave it hanging around.
      setTimeout(() => {
        try {
          if (!child.killed) child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }, 2000).unref?.();
    }
  }

  private request(request: ServerRequest): Promise<ServerResponse> {
    if (this.stopped) {
      return Promise.reject(new LexurgyError("Lexurgy server was stopped."));
    }
    return new Promise<ServerResponse>((resolve, reject) => {
      this.queue.push({ request, resolve, reject, timer: null });
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.pending || this.queue.length === 0 || this.stopped) return;
    const next = this.queue.shift();
    if (!next) return;
    this.pending = next;

    try {
      await this.start();
    } catch (error) {
      this.pending = null;
      next.reject(error instanceof Error ? error : new Error(String(error)));
      queueMicrotask(() => void this.pump());
      return;
    }

    if (!this.child || !this.child.stdin.writable) {
      this.pending = null;
      next.reject(this.makeExitError(this.lastExit?.code ?? null, this.lastExit?.signal ?? null));
      queueMicrotask(() => void this.pump());
      return;
    }

    const timeout = this.options.requestTimeoutMs ?? 30_000;
    next.timer = setTimeout(() => {
      if (this.pending !== next) return;
      this.pending = null;
      next.reject(
        new LexurgyError(
          `Lexurgy took longer than ${Math.round(timeout / 1000)} seconds to respond. ` +
            "The process has been restarted."
        )
      );
      // A hung JVM cannot be recovered reliably; start fresh next time.
      this.killChild();
      queueMicrotask(() => void this.pump());
    }, timeout);

    this.child.stdin.write(encodeRequest(next.request), (error) => {
      if (!error) return;
      if (this.pending === next) this.pending = null;
      if (next.timer) clearTimeout(next.timer);
      next.reject(new LexurgyError(`Could not write to Lexurgy: ${error.message}`));
      queueMicrotask(() => void this.pump());
    });
  }

  private handleLine(line: string): void {
    const current = this.pending;
    if (!current) return;
    this.pending = null;
    if (current.timer) clearTimeout(current.timer);

    let response: ServerResponse;
    try {
      response = parseResponseLine(line);
    } catch (error) {
      current.reject(error instanceof Error ? error : new Error(String(error)));
      queueMicrotask(() => void this.pump());
      return;
    }

    if (response.type === "error") {
      const lineNumber = extractErrorLine(response.message);
      current.reject(
        new LexurgyError(response.message, {
          line: lineNumber,
          detail: response.stackTrace?.slice(0, 8).join("\n"),
        })
      );
    } else {
      current.resolve(response);
    }
    queueMicrotask(() => void this.pump());
  }

  private failAll(error: Error): void {
    if (this.pending) {
      if (this.pending.timer) clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = null;
    }
    const queued = this.queue.splice(0);
    for (const pending of queued) pending.reject(error);
  }

  private killChild(): void {
    const child = this.child;
    this.child = null;
    this.reader?.close();
    this.reader = null;
    if (!child) return;
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }

  private makeExitError(code: number | null, signal: NodeJS.Signals | null): LexurgyError {
    const stderr = this.stderrBuffer.trim();
    const detail = stderr ? `\n\n${stderr.slice(-2000)}` : "";
    return new LexurgyError(
      `The Lexurgy process exited unexpectedly (${signal ?? code ?? "unknown"}). ` +
        "Check that Java and Lexurgy are installed correctly." +
        detail,
      { detail: stderr || undefined }
    );
  }
}

function normalizeChanged(response: ChangedResponse): LexurgyApplyResult {
  return {
    words: response.words.slice(),
    intermediates: Object.fromEntries(
      Object.entries(response.intermediates ?? {}).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.slice() : [],
      ])
    ),
    traceLines: response.traceLines.slice(),
  };
}

function toLexurgySpawnError(error: unknown, launch: LaunchSpec): LexurgyError {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") {
    return new LexurgyError(
      `Could not find "${launch.command}". Install Lexurgy or set the Java/Lexurgy paths in settings.`
    );
  }
  return new LexurgyError(
    `Could not start Lexurgy (${launch.command}): ${
      error instanceof Error ? error.message : String(error)
    }`
  );
}
