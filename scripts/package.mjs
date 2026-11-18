import { promises as fs } from "node:fs";
import { zipSync } from "fflate";

const files = ["main.js", "manifest.json", "styles.css"];
const manifest = JSON.parse(await fs.readFile("manifest.json", "utf8"));
const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
if (manifest.version !== pkg.version) {
  throw new Error(
    `Version mismatch: package.json is ${pkg.version} but manifest.json is ${manifest.version}.`
  );
}
const archive = {};
for (const file of files) {
  archive[file] = new Uint8Array(await fs.readFile(file));
}
await fs.mkdir("dist", { recursive: true });
for (const name of await fs.readdir("dist")) {
  if (/^langscape-.*\.zip$/i.test(name)) await fs.rm(`dist/${name}`, { force: true });
}
const out = `dist/langscape-${manifest.version}.zip`;
await fs.writeFile(out, zipSync(archive, { level: 9 }));
console.log(`Wrote ${out} (manifest ${manifest.version})`);
