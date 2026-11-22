import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { App } from "obsidian";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { extractLexurgyArchive } from "./lexurgy-fixture";
import { detectJava, detectLexurgyEnvironment } from "../../src/lexurgy/locator";
import { LexurgyServer } from "../../src/lexurgy/server";
import type { Recipe } from "../../src/recipes/model";
import { runRecipe } from "../../src/recipes/runner";
import { filterRecipeRules, listRecipeRules } from "../../src/recipes/rules";

const tools = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.tools");
const archive = path.join(tools, "lexurgy.zip");
const installDir = path.join(tools, "recipe-test-install");
const hasArchive = await fs.access(archive).then(() => true, () => false);
const java = await detectJava();
let server: LexurgyServer | undefined;

function memoryVault(input: Record<string, string>) {
  const notes = Object.keys(input).map((path) => ({ path, extension: path.split(".").at(-1) }));
  const folder = { path: "Input", children: notes.filter(({ path }) => path.startsWith("Input/")) };
  const output = { path: "Output", children: [] };
  const write = vi.fn();
  const app = { vault: {
    getAbstractFileByPath: (path: string) => [folder, output, ...notes].find((entry) => entry.path === path) ?? null,
    read: async ({ path }: { path: string }) => input[path],
    create: write,
    adapter: { exists: async () => false, stat: async () => null },
  } } as unknown as App;
  return { app, write };
}

const note = (word: string) => `---\nword: ${word}\nkeep: 42 # exact\n---\nBody  \n`;
const recipe: Recipe = {
  inputFolder: "Input",
  property: "word",
  changes: [],
  outputFolder: "Output",
};

describe.skipIf(!hasArchive || !java)("recipe engine with official Lexurgy", () => {
  beforeAll(async () => {
    await extractLexurgyArchive(new Uint8Array(await fs.readFile(archive)), installDir);
  });

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  async function openServer() {
    const env = await detectLexurgyEnvironment({ managedDir: installDir });
    expect(env.installation).toBeDefined();
    server = new LexurgyServer(env.installation!.launch);
    return server;
  }

  it("disables a complete nested Then/Else rule and feeds the batch to the next file", async () => {
    const first = [
      "first LTR:", "a => b", "compound: # optional", "(", "b /", "_ => c", "Else: Unchanged", ")",
      "Then: c => q", "keep RTL:", "b => d", "",
    ].join("\n");
    const second = ["finish Propagate:", "d => e", ""].join("\n");
    const engine = await openServer();
    expect(listRecipeRules(first)).toEqual(["first", "compound", "keep"]);
    const original = await engine.run(first, ["a", "b", "v"]);
    expect(original.words).toEqual(["q", "q", "v"]);
    const { app, write } = memoryVault({
      "Input/c.md": note("v"), "Input/b.md": note("b"), "Input/a.md": note("a"),
      "first.lsc": first, "second.lsc": second,
    });
    const apply = vi.fn((source: string, words: string[]) => engine.run(source, words));
    const result = await runRecipe({ app, recipe: {
      ...recipe, changes: [{ path: "first.lsc", disabledRules: ["compound"] }, { path: "second.lsc", disabledRules: [] }],
    }, apply });
    expect(apply.mock.calls).toEqual([
      ["first LTR:\na => b\n# optional\n\n\n\n\n\n\nkeep RTL:\nb => d\n", ["a", "b", "v"]],
      [second, ["d", "d", "v"]],
    ]);
    expect(result).toEqual({ written: 3, skipped: 0, paths: ["Output/a.md", "Output/b.md", "Output/c.md"] });
    expect(write.mock.calls).toEqual([["Output/a.md", note("e")], ["Output/b.md", note("e")], ["Output/c.md", note("v")]]);
  });

  it("retains syllables, romanizers and defer definitions while filtering a normal rule", async () => {
    const source = [
      "Syllables:", "a", "b", "helper Defer:", "a =>", "b", "skip:", "a /", "_ => q",
      "use:", ":helper", "Romanizer-middle:", "b => c", "Romanizer:", "b => z", "",
    ].join("\n");
    const engine = await openServer();
    expect(listRecipeRules(source)).toEqual(["helper", "skip", "use"]);
    const filtered = filterRecipeRules(source, ["skip"]);
    const result = await engine.run(filtered.source, ["a"]);
    expect(result.words).toEqual(["z"]);
    expect(result.intermediates).toEqual({ middle: ["c"] });
  });

  it("lets the JVM reject a surviving reference to a disabled deferred block before writes", async () => {
    const first = "helper Defer:\na => b\nkeep:\n:helper\n";
    const engine = await openServer();
    expect((await engine.run(first, ["a"])).words).toEqual(["b"]);
    const { app, write } = memoryVault({ "Input/a.md": note("a"), "first.lsc": first });
    const apply = (source: string, words: string[]) => engine.run(source, words);
    await expect(runRecipe({ app, recipe: { ...recipe, changes: [{ path: "first.lsc", disabledRules: ["helper"] }] }, apply }))
      .rejects.toThrow(/first\.lsc.*block "helper" is not defined/);
    expect(write).not.toHaveBeenCalled();
  });

  it("treats a cleanup and its Off statement as one selectable name", async () => {
    const source = "cleanup Cleanup:\na => b\nnext:\nb => c\ncleanup:\nOff\nlast:\nc => d\n";
    const engine = await openServer();
    expect(listRecipeRules(source)).toEqual(["cleanup", "next", "last"]);
    const retained = await engine.run(filterRecipeRules(source, ["last"]).source, ["a"]);
    expect(retained.words).toEqual(["c"]);
    const disabled = await engine.run(filterRecipeRules(source, ["cleanup"]).source, ["a"]);
    expect(disabled.words).toEqual(["a"]);
  });
});
