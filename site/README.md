# Langscape website

The site is plain HTML and CSS with a [Swiper](https://swiperjs.com/) feature deck. The official Swiper 14.4.0 bundle is served locally under the [MIT license](<vendor/swiper/LICENSE>). The build packages four muted trailer clips, their posters, and the bundled fonts, and fingerprints CSS and JavaScript so older cached assets cannot style a new page. The output doesn't use analytics or a hosted font service.

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
3. Go to **Actions → Deploy website → Run workflow**, select `main`, and run it. The job shows the deployed URL (normally `https://keylimevi.github.io/Langscape/`). After pushing updates, start a new run with **Run workflow**. **Re-run jobs** uses the old commit.

All site links use relative paths so the same build works under `/Langscape/` and at the root of a custom domain. **Docs** lives at `/docs/` relative to the site root.
