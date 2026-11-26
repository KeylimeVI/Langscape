/**
 * Pure helpers for Android ADB device listing, UIAutomator XML parsing,
 * and staging the Langscape Android test vault.
 */
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

export function parseAdbDevices(stdout) {
  const devices = [];
  for (const rawLine of String(stdout).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("List of devices") || line.startsWith("*")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const [serial, state, ...rest] = parts;
    const meta = {};
    for (const token of rest) {
      const [k, v] = token.split(":");
      if (k && v) meta[k] = v;
    }
    devices.push({ serial, state, ...meta });
  }
  return devices;
}

export function parseBounds(boundsStr) {
  const match = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(String(boundsStr ?? "").trim());
  if (!match) return null;
  const left = Number(match[1]);
  const top = Number(match[2]);
  const right = Number(match[3]);
  const bottom = Number(match[4]);
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    cx: Math.round((left + right) / 2),
    cy: Math.round((top + bottom) / 2),
  };
}

function unescapeXml(str) {
  return String(str ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function parseUiHierarchy(xml) {
  const nodes = [];
  const tagRegex = /<node\b([^>]*?)\/?>/g;
  const attrRegex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let tagMatch;
  while ((tagMatch = tagRegex.exec(String(xml ?? ""))) !== null) {
    const attrs = {};
    let attrMatch;
    while ((attrMatch = attrRegex.exec(tagMatch[1])) !== null) {
      attrs[attrMatch[1]] = unescapeXml(attrMatch[2]);
    }
    const bounds = parseBounds(attrs.bounds);
    nodes.push({
      text: attrs.text ?? "",
      contentDesc: attrs["content-desc"] ?? "",
      resourceId: attrs["resource-id"] ?? "",
      className: attrs.class ?? "",
      clickable: attrs.clickable === "true",
      enabled: attrs.enabled !== "false",
      bounds,
    });
  }
  return nodes;
}

export function findUiNode(nodes, query) {
  return (
    nodes.find((node) => {
      if (!node.bounds || node.bounds.width === 0 || node.bounds.height === 0) return false;
      if (query.text !== undefined && node.text !== query.text) return false;
      if (query.textRegex && !query.textRegex.test(node.text)) return false;
      if (query.contentDesc !== undefined && node.contentDesc !== query.contentDesc) return false;
      if (query.contentDescRegex && !query.contentDescRegex.test(node.contentDesc)) return false;
      if (query.resourceId && !node.resourceId.includes(query.resourceId)) return false;
      return true;
    }) ?? null
  );
}

export async function stageAndroidTestVault(vaultDir, rootDir) {
  const pluginDir = path.join(vaultDir, ".obsidian", "plugins", "langscape");
  await fs.rm(vaultDir, { recursive: true, force: true });
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.mkdir(path.join(vaultDir, "Fonts"), { recursive: true });

  for (const file of ["main.js", "manifest.json", "styles.css"]) {
    const src = path.join(rootDir, file);
    if (!existsSync(src)) {
      throw new Error(`Missing built plugin artifact ${file}. Run "npm run build" first.`);
    }
    await fs.copyFile(src, path.join(pluginDir, file));
  }

  await fs.copyFile(
    path.join(rootDir, "tests/fixtures/fonts/NotoSansGothic-Regular.ttf"),
    path.join(vaultDir, "Fonts/NotoSansGothic-Regular.ttf")
  );
  await fs.writeFile(
    path.join(vaultDir, ".obsidian", "community-plugins.json"),
    JSON.stringify(["langscape"], null, 2) + "\n"
  );
  await fs.writeFile(
    path.join(vaultDir, ".obsidian", "app.json"),
    JSON.stringify({ defaultViewMode: "preview", livePreview: true }, null, 2) + "\n"
  );

  const notes = {
    "01-Fonts.md": [
      "# Android Font Test",
      "",
      "Inline Gothic writing system:",
      "",
      "{Noto-Sans-Gothic: 𐌰𐍆𐌰 𐌴𐌺𐌴 𐍅𐌿𐌻𐍆𐍃}",
      "",
      "Plain comparison text: afa eke wulfs.",
      "",
    ].join("\n"),
    "02-Syntax-Tree.md": [
      "# Android Syntax Tree Test",
      "",
      "{tree: VP(NP({Noto-Sans-Gothic: 𐌰𐍆𐌰}), V(see), NP(Det(the), Adj(blue), N(sky)))}",
      "",
    ].join("\n"),
    "03-Merged-Tables.md": [
      "# Android Merged Tables Test",
      "",
      "| Region | Q1 | < | Q2 | < |",
      "| --- | --- | --- | --- | --- |",
      "| North | 10 | 12 | 14 | 16 |",
      "| ^ | 8 | 9 | 11 | 13 |",
      "| South | 22 | 28 | 30 | 34 |",
      "",
      "| Case | Gothic | Gloss |",
      "| --- | --- | --- |",
      "| Nom | {Noto-Sans-Gothic: 𐌰𐍆𐌰} | father |",
      "| ^ | {Noto-Sans-Gothic: 𐌴𐌺𐌴} | edge |",
      "",
    ].join("\n"),
    "04-Showcase.md": [
      "# Langscape Android Showcase",
      "",
      "Font: {Noto-Sans-Gothic: 𐌰𐍆𐌰 𐌴𐌺𐌴}",
      "",
      "{tree: S(NP(N({Noto-Sans-Gothic: 𐌰𐍆𐌰})), VP(V(sleeps)))}",
      "",
      "| A | B | < |",
      "| --- | --- | --- |",
      "| X | 1 | 2 |",
      "| ^ | 3 | 4 |",
      "",
    ].join("\n"),
  };

  for (const [name, content] of Object.entries(notes)) {
    await fs.writeFile(path.join(vaultDir, name), content, "utf8");
  }

  return { vaultDir, noteNames: Object.keys(notes) };
}
