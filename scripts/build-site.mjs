import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

// GitHub Pages receives only this directory, never the repository or local media.
const root = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const output = join(root, "site-dist");
const previous = await lstat(output).catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
if (previous && (!previous.isDirectory() || await realpath(output) !== output)) {
  throw new Error(`Refusing to replace a non-directory or symlink: ${output}`);
}

const pages = {
  "site/index.html": "index.html",
  "site/docs/index.html": "docs/index.html",
  "site/assets/site.css": "assets/site.css",
  "site/assets/deck.js": "assets/deck.js",
  "site/assets/trailer.js": "assets/trailer.js",
  "docs/video/langscape-trailer.mp4": "media/langscape-trailer.mp4",
  "docs/video/langscape-trailer-poster.jpg": "media/trailer-poster.jpg",
  "site/vendor/swiper/swiper-bundle.min.css": "assets/swiper.min.css",
  "site/vendor/swiper/swiper-bundle.min.js": "assets/swiper.min.js",
  "site/vendor/swiper/LICENSE": "assets/swiper-LICENSE.txt",
  "trailer/public/InterVariable.woff2": "assets/inter.woff2",
  "trailer/public/Inter-OFL.txt": "assets/inter-OFL.txt",
  "trailer/public/lam-alif.svg": "assets/lam-alif.svg",
  "trailer/public/obsidian-logo.svg": "assets/obsidian.svg",
  ...Object.fromEntries(["writing-systems", "lexurgy", "automations", "syntax-trees"]
    .flatMap((name) => ["mp4", "webp"].map((ext) => [`site/media/${name}.${ext}`, `media/${name}.${ext}`]))),
};
const mark = await readFile(join(root, "trailer/public/lam-alif.svg"), "utf8");
const outline = mark.match(/<path\s+[^>]*\bd="([\s\S]+?)"/)?.[1];
if (!outline || !/^[\da-z\s,.-]+$/i.test(outline)) throw new Error("Could not read the Langscape mark");

if (previous) await rm(output, { recursive: true });
await Promise.all(["assets", "docs", "media"].map((dir) => mkdir(join(output, dir), { recursive: true })));
// Pages can cache HTML and assets separately. Give changed CSS/JS new URLs so
// an updated page never picks up styling or behavior from an earlier deployment.
const fingerprints = new Map();
for (const [input, target] of Object.entries(pages)) {
  const ext = extname(target);
  if (ext !== ".css" && ext !== ".js") continue;
  const content = await readFile(join(root, input));
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
  const versioned = `${target.slice(0, -ext.length)}.${hash}${ext}`;
  fingerprints.set(target, versioned);
  await writeFile(join(output, versioned), content);
}
await Promise.all(Object.entries(pages).map(async ([input, target]) => {
  if (fingerprints.has(target)) return;
  if (!target.endsWith(".html")) return copyFile(join(root, input), join(output, target));
  let html = await readFile(join(root, input), "utf8");
  for (const [original, versioned] of fingerprints) html = html.replaceAll(`${original}\"`, `${versioned}\"`);
  await writeFile(join(output, target), html);
}));
await writeFile(join(output, "assets/icon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#2bf6a3"/><path fill="#082019" transform="translate(14.85 6.83) scale(.69)" d="${outline.replace(/\s+/g, " ")}"/></svg>\n`);
console.log(`Built ${Object.keys(pages).length + 1} files in ${output}`);
