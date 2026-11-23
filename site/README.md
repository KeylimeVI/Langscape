# Langscape website

The site is plain HTML and CSS with a small local script for the feature deck. Its build copies four muted clips cut from the trailer, their static posters, and the bundled fonts. The output is self-contained and doesn't use analytics or a hosted font service.

## Preview

With Node.js 22 or newer, from the repository root:

```sh
npm run build:site
npx serve site-dist
```

Open the URL printed by the preview server. Do not serve or upload the entire repository; publish only the contents of `site-dist/`.

## Deploy to GitHub Pages

1. Push the site source and the [Pages workflow](<../.github/workflows/pages.yml>) to `main` in the Langscape repository.
2. In **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**.
3. Go to **Actions → Deploy website → Run workflow**, select `main`, and run it. The job shows the deployed URL (normally `https://keylimevi.github.io/Langscape/`). Run the workflow again after pushing site updates.

All site links use relative paths so the same build works under `/Langscape/` and at the root of a custom domain. **Docs** lives at `/docs/` relative to the site root.
