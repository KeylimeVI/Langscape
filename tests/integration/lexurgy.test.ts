import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectJava,
  detectLexurgyEnvironment,
} from "../../src/lexurgy/locator";
import { extractLexurgyArchive } from "./lexurgy-fixture";
import { LexurgyServer } from "../../src/lexurgy/server";
import { LexurgyService } from "../../src/lexurgy/service";
import type LangscapePlugin from "../../src/main";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tools = path.join(root, ".tools");
const archive = path.join(tools, "lexurgy.zip");
const installDir = path.join(tools, "test-install");
const changesPath = path.join(root, "tests/fixtures/changes/basic.lsc");
const invalidPath = path.join(root, "tests/fixtures/changes/invalid.lsc");

const hasArchive = await fs
  .access(archive)
  .then(() => true)
  .catch(() => false);
const java = await detectJava();

let server: LexurgyServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
  vi.unstubAllEnvs();
});

describe.skipIf(!hasArchive || !java)("real Lexurgy integration", () => {
  it("extracts the official archive and detects the installation", async () => {
    const data = new Uint8Array(await fs.readFile(archive));
    const extracted = await extractLexurgyArchive(data, installDir);
    expect(extracted.jarCount).toBeGreaterThan(3);
    expect(extracted.version).toMatch(/^1\./);
    await expect(fs.access(path.join(extracted.libDir, "core-1.7.7.jar"))).resolves.toBeUndefined();

    const env = await detectLexurgyEnvironment({ managedDir: installDir });
    expect(env.error).toBeUndefined();
    expect(env.installation?.kind).toBe("managed");
    expect(env.installation?.launch.command).toBe(java?.path);
  });

  it("prefers a configured install but still detects the legacy copy as a fallback", async () => {
    const configured = await detectLexurgyEnvironment({ configuredPath: installDir, managedDir: installDir });
    expect(configured.installation?.kind).toBe("configured");
    const fallback = await detectLexurgyEnvironment({ configuredPath: path.join(installDir, "missing"), managedDir: installDir });
    expect(fallback.installation?.kind).toBe("managed");
  });

  it("loads changes, applies them, and reports traces", async () => {
    const env = await detectLexurgyEnvironment({ managedDir: installDir });
    expect(env.installation).toBeDefined();
    server = new LexurgyServer(env.installation!.launch, { requestTimeoutMs: 30_000 });

    const changes = await fs.readFile(changesPath, "utf8");
    const result = await server.run(changes, ["apa", "eke", "pata"], {
      traceWords: ["pata"],
    });
    expect(result.words).toEqual(["aba", "egi", "pada"]);
    expect(result.traceLines.join("\n")).toContain("Tracing pata");
  });

  it.each(["direct", "wrapper"])("preserves IPA and diacritics with an ASCII Java console (%s)", async (mode) => {
    // Older Java honors the sun.* properties, while newer Java honors the standard names.
    vi.stubEnv("LC_ALL", "C");
    vi.stubEnv("JAVA_TOOL_OPTIONS", "-Dsun.stdout.encoding=US-ASCII -Dstdout.encoding=US-ASCII");
    const env = await detectLexurgyEnvironment({ configuredPath: installDir });
    const launch = env.installation!.launch;
    server = new LexurgyServer(mode === "direct" ? launch : {
      // A stand-in for an installed CLI launcher that forwards its environment to Java.
      command: process.execPath,
      args: ["-e", `
        const [command, ...args] = process.argv.slice(1);
        const child = require("node:child_process").spawn(command, args, { stdio: "inherit" });
        child.once("exit", (code) => process.exit(code ?? 1));
      `, "--", launch.command, ...launch.args],
      cwd: launch.cwd,
    });

    const changes = await fs.readFile(path.join(root, "tests/fixtures/changes/unicode.lsc"), "utf8");
    const result = await server.run(changes, ["aqelar", "ñu"], {
      traceWords: ["aqelar"],
    });
    expect(result.words).toEqual(["at͡ʃélar", "ñu"]);
    expect(result.traceLines.join("\n").normalize("NFC")).toContain("at͡ʃélar");
  });

  it("surfaces Lexurgy errors with line numbers", async () => {
    const env = await detectLexurgyEnvironment({ managedDir: installDir });
    server = new LexurgyServer(env.installation!.launch);
    const changes = await fs.readFile(invalidPath, "utf8");
    await expect(server.load(changes)).rejects.toMatchObject({
      name: "LexurgyError",
    });
  });

  it("keeps a run's load and apply together during concurrent validation and runs", async () => {
    const service = new LexurgyService({
      settings: { lexurgyPath: installDir },
      app: { vault: { adapter: {} } },
    } as unknown as LangscapePlugin);
    try {
      const [first, validation, second] = await Promise.all([
        service.apply("First:\n  a => b\n", ["a"]),
        service.validate("Validation:\n  a => z\n"),
        service.apply("Second:\n  a => c\n", ["a"]),
      ]);
      expect(validation.valid).toBe(true);
      expect(first.words).toEqual(["b"]);
      expect(second.words).toEqual(["c"]);
    } finally {
      await service.dispose();
    }
  });

  it("can apply a suffix of the rule list", async () => {
    const env = await detectLexurgyEnvironment({ managedDir: installDir });
    server = new LexurgyServer(env.installation!.launch);
    const changes = await fs.readFile(changesPath, "utf8");
    await server.load(changes);
    const before = await server.apply(["eke"], { stopBefore: "Raising" });
    const after = await server.apply(["eke"], { startAt: "Raising" });
    expect(before.words).toEqual(["ege"]);
    expect(after.words).toEqual(["eki"]);
  });
});
