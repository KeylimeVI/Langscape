# Langscape 1.0 trailer

A roughly 41-second 1920×1080 trailer. The build produces a silent master so audio can be added separately. It uses actual Obsidian captures from disposable vaults with a darker neutral palette. Cursor ripples and camera moves are added in Remotion; the live-writing scene shows font rendering, not automatic transliteration.

## Render

From this directory:

```bash
npm ci
npm run render
npx remotion still src/index.ts LangscapeTrailer out/poster.jpg --frame=1215 --image-format=jpeg
```

The render is `out/langscape-trailer.mp4`. The published copies are the [trailer](<../docs/video/langscape-trailer.mp4>) and [poster](<../docs/video/langscape-trailer-poster.jpg>).

## Quenya reference

Quenya and Tengwar were devised by J.R.R. Tolkien. This is an independent software demonstration, not affiliated with or endorsed by Tolkien rights holders. The demo uses isolated linguistic forms and original charts, not book passages, artwork, film material, or franchise branding.

- [Quenya phonology](https://eldamo.org/content/phonetic-indexes/phonetics-q.html) and [Måns Björkman’s Classical Tengwar guide](https://at.boktypografen.se/teng_quenya.htm#vowels): broad IPA and the vowel marks shown alone on short carriers.
- The Lexurgy and recipe scenes use attested Quenya etymologies: [*glawarē* → *laurë*](https://mail.eldamo.org/content/words/word-2232975397.html), [*kēwā* → *céva*](https://eldamo.org/content/words/word-4272116095.html), and [*wendē* → *vendë*](https://mail.eldamo.org/content/words/word-2141848907.html). The example rules simplify intermediate developments and apply modern romanization.
- [*Elen síla*](https://mail.eldamo.org/content/words/word-2448984617.html) (“A star shines”) is the opening clause of the greeting to Gildor, written in Classical Tengwar in the live editor.
- The syntax tree uses the attested sentence [*nai elen siluva lyenna*](https://www.eldamo.org/content/words/word-3244354083.html?neo) (“May a star shine upon you”), with each word in Classical Tengwar. `OPT` is the optative particle and `NP-ALL` marks the noun phrase in the allative case.

## Visual credits

- Tengwar glyphs use [Alcarin Tengwar](https://github.com/Tosche/Alcarin-Tengwar) by Toshi Omagari, SIL Open Font License 1.1.
- Trailer typography uses [Inter](https://github.com/rsms/inter), with its [SIL Open Font License](<public/Inter-OFL.txt>).
- The lām–alif mark uses the supplied [SVG](<public/lam-alif.svg>) by Юкатан, [marked public domain on Wikimedia Commons](https://commons.wikimedia.org/wiki/File:23a-Lam-Alif.svg). The film recolors it and places it on a solid circle.
- The opening uses the unmodified white symbol from [Obsidian’s official monochrome lockup](https://obsidian.md/brand). Obsidian is a trademark of its owner.
