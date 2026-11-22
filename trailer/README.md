# Langscape 1.0 trailer

A 34-second, 1920×1080 trailer that follows a small Quenya vault from phonology and script to sound changes, the lexicon, and grammar. The UI is real Obsidian footage from a disposable dark-theme vault, not a mockup or a recording of a personal vault.

## Render

From this directory:

```bash
npm ci
npm run render
npx remotion still src/index.ts LangscapeTrailer out/poster.jpg --frame=1005 --image-format=jpeg
```

The render is `out/langscape-trailer.mp4`. The published copies are the [trailer](<../docs/video/langscape-trailer.mp4>) and [poster](<../docs/video/langscape-trailer-poster.jpg>).

## Quenya reference

Quenya and Tengwar were devised by J.R.R. Tolkien. This is an independent software demonstration, not affiliated with or endorsed by Tolkien rights holders. The demo uses isolated linguistic forms and original charts, not book passages, artwork, film material, or franchise branding.

- [Quenya phonology](https://eldamo.org/content/phonetic-indexes/phonetics-q.html) and [Måns Björkman’s Classical Tengwar guide](https://at.boktypografen.se/teng_quenya.htm#vowels): broad IPA and the vowel marks shown alone on short and long carriers.
- [Eldamo’s index of initial *ñ* → *n*](https://eldamo.org/content/words/word-1073266651.html), citing Appendix E and Tolkien’s phonology notes: the Lexurgy example models a historical change in pronunciation, not a spelling reform or a change in every dialect.
- [*alda* ‘tree’](https://eldamo.org/content/words/word-539805327.html) and [Heinrich Heine University’s Quenya morphology handout](https://www.ling.hhu.de/fileadmin/redaktion/Oeffentliche_Medien/Fakultaeten/Philosophische_Fakultaet/Sprache_und_Information/Allgemeine_Sprachwissenschaft/Dateien/Praesentation_Tag_3.pdf): noun declension examples.

## Music credit

“John Stockton Slow Drag” by [Chris Zabriskie](https://chriszabriskie.com/), from [*Undercover Vampire Policeman*](https://chriszabriskie.com/uvp/) (© 2012 Chris Zabriskie), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The trailer uses the 03:22.00–03:56.10 excerpt, with level adjustment and fades. Include this credit when reposting the trailer.

## Visual credits

- Tengwar glyphs use [Alcarin Tengwar](https://github.com/Tosche/Alcarin-Tengwar) by Toshi Omagari, SIL Open Font License 1.1.
- Trailer typography uses [Inter](https://github.com/rsms/inter), with its [SIL Open Font License](<public/Inter-OFL.txt>).
- The lām–alif mark uses the supplied [SVG](<../docs/23a-Lam-Alif.svg>) by Юкатан, [marked public domain on Wikimedia Commons](https://commons.wikimedia.org/wiki/File:23a-Lam-Alif.svg). The film recolors it and places it on a solid circle.
