export const LEXURGY_DOCS_URL = "https://www.lexurgy.com/sc/docs";

// The official site's interactive widgets omit their rule text from the HTML.
// Read their literal props from the corresponding upstream MDX, never execute it.
const EXAMPLE_SOURCE = "https://raw.githubusercontent.com/def-gthill/lexurgy-app/0f1a80172a7c0ca1ee72696a843a51bcf8484e2c/src/pages/sc/docs";

const pages = [
  "", "/tutorial", "/tutorial/basics", "/tutorial/controlflow", "/tutorial/features",
  "/tutorial/syllables", "/cheatsheet", "/howto", "/reference",
] as const;
export type DocsPage = (typeof pages)[number];
export type DocsLocation = { page: DocsPage; anchor: string };

export function docsLocation(href: string, page: DocsPage): DocsLocation | null {
  try {
    const url = new URL(href, LEXURGY_DOCS_URL + page);
    const prefix = new URL(LEXURGY_DOCS_URL);
    if (url.origin !== prefix.origin) return null;
    const path = url.pathname.replace(/\/$/, "");
    const match = pages.find((route) => path === prefix.pathname + route);
    return match === undefined ? null : { page: match, anchor: decodeURIComponent(url.hash.slice(1)) };
  } catch {
    return null;
  }
}

interface DocsExample {
  changes: string;
  inputs: string[];
}

function readExamples(mdx: string): DocsExample[] {
  return Array.from(mdx.matchAll(/^<ScExample\b([\s\S]*?)\s*\/>/gm), ([, props]) => {
    const changes = /changes=\{\s*(["`])((?:\\[\s\S]|(?!\1)[^\\])*)\1\s*\}/.exec(props);
    const inputs = /inputs=\{(\[\s*(?:"(?:\\.|[^"\\])*"\s*(?:,\s*)?)*)\]\}/.exec(props);
    if (!changes || !inputs) throw new Error("Unrecognized Lexurgy example format");
    const [, quote, text] = changes;
    // Convert a template literal to a JSON string without interpolation.
    const literal = quote === '"' ? `"${text}"` : `"${text.replace(
      /\\[\s\S]|["\n\r\t]/g,
      (token) => token === "\\`" || token === "\\$" ? token[1]
        : token.startsWith("\\") ? token : JSON.stringify(token).slice(1, -1)
    )}"`;
    return {
      changes: JSON.parse(literal),
      inputs: JSON.parse(`${inputs[1].replace(/,\s*$/, "")}]`),
    };
  });
}

function renderExample(doc: Document, example: DocsExample): HTMLElement {
  const block = doc.createElement("div");
  block.className = "langscape-docs-example";
  for (const [label, text] of [["Sound changes", example.changes], ["Input words", example.inputs.join("\n")]]) {
    const title = block.appendChild(doc.createElement("strong"));
    title.textContent = label;
    const code = block.appendChild(doc.createElement("pre")).appendChild(doc.createElement("code"));
    code.textContent = text;
  }
  return block;
}

const contentTags = new Set([
  "A", "BLOCKQUOTE", "BR", "CODE", "DIV", "EM", "H1", "H2", "H3", "H4", "H5", "H6",
  "HR", "I", "LI", "OL", "P", "PRE", "SPAN", "STRONG", "TABLE", "TBODY", "TD", "TH", "THEAD", "TR", "UL",
]);

/** Extract the article and rebuild only passive content, with no upstream scripts, styles or embeds. */
export async function loadDocsArticle(
  doc: Document,
  page: DocsPage,
  read: (url: string) => Promise<string>,
): Promise<DocumentFragment> {
  const url = LEXURGY_DOCS_URL + page;
  const template = doc.createElement("template");
  template.innerHTML = await read(url);
  const article = template.content.querySelector("main.md-main");
  if (!article?.querySelector("h1")) throw new Error("The official manual did not return an article.");

  const cards = Array.from(article.querySelectorAll("div.card"));
  let examples: DocsExample[] = [];
  if (cards.length) {
    try {
      const source = await read(`${EXAMPLE_SOURCE}${page}.mdx`);
      const parsed = readExamples(source);
      if (parsed.length === cards.length) examples = parsed;
    } catch {
      // The article is still useful when the matching source is unavailable.
    }
  }

  const fragment = doc.createDocumentFragment();
  let exampleIndex = 0;
  const append = (node: Node, parent: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(doc.createTextNode(node.textContent ?? ""));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const source = node as HTMLElement;
    if (!contentTags.has(source.tagName)) return;
    if (source.matches("div.card")) {
      const example = examples[exampleIndex++];
      if (example) parent.appendChild(renderExample(doc, example));
      else if (exampleIndex === 1) {
        const note = doc.createElement("p");
        note.textContent = "Examples are unavailable in this tab. ";
        const link = note.appendChild(doc.createElement("a"));
        link.textContent = "View the interactive examples online";
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        // Keep this on the official site, not in the current article again.
        link.dataset.lexurgyExternal = "true";
        parent.appendChild(note);
      }
      return;
    }
    const dest = doc.createElement(source.tagName.toLowerCase());
    if (/^H[1-6]$/.test(source.tagName) && source.id) dest.dataset.lexurgyAnchor = source.id;
    const href = source.getAttribute("href");
    if (source.tagName === "A" && href) {
      try {
        const link = new URL(href, url);
        if (["https:", "http:"].includes(link.protocol)) {
          dest.setAttribute("href", link.href);
          dest.setAttribute("target", "_blank");
          dest.setAttribute("rel", "noopener noreferrer");
        }
      } catch {
        // Keep link text even when the destination is invalid.
      }
    }
    for (const child of Array.from(source.childNodes)) append(child, dest);
    parent.appendChild(dest);
  };
  for (const child of Array.from(article.childNodes)) append(child, fragment);
  return fragment;
}
