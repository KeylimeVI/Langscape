import { promises as fs } from "node:fs";
import { zipSync } from "fflate";

const files = ["main.js", "manifest.json", "styles.css"];
const manifest = JSON.parse(await fs.readFile("manifest.json", "utf8"));
const archive = {};
for (const file of files) {
  archive[file] = new Uint8Array(await fs.readFile(file));
}
await fs.mkdir("dist", { recursive: true });
const out = `dist/langscape-${manifest.version}.zip`;
await fs.writeFile(out, zipSync(archive, { level: 9 }));
console.log(`Wrote ${out}`);
