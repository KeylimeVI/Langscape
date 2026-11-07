import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectJava,
  detectLexurgyEnvironment,
} from "../../src/lexurgy/locator";
import { extractLexurgyArchive } from "../../src/lexurgy/installer";
import { LexurgyServer } from "../../src/lexurgy/server";

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

  it("surfaces Lexurgy errors with line numbers", async () => {
    const env = await detectLexurgyEnvironment({ managedDir: installDir });
    server = new LexurgyServer(env.installation!.launch);
    const changes = await fs.readFile(invalidPath, "utf8");
    await expect(server.load(changes)).rejects.toMatchObject({
      name: "LexurgyError",
    });
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
