export const NEW_LSC_TEMPLATE = `# Langscape sound-change file
# Edit this file, then use the Test bench on the right (or Mod+Enter) to
# apply the rules to some words with Lexurgy.

Feature +vowel, +consonant, +voice, +labial, +alveolar, +velar, +high, +mid, +low
Symbol a [+vowel +low]
Symbol e [+vowel +mid]
Symbol i [+vowel +high]
Symbol p [-voice +consonant +labial]
Symbol b [+voice +consonant +labial]
Symbol t [-voice +consonant +alveolar]
Symbol d [+voice +consonant +alveolar]
Symbol k [-voice +consonant +velar]
Symbol g [+voice +consonant +velar]

# Lenition: voiceless stops become voiced between vowels.
Lenition:
 p => b / [+vowel] _ [+vowel]
 t => d / [+vowel] _ [+vowel]
 k => g / [+vowel] _ [+vowel]

# Final raising.
Raising:
 e => i / _ $

# Try: apa, eke, pataka
`;

export const EXAMPLE_LSC = `# A worked example used by the Langscape demo vault.
Feature +vowel, +consonant, +voice, +labial, +alveolar, +velar, +high, +mid, +low
Symbol a [+vowel +low]
Symbol e [+vowel +mid]
Symbol i [+vowel +high]
Symbol p [-voice +consonant +labial]
Symbol b [+voice +consonant +labial]
Symbol t [-voice +consonant +alveolar]
Symbol d [+voice +consonant +alveolar]
Symbol k [-voice +consonant +velar]
Symbol g [+voice +consonant +velar]

Lenition:
 p => b / [+vowel] _ [+vowel]
 t => d / [+vowel] _ [+vowel]
 k => g / [+vowel] _ [+vowel]

Vowel-Shift:
 a => e
 e => i / _ $

Final-Devoicing:
 b => p / _ $
 d => t / _ $
 g => k / _ $
`;
