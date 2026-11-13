# Langscape trailer

25-second, 1920×1080 motion trailer built with [Remotion](https://www.remotion.dev/).

## Render

```bash
npm install
npm run render
```

The output is `out/langscape-trailer.mp4`. A poster can be rendered with:

```bash
npx remotion still src/index.ts LangscapeTrailer out/poster.png --frame=70
```

The soundtrack in `public/trailer-music.wav` is generated from `make_audio.py`.
