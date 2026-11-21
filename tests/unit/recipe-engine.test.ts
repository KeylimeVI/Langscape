import { TFile, TFolder, type App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_RECIPE, readRecipe, serializeRecipe, type Recipe } from "../../src/recipes/model";
import { listRecipeProperties, runRecipe } from "../../src/recipes/runner";
import { filterRecipeRules, listRecipeRules } from "../../src/recipes/rules";

const firstLsc = "First:\na => b\n";
const secondLsc = "Second:\nb => c\n";
const recipe: Recipe = {
  inputFolder: "In",
  property: "word",
  changes: [{ path: "first.lsc", disabledRules: [] }],
  outputFolder: "Out",
};

/** Keep the vault index and the adapter distinct so an unindexed file can exist. */
function vault(files: Record<string, string>, hidden: string[] = []) {
  const root = makeFolder("/");
  const values = new Map(Object.entries(files));
  const entries = new Map<string, TFile | TFolder>([["/", root]]);
  const folders = new Set<string>(["/"]);
  const parentPath = (name: string) => name.slice(0, Math.max(0, name.lastIndexOf("/"))) || "/";
  const addFolder = (name: string): TFolder => {
    if (folders.has(name)) return entries.get(name) as TFolder;
    const parent = addFolder(parentPath(name));
    const target = makeFolder(name);
    folders.add(name);
    entries.set(name, target);
    parent.children.push(target);
    return target;
  };
  const addFile = (name: string, content: string) => {
    if (values.has(name) && entries.has(name) || hidden.includes(name)) throw new Error("Already exists");
    const parent = addFolder(parentPath(name));
    const file = new (TFile as unknown as new (path: string) => TFile)(name);
    parent.children.push(file);
    entries.set(name, file);
    values.set(name, content);
    return file;
  };
  for (const [name, content] of values) addFile(name, content);
  const app = { vault: {
    getRoot: () => root,
    getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
    read: vi.fn(async (file: TFile) => values.get(file.path)!),
    create: vi.fn(async (name: string, content: string) => addFile(name, content)),
    createFolder: vi.fn(async (name: string) => addFolder(name)),
    adapter: {
      exists: async (name: string) => entries.has(name) || hidden.includes(name),
      stat: async (name: string) => hidden.includes(name) ? { type: "file" } : null,
    },
  } };
  return { app: app as unknown as App, api: app.vault, values };
}

function makeFolder(name: string): TFolder {
  return new (TFolder as unknown as new (path: string) => TFolder)(name);
}

const note = (value: string) => `---\nword: ${value}\n---\n# Body\n`;

it("round-trips readable JSON, root and unset, and rejects malformed input", () => {
  expect(readRecipe("\ufeff \r\n")).toEqual(EMPTY_RECIPE);
  const value = { ...recipe, inputFolder: "/", outputFolder: null };
  const source = serializeRecipe(value);
  expect(source).toMatch(/\n  "inputFolder": "\/",\n/);
  expect(readRecipe(source)).toEqual(value);
  expect(() => readRecipe("{" )).toThrow(/Invalid recipe JSON/);
  expect(() => readRecipe("{}")).toThrow(/inputFolder/);
  expect(() => readRecipe(JSON.stringify({ ...value, changes: [{ path: "x.lsc", disabledRules: [42] }] })))
    .toThrow(/change 1/);
});

it("finds exact, nonblank text property keys on direct notes only", async () => {
  const { app } = vault({
    "In/a.md": "---\n word: alpha\n 'spaced key': beta\n blank: '  '\n num: 42\n bool: true\n list: [a]\n---\nBody\n",
    "In/b.MD": "---\n word: gamma\n nested:\n   nope: text\n unmapped: null\n dotted.key: string\n---\nBody\n",
    "In/sub/nested.md": "---\nnestedOnly: yes\n---\n",
    "In/graffiti.txt": "---\nnotMarkdown: string\n---",
    "root.md": "---\nrootOnly: string\n---\n",
    "In/bad.md": "---\nnotValid: [\n---\n",
  });
  expect(await listRecipeProperties(app, "In")).toEqual(["dotted.key", "spaced key", "word"]);
  expect(await listRecipeProperties(app, "/")).toEqual(["rootOnly"]);
  await expect(listRecipeProperties(app, "missing")).rejects.toThrow(/does not exist/);
});

it("preflights and batches in stable order, writes copies only, and preserves YAML and body bytes", async () => {
  const a = "\ufeff---  \r\n\"word\": 'alpha'   # selected\r\nother: [ one , two ] # keep\r\n---\r\n\r\nBody  \r\n---\r\n";
  const b = "---\nword: beta\ncount: 8\n---\n# A heading \n";
  const { app, api, values } = vault({
    "In/b.md": b,
    "In/a.MD": a,
    "In/blank.md": note("'   '"),
    "In/number.md": note("42"),
    "In/none.md": "---\nother: ab\n---\n",
    "In/list.md": note("[one, two]"),
    "In/body.md": "word: ab\n",
    "In/nested/z.md": note("nested"),
    "other.md": note("root"),
    "first.lsc": "Skip LTR: # skip comment\nx => y\nFirst:\na => b\n",
    "second.lsc": secondLsc,
  });
  const apply = vi.fn(async (_source: string, words: string[]) => {
    expect(api.create).not.toHaveBeenCalled();
    expect(api.createFolder).not.toHaveBeenCalled();
    return { words: words.map((word) => word + "!") };
  });
  const result = await runRecipe({ app, recipe: {
    ...recipe,
    outputFolder: "New/Out",
    changes: [{ path: "first.lsc", disabledRules: ["Skip"] }, { path: "second.lsc", disabledRules: [] }],
  }, apply });
  expect(apply.mock.calls).toEqual([
    ["# skip comment\n\nFirst:\na => b\n", ["alpha", "beta"]],
    [secondLsc, ["alpha!", "beta!"]],
  ]);
  expect(result).toEqual({ written: 2, skipped: 5, paths: ["New/Out/a.MD", "New/Out/b.md"] });
  expect(values.get("In/a.MD")).toBe(a);
  expect(values.get("In/b.md")).toBe(b);
  expect(values.get("New/Out/a.MD")).toBe(a.replace("'alpha'", "'alpha!!'"));
  expect(values.get("New/Out/b.md")).toBe(b.replace("beta", "beta!!"));
});

it("handles block/flow YAML, exact keys, and YAML-sensitive Lexurgy strings", async () => {
  const { app, values } = vault({
    "In/block.md": "---\n'word': >-  # keep header\n  a\n  b\n\nother: z\n...\n\nBody\n",
    "In/flow.md": "---\n{ \"word\": b , other: 42 }\n---\nBody  \n",
    "In/alias.md": "---\nother: &foo a\nword: *foo  # keep comment\n---\n",
    "first.lsc": firstLsc,
  });
  await runRecipe({ app, recipe, apply: async (_source, words) => {
    expect(words).toEqual(["a", "a b", "b"]);
    return { words: ["false", "a # b\nnext", "b, foo: bar"] };
  } });
  expect(values.get("Out/block.md")).toBe("---\n'word': \"a # b\\nnext\"  # keep header\n\nother: z\n...\n\nBody\n");
  expect(values.get("Out/flow.md")).toBe("---\n{ \"word\": \"b, foo: bar\" , other: 42 }\n---\nBody  \n");
  expect(values.get("Out/alias.md")).toBe("---\nother: &foo a\nword: \"false\"  # keep comment\n---\n");
});

it("copies original bytes unchanged for an all-disabled stage, including at the vault root", async () => {
  const source = "---\nword:    'a'  # untouched\n---\n";
  const { app, values } = vault({ "In/a.md": source, "first.lsc": firstLsc });
  const apply = vi.fn();
  await expect(runRecipe({ app, recipe: {
    ...recipe, outputFolder: "/", changes: [{ path: "first.lsc", disabledRules: ["First"] }],
  }, apply })).resolves.toEqual({ written: 1, skipped: 0, paths: ["a.md"] });
  expect(apply).not.toHaveBeenCalled();
  expect(values.get("a.md")).toBe(source);
});

describe("recipe preflight", () => {
  it("rejects unset/same folders, missing changes, and occupied destination paths before Lexurgy", async () => {
    const { app, api } = vault({ "In/a.md": note("a"), "first.lsc": firstLsc }, ["Out/a.md", "folder-file"]);
    const apply = vi.fn();
    for (const [config, error] of [
      [{ ...recipe, inputFolder: null }, /Choose an input and an output/],
      [{ ...recipe, outputFolder: "/In/./" }, /must be different/],
      [{ ...recipe, changes: [] }, /Add a sound-change file/],
      [recipe, /Out\/a\.md.*already exists/],
      [{ ...recipe, outputFolder: "folder-file/sub" }, /occupied by a file/],
      [{ ...recipe, outputFolder: "New", changes: [{ path: "missing.lsc", disabledRules: [] }] }, /missing\.lsc.*not found/],
      [{ ...recipe, outputFolder: "New", changes: [{ path: "first.lsc", disabledRules: ["Unknown"] }] }, /first\.lsc.*Unknown.*not found/],
    ] as const) {
      await expect(runRecipe({ app, recipe: config as Recipe, apply })).rejects.toThrow(error);
    }
    expect(apply).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
    expect(api.createFolder).not.toHaveBeenCalled();
  });

  it("never writes anything if a later stage fails or returns a partial batch", async () => {
    const { app, api } = vault({ "In/a.md": note("a"), "In/b.md": note("b"), "first.lsc": firstLsc, "second.lsc": secondLsc });
    const config = { ...recipe, changes: [...recipe.changes, { path: "second.lsc", disabledRules: [] }] };
    for (const failure of [() => { throw new Error("invalid grammar"); }, () => ({ words: ["partial"] })]) {
      const apply = vi.fn(async (source: string) => source === firstLsc ? { words: ["x", "y"] } : failure());
      await expect(runRecipe({ app, recipe: config, apply })).rejects.toThrow(/second\.lsc/);
      expect(apply.mock.calls).toEqual([[firstLsc, ["a", "b"]], [secondLsc, ["x", "y"]]]);
      expect(api.create).not.toHaveBeenCalled();
      expect(api.createFolder).not.toHaveBeenCalled();
    }
  });

  it("rejects a replacement that would change other properties through a referenced anchor", async () => {
    const { app, api } = vault({
      "In/a.md": note("a"), "In/b.md": "---\nword: &shared b\nother: *shared\n---\n", "first.lsc": firstLsc,
    });
    await expect(runRecipe({ app, recipe, apply: async () => ({ words: ["x", "y"] }) })).rejects.toThrow(/Out\/b\.md.*anchor/);
    expect(api.create).not.toHaveBeenCalled();
    expect(api.createFolder).not.toHaveBeenCalled();
  });
});

it("keeps declarations, romanizers, syllables, escapes and comments separate from disabled compound rules", () => {
  const source = [
    "# NotARule:", "Feature +voice", "Class Segment {", "a,", "b", "}", "Deromanizer:", "p => b",
    "change-2 @Segment: # rule", "(", "a =>", "b", "Else: Unchanged # clause", ")", "Then LTR: b => c",
    "Syllables:", "Explicit", "Romanizer-change-2 Literal:", "c => b", "last:", "\\# => x", "",
  ].join("\r\n");
  expect(listRecipeRules(source)).toEqual(["change-2", "last"]);
  const { source: filtered, hasCode } = filterRecipeRules(source, ["change-2"]);
  expect(hasCode).toBe(true);
  expect(filtered).toContain("Deromanizer:\r\np => b\r\n# rule\r\n");
  expect(filtered).toContain("# clause\r\n");
  expect(filtered).toContain("Syllables:\r\nExplicit\r\nRomanizer-change-2 Literal:\r\nc => b\r\nlast:\r\n\\# => x\r\n");
  expect(filtered).not.toContain("Unchanged");
  expect(filtered.match(/\r\n/g)).toHaveLength(source.match(/\r\n/g)!.length);
});
