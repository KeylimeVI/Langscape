import { App, Notice, TFile, TFolder, normalizePath } from "obsidian";
import { NOTO_GOTHIC_BASE64, NOTO_GOTHIC_LICENSE_BASE64 } from "./assets/noto-gothic";
import { EXAMPLE_LSC } from "./soundchange/template";

export interface StarterVaultResult {
  folder: string;
  canvasPath: string;
}

export async function createStarterVault(
  app: App,
  root = "Langscape Demo"
): Promise<StarterVaultResult> {
  const folder = normalizePath(root);
  await ensureFolder(app, folder);
  await ensureFolder(app, `${folder}/Fonts`);
  await ensureFolder(app, `${folder}/Words/Proto`);
  await ensureFolder(app, `${folder}/Changes`);
  await ensureFolder(app, `${folder}/Pipelines`);

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
      "A reconstructed proto-form used by the demo pipeline.",
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
      "Fonts render inside node labels. Hover for + and ×, click a label to rename it, drag a node to move its subtree, and use the top-right toggle to align the tree.",
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

  const canvas = {
    nodes: [
      {
        id: "proto-source",
        type: "text",
        text: [
          "```langscape",
          "type: source",
          "path: Langscape Demo/Words/Proto",
          "```",
        ].join("\n"),
        x: -660,
        y: -120,
        width: 340,
        height: 260,
      },
      {
        id: "sound-changes",
        type: "text",
        text: [
          "```langscape",
          "type: sound-change",
          "file: Langscape Demo/Changes/Demo.lsc",
          "```",
        ].join("\n"),
        x: -230,
        y: -120,
        width: 340,
        height: 260,
      },
      {
        id: "modern-output",
        type: "text",
        text: [
          "```langscape",
          "type: output",
          "path: Langscape Demo/Words/Modern",
          "format: markdown",
          "```",
        ].join("\n"),
        x: 200,
        y: -120,
        width: 340,
        height: 260,
      },
      {
        id: "instructions",
        type: "text",
        text: [
          "Select the output card and press **Run**. Use the Langscape menu in the canvas header for **Run all**.",
        ].join("\n"),
        x: -230,
        y: 220,
        width: 500,
        height: 180,
      },
    ],
    edges: [
      {
        id: "e1",
        fromNode: "proto-source",
        fromSide: "right",
        toNode: "sound-changes",
        toSide: "left",
      },
      {
        id: "e2",
        fromNode: "sound-changes",
        fromSide: "right",
        toNode: "modern-output",
        toSide: "left",
      },
    ],
  };

  const canvasPath = normalizePath(`${folder}/Pipelines/Demo.canvas`);
  await writeIfMissing(app, canvasPath, JSON.stringify(canvas, null, 2));

  await writeIfMissing(
    app,
    `${folder}/README.md`,
    [
      "# Langscape demo",
      "",
      "This folder was created by the **Langscape: Create starter vault** command.",
      "",
      "- `Pipelines/Demo.canvas` — a three-step sound-change pipeline.",
      "- `Words/Proto` — one note per proto-word, with `word:` frontmatter.",
      "- `Changes/Demo.lsc` — Lexurgy sound changes.",
      "- `Fonts/Noto Sans Gothic` — an OFL font used by the font demo.",
      "- `Notes/Font demo.md` — inline `{nickname: text}` examples.",
      "- `Notes/Tree demo.md` — a syntax tree with a font inside a node label.",
      "",
      "Open the canvas, use the Langscape menu in the canvas header, and press **Run**.",
      "",
      "Lexurgy must be installed. Langscape can download the official CLI from the plugin settings.",
      "",
    ].join("\n")
  );

  const canvasFile = app.vault.getAbstractFileByPath(canvasPath);
  if (canvasFile && "extension" in canvasFile) {
    await app.workspace.getLeaf(true).openFile(canvasFile as TFile);
  }
  new Notice("Langscape starter vault created. Press Run on the output card.");
  return { folder, canvasPath };
}

async function ensureFolder(app: App, path: string): Promise<void> {
  const normalized = normalizePath(path);
  if (!normalized || normalized === "/") return;
  const existing = app.vault.getAbstractFileByPath(normalized);
  if (existing && existing instanceof TFolder) return;
  const parts = normalized.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const found = app.vault.getAbstractFileByPath(current);
    if (found && found instanceof TFolder) continue;
    try {
      await app.vault.createFolder(current);
    } catch (error) {
      if (!(await app.vault.adapter.exists(current))) throw error;
    }
  }
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
  await ensureFolder(app, normalized.split("/").slice(0, -1).join("/"));
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
