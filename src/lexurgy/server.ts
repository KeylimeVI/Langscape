import { Platform } from "obsidian";
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

// Lexurgy's JSON pipes must be UTF-8 even when the OS uses a legacy code page.
// Java 17 uses the sun.* names; newer Java uses stdout/stderr.encoding.
const JAVA_UTF8_OPTIONS = [
  "-Dfile.encoding=UTF-8",
  "-Dsun.stdout.encoding=UTF-8",
  "-Dsun.stderr.encoding=UTF-8",
  "-Dstdout.encoding=UTF-8",
  "-Dstderr.encoding=UTF-8",
].join(" ");

type TimerHandle = number;

interface SpawnedProcess {
  readonly killed: boolean;
  readonly stdin: {
    readonly writable: boolean;
    write(chunk: string, callback?: (error: Error | null | undefined) => void): boolean;
  };
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: {
    setEncoding(encoding: BufferEncoding): void;
    on(event: "data", listener: (chunk: string) => void): unknown;
  };
  once(event: "spawn", listener: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
}

interface LineReader {
  on(event: "line", listener: (line: string) => void): unknown;
  close(): void;
}

interface Pending {
  request: ServerRequest;
  resolve: (response: ServerResponse) => void;
  reject: (error: Error) => void;
  timer: TimerHandle | null;
}

/**
 * A long-lived `lexurgy server` child process.
 *
 * Requests are serialized because the JVM server itself is single-threaded;
 * serializing also means responses can be matched to requests without needing
 * request IDs in the wire format.
 */
export class LexurgyServer {
  private child: SpawnedProcess | null = null;
  private reader: LineReader | null = null;
  private starting: Promise<void> | null = null;
  private pending: Pending | null = null;
  private queue: Pending[] = [];
  private operations: Promise<void> = Promise.resolve();
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

  async start(): Promise<void> {
    if (this.isRunning) return;
    if (this.starting) return this.starting;
    if (!Platform.isDesktopApp) {
      throw new LexurgyError("Lexurgy is only available on desktop.");
    }
    this.stopped = false;
    const [{ spawn }, { createInterface }] = await Promise.all([
      import("node:child_process"),
      import("node:readline"),
    ]);
    if (this.stopped) {
      throw new LexurgyError("Lexurgy server was stopped.");
    }
    this.starting = new Promise<void>((resolve, reject) => {
      let settled = false;
      const startTimer = window.setTimeout(() => {
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

      let child: SpawnedProcess;
      try {
        // Apply this to the child only, including installs launched through a CLI wrapper.
        const env = {
          ...process.env,
          JAVA_TOOL_OPTIONS: [process.env.JAVA_TOOL_OPTIONS, JAVA_UTF8_OPTIONS].filter(Boolean).join(" "),
        };
        child = spawn(this.launch.command, this.launch.args, {
          cwd: this.launch.cwd,
          env,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        window.clearTimeout(startTimer);
        settled = true;
        reject(toLexurgySpawnError(error, this.launch));
        return;
      }

      this.child = child;
      this.stderrBuffer = "";

      child.once("spawn", () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(startTimer);
        this.starting = null;
        resolve();
      });

      child.once("error", (error) => {
        if (!settled) {
          settled = true;
          window.clearTimeout(startTimer);
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

  load(changes: string): Promise<void> {
    return this.enqueueOperation(() => this.loadChanges(changes));
  }

  apply(words: string[], options: LexurgyApplyOptions = {}): Promise<LexurgyApplyResult> {
    return this.enqueueOperation(() => this.applyLoaded(words, options));
  }

  private async loadChanges(changes: string): Promise<void> {
    await this.request({ type: "load_string", changes });
  }

  private async applyLoaded(words: string[], options: LexurgyApplyOptions): Promise<LexurgyApplyResult> {
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

  /** Keep the load and apply together; validation must not swap the loaded rules. */
  run(
    changes: string,
    words: string[],
    options: LexurgyApplyOptions = {}
  ): Promise<LexurgyApplyResult> {
    return this.enqueueOperation(async () => {
      await this.loadChanges(changes);
      return this.applyLoaded(words, options);
    });
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation);
    this.operations = result.then(() => undefined, () => undefined);
    return result;
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
      const killTimer: unknown = window.setTimeout(() => {
        try {
          if (!child.killed) child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }, 2000);
      if (typeof killTimer === "object" && killTimer !== null && "unref" in killTimer && typeof killTimer.unref === "function") {
        killTimer.unref();
      }
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
    next.timer = window.setTimeout(() => {
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
      if (next.timer) window.clearTimeout(next.timer);
      next.reject(new LexurgyError(`Could not write to Lexurgy: ${error.message}`));
      queueMicrotask(() => void this.pump());
    });
  }

  private handleLine(line: string): void {
    const current = this.pending;
    if (!current) return;
    this.pending = null;
    if (current.timer) window.clearTimeout(current.timer);

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
      if (this.pending.timer) window.clearTimeout(this.pending.timer);
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

function getErrnoCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function toLexurgySpawnError(error: unknown, launch: LaunchSpec): LexurgyError {
  if (getErrnoCode(error) === "ENOENT") {
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
