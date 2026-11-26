import { App, Notice, Platform, TFile, normalizePath } from "obsidian";
import { ensureVaultFolder } from "./utils/vault";
import { NOTO_GOTHIC_BASE64, NOTO_GOTHIC_LICENSE_BASE64 } from "./assets/noto-gothic";
import { EXAMPLE_LSC } from "./soundchange/template";
import { serializeRecipe } from "./recipes/model";

export async function createStarterVault(
  app: App,
  root = "Langscape Demo"
): Promise<void> {
  const folder = normalizePath(root);
  const desktop = Platform.isDesktopApp;
  await ensureVaultFolder(app, folder);
  await ensureVaultFolder(app, `${folder}/Fonts`);

  await writeIfMissing(
    app,
    `${folder}/Fonts/NotoSansGothic-Regular.ttf`,
    base64ToArrayBuffer(NOTO_GOTHIC_BASE64),
    true
  );
  await writeIfMissing(
    app,
    `${folder}/Fonts/OFL-NotoSansGothic.txt`,
    base64ToText(NOTO_GOTHIC_LICENSE_BASE64)
  );
  await writeIfMissing(
    app,
    `${folder}/Notes/Tree demo.md`,
    [
      "# Syntax trees",
      "",
      "A tree lives on its own Markdown line:",
      "",
      "{tree: VP(NP({Noto-Sans-Gothic: 𐌰𐍆𐌰}), V(see), NP(Det(the), Adj(blue), N(sky)))}",
      "",
      desktop
        ? "Fonts render inside node labels. Hover a node for its add and delete controls, click a label to rename it, drag a node to move its subtree, and use the top-right toggle to align the tree."
        : "Fonts render inside node labels. Switch to Reading view to see the rendered tree.",
      "",
    ].join("\n")
  );

  await writeIfMissing(
    app,
    `${folder}/Notes/Font demo.md`,
    [
      "# Custom writing systems",
      "",
      "Langscape loads any `.ttf`, `.otf`, `.woff`, or `.woff2` file in the vault and gives it a CSS family.",
      "Use the inline syntax below in Live Preview or Reading view:",
      "",
      "`{Noto-Sans-Gothic: 𐌰𐍆𐌰 𐌴𐌺𐌴}` renders as {Noto-Sans-Gothic: 𐌰𐍆𐌰 𐌴𐌺𐌴}.",
      "",
      "To set a font for an entire note, use frontmatter:",
      "",
      "```yaml",
      "---",
      "langscape-font: Noto Sans Gothic",
      "---",
      "```",
      "",
      "Try the command **Langscape: Insert custom-font text** to pick a font visually.",
      "",
    ].join("\n")
  );

  const recipePath = `${folder}/Recipes/Demo.recipe`;
  if (desktop) {
    await writeIfMissing(app, `${folder}/Changes/Demo.lsc`, EXAMPLE_LSC);

    await writeIfMissing(
      app,
      `${folder}/Words/Proto/apa.md`,
      [
        "---",
        "word: apa",
        "gloss: father",
        "---",
        "# apa",
        "",
        "A reconstructed proto-form used by the demo recipe.",
        "",
      ].join("\n")
    );
    await writeIfMissing(
      app,
      `${folder}/Words/Proto/eke.md`,
      ["---", "word: eke", "gloss: edge", "---", "# eke", ""].join("\n")
    );
    await writeIfMissing(
      app,
      `${folder}/Words/Proto/pataka.md`,
      ["---", "word: pataka", "gloss: plateau", "---", "# pataka", ""].join("\n")
    );

    await writeIfMissing(app, recipePath, serializeRecipe({
      inputFolder: `${folder}/Words/Proto`,
      property: "word",
      changes: [{ path: `${folder}/Changes/Demo.lsc`, disabledRules: [] }],
      outputFolder: `${folder}/Words/Modern`,
    }));

    await ensureVaultFolder(app, `${folder}/Words/Modern`);
  }

  await writeIfMissing(
    app,
    `${folder}/README.md`,
    [
      "# Langscape demo",
      "",
      "This folder was created by the **Langscape: Create starter vault** command.",
      "",
      ...(desktop ? [
        "- `Recipes/Demo.recipe` — applies Lexurgy changes to the `word` property.",
        "- `Words/Proto` — one note per proto-word, with `word:` frontmatter.",
        "- `Changes/Demo.lsc` — Lexurgy sound changes.",
      ] : []),
      "- `Fonts/NotoSansGothic-Regular.ttf` — an OFL font used by the font demo.",
      "- `Notes/Font demo.md` — inline `{nickname: text}` examples.",
      "- `Notes/Tree demo.md` — a syntax tree with a font inside a node label.",
      "",
      ...(desktop ? [
        "Open the recipe and press **Run recipe**. The copies appear in `Words/Modern`; the proto notes stay untouched.",
        "",
        "Install the official Lexurgy CLI separately, then add it to PATH or configure it in Langscape settings.",
      ] : ["Lexurgy and sound-change recipes are available on desktop only."]),
      "",
    ].join("\n")
  );

  const entry = app.vault.getAbstractFileByPath(desktop ? recipePath : `${folder}/README.md`);
  if (entry instanceof TFile) await app.workspace.getLeaf("tab").openFile(entry);
  new Notice(desktop
    ? "Langscape starter vault created. Open Demo.recipe and press Run recipe."
    : "Langscape starter vault created. Try the font and syntax tree demo notes.");
}

async function writeIfMissing(
  app: App,
  path: string,
  content: string | ArrayBuffer,
  binary = false
): Promise<void> {
  const normalized = normalizePath(path);
  const existing = app.vault.getAbstractFileByPath(normalized);
  if (existing) return;
  await ensureVaultFolder(app, normalized.split("/").slice(0, -1).join("/"));
  if (binary && content instanceof ArrayBuffer) {
    await app.vault.createBinary(normalized, content);
  } else {
    await app.vault.create(normalized, String(content));
  }
}

function base64ToText(base64: string): string {
  return new TextDecoder().decode(base64ToBytes(base64));
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bytes = base64ToBytes(base64);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
