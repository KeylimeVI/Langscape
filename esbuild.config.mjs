import esbuild from "esbuild";
import process from "node:process";

const prod = process.argv[2] === "production";

const external = [
  "obsidian",
  "electron",
  "@codemirror/autocomplete",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  // Node built-ins used on desktop.
  "child_process",
  "node:child_process",
  "fs",
  "node:fs",
  "fs/promises",
  "node:fs/promises",
  "path",
  "node:path",
  "os",
  "node:os",
  "readline",
  "node:readline",
  "url",
  "node:url",
  "crypto",
  "node:crypto",
  "util",
  "node:util",
];

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external,
  format: "cjs",
  target: "es2020",
  platform: "node",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  minify: prod,
  outfile: "main.js",
  banner: {
    js: "/* Langscape for Obsidian - MIT licensed. Lexurgy is a separate GPL-3.0 program invoked at runtime. */",
  },
});

if (prod) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
  console.log("Watching for changes...");
}
