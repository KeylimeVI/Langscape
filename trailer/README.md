# Langscape 1.0 trailer

A 38-second, 1920×1080 motion graphic. It follows the original [Narevu](<NAREVU.md>) word *tapa* → *taba* through its writing system, the Lexurgy test bench, and a sound-change recipe. The Obsidian shots were captured in a disposable widescreen vault with a graphite-and-turquoise theme. No personal vault data is shown.

## Render

From this directory:

```bash
npm ci
npm run render
npx remotion still src/index.ts LangscapeTrailer out/poster.jpg --frame=86 --image-format=jpeg
```

The trailer is written to `out/langscape-trailer.mp4`. The release copies are the [trailer](<../docs/video/langscape-trailer.mp4>) and [poster](<../docs/video/langscape-trailer-poster.jpg>).

## Assets

- [Narevu Script](<public/NarevuScript.ttf>) is an original font built with [make_narevu.mjs](<make_narevu.mjs>).
- The lām–alif mark uses the supplied [SVG](<../docs/23a-Lam-Alif.svg>) by Юкатан, [marked public domain on Wikimedia Commons](https://commons.wikimedia.org/wiki/File:23a-Lam-Alif.svg). The film recolors and animates it.
- The score is original and synthesized by [make_score.mjs](<make_score.mjs>). To regenerate the [audio asset](<public/narevu-score.m4a>), run `node make_score.mjs` with FFmpeg installed.
- [UI frames](<public/narevu/>) were captured from Obsidian 1.15.0 at 1600×900 with dark mode and collapsed sidebars. The Lexurgy 1.7.7 test uses `tapa` and `nari`; the open trace shows `tapa` → `taba`. The recipe evolves three filenames in a separate output folder. Remotion animates and reframes the captures rather than replacing the interface with a mockup.
