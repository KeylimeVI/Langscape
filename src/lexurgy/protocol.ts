/**
 * Wire protocol for `lexurgy server` (v1.7.x).
 *
 * Lexurgy's CLI server reads one JSON object per line from stdin and writes
 * exactly one JSON object per line to stdout. Keeping this protocol isolated
 * from the process management makes it easy to test without a JVM.
 */

export interface LoadStringRequest {
  type: "load_string";
  changes: string;
}

export interface LoadFileRequest {
  type: "load_file";
  path: string;
}

export interface ApplyRequest {
  type: "apply";
  words: string[];
  startAt?: string | null;
  stopBefore?: string | null;
  traceWords?: string[];
  romanize?: boolean;
}

export interface OkResponse {
  type: "ok";
}

export interface ChangedResponse {
  type: "changed";
  words: string[];
  intermediates: Record<string, string[]>;
  traceLines: string[];
}

export interface ErrorResponse {
  type: "error";
  message: string;
  stackTrace?: string[];
}

export type ServerRequest = LoadStringRequest | LoadFileRequest | ApplyRequest;
export type ServerResponse = OkResponse | ChangedResponse | ErrorResponse;

export function encodeRequest(request: ServerRequest): string {
  return JSON.stringify(request) + "\n";
}

export function isServerResponse(value: unknown): value is ServerResponse {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === "ok" || type === "changed" || type === "error";
}

export function parseResponseLine(line: string): ServerResponse {
  const trimmed = line.trim();
  if (!trimmed) throw new Error("Lexurgy returned an empty response line.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`Lexurgy returned invalid JSON: ${trimmed.slice(0, 240)}`);
  }
  if (!isServerResponse(parsed)) {
    throw new Error("Lexurgy returned an unrecognised response.");
  }
  if (parsed.type === "changed") {
    if (!Array.isArray(parsed.words) || !Array.isArray(parsed.traceLines)) {
      throw new Error("Lexurgy returned a malformed 'changed' response.");
    }
    if (typeof parsed.intermediates !== "object" || parsed.intermediates === null) {
      parsed.intermediates = {};
    }
  } else if (parsed.type === "error") {
    if (typeof parsed.message !== "string") parsed.message = "Unknown Lexurgy error";
    if (!Array.isArray(parsed.stackTrace)) parsed.stackTrace = [];
  }
  return parsed;
}

/** Extract a human-friendly line number from Lexurgy's error messages. */
export function extractErrorLine(message: string): number | undefined {
  const match = /\(line\s+(\d+)\)/i.exec(message) ?? /\bline\s+(\d+)\b/i.exec(message);
  if (!match) return undefined;
  const line = Number.parseInt(match[1], 10);
  return Number.isFinite(line) && line > 0 ? line : undefined;
}

/** Lexurgy error messages can contain noisy parser fragments; tidy them up. */
export function cleanLexurgyMessage(message: string): string {
  return message
    .replace(/\r/g, "")
    .replace(/^"\\n\s*"?\s*,?\s*/i, "")
    .trim();
}
