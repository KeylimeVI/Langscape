# Narevu Script

Narevu is a fictional test language made for the Langscape trailer. The names, vocabulary, and glyph outlines were drawn up for this demonstration; the geometric alphabet was not traced from, or modeled on, an existing script.

| Romanization | Trailer gloss |
| --- | --- |
| `tapa` (earlier form) | reed |
| `taba` (later form) | reed |
| `narevu` | river speech; the name of the language |

In the trailer, `tapa` becomes `taba` when `p` voices to `b` between vowels. The two sounds have distinct signs: `p` has an open diagonal shoulder, a descender, and a detached tile; `b` encloses a counter and rises above the other signs.

The font maps `a e i o u p b t k n r m s v l` directly to Narevu glyphs. Uppercase letters are aliases for those same glyphs. Space and no-break space are supported; other characters are left to the application's font fallback. Text remains Latin and left-to-right underneath, so `tapa taba narevu` can be typed, searched, and copied normally. This is a display alphabet, not a Unicode encoding or a complete language specification.

The original font and [generator](make_narevu.mjs) are released under the project's [MIT license](../LICENSE). Keep the project license and copyright notice with redistributed copies. Rebuild [the font](public/NarevuScript.ttf) with `node trailer/make_narevu.mjs` from the repository root; no font packages are needed.
