// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { docsLocation, LEXURGY_DOCS_URL, loadDocsArticle } from "../../src/lexurgy/docs-content";

const article = (html: string) => `<main class="md-main"><h1>Lexurgy</h1>${html}</main>`;

describe("Lexurgy docs", () => {
  it("routes only known manual pages and fragments to the docs tab", () => {
    expect(docsLocation("/sc/docs/tutorial/basics#word-edges", "")).toEqual({
      page: "/tutorial/basics", anchor: "word-edges",
    });
    expect(docsLocation("#name%20here", "/reference")).toEqual({ page: "/reference", anchor: "name here" });
    expect(docsLocation(LEXURGY_DOCS_URL, "/reference")).toEqual({ page: "", anchor: "" });
    expect(docsLocation("/sc", "")).toBeNull();
    expect(docsLocation("https://example.org/sc/docs/reference", "")).toBeNull();
    expect(docsLocation("#%bad", "")).toBeNull();
  });

  it("keeps only passive article content and safe links", async () => {
    const fragment = await loadDocsArticle(document, "/reference", async () =>
      `<header>Outside the article</header>${article(`
        <nav>Site navigation</nav><script>Don't run</script>
        <h2 id="basics" class="upstream" onclick="bad()">Basics</h2>
        <p><a href="#basics">Basics</a> <a href="javascript:bad()">Unsafe</a></p>
        <table style="color: red"><tr><td><code>&lt;syl&gt;</code></td></tr></table>
        <iframe src="https://example.org"></iframe><img src="https://example.org/track">
      `)}`,
    );
    expect(fragment.textContent).not.toMatch(/Outside the article|Site navigation|Don't run/);
    expect(fragment.querySelectorAll("script, iframe, img, [class], [onclick], [style]")).toHaveLength(0);
    expect(fragment.querySelector("h2")?.dataset.lexurgyAnchor).toBe("basics");
    expect(fragment.querySelector("td code")?.textContent).toBe("<syl>");
    expect(Array.from(fragment.querySelectorAll("a"), (link) => link.getAttribute("href")))
      .toEqual([`${LEXURGY_DOCS_URL}/reference#basics`, null]);
  });

  it("replaces interactive widgets with literal rules and example inputs", async () => {
    const read = vi.fn(async (url: string) => url.endsWith(".mdx") ? [
      'import ScExample from "upstream";',
      '<ScExample changes={"rule:\\n  x => y"} inputs={["xa", "ax"]} />',
      '<ScExample',
      '  changes={`class foo {a, b}',
      'rule:',
      '  @foo => "x"`}',
      '  inputs={["a,]", "b",]}',
      '/>',
    ].join("\n") : article('<div class="card"><textarea></textarea></div><div class="card"></div>'));
    const fragment = await loadDocsArticle(document, "/tutorial/basics", read);
    expect(read).toHaveBeenCalledTimes(2);
    expect(fragment.querySelector("textarea")).toBeNull();
    expect(Array.from(fragment.querySelectorAll("pre code"), (code) => code.textContent)).toEqual([
      "rule:\n  x => y", "xa\nax", 'class foo {a, b}\nrule:\n  @foo => "x"', "a,]\nb",
    ]);
  });

  it("keeps the article readable when examples are unavailable", async () => {
    const fragment = await loadDocsArticle(document, "/howto", async (url) => {
      if (url.endsWith(".mdx")) throw new Error("Unavailable");
      return article('<p>Guide text</p><div class="card"><button>Run</button></div><div class="card"></div>');
    });
    expect(fragment.querySelector("p")?.textContent).toBe("Guide text");
    expect(fragment.querySelector("button")).toBeNull();
    const fallbacks = fragment.querySelectorAll("a[data-lexurgy-external]");
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0].getAttribute("href")).toBe(`${LEXURGY_DOCS_URL}/howto`);
    await expect(loadDocsArticle(document, "", async () => "<h1>Not the manual</h1>"))
      .rejects.toThrow("did not return an article");
  });
});
