import { html, parse, type DefaultTreeAdapterTypes } from "parse5";

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
    const rules = JSON.parse(literal) as unknown;
    const words = JSON.parse(`${inputs[1].replace(/,\s*$/, "")}]`) as unknown;
    if (typeof rules !== "string" || !Array.isArray(words) || !words.every((word): word is string => typeof word === "string")) {
      throw new Error("Expected literal rules and input words");
    }
    return { changes: rules, inputs: words };
  });
}

function renderExample(parent: DocumentFragment | HTMLElement, example: DocsExample): void {
  const block = parent.createDiv({ cls: "langscape-docs-example" });
  for (const [label, text] of [["Sound changes", example.changes], ["Input words", example.inputs.join("\n")]]) {
    block.createEl("strong", { text: label });
    block.createEl("pre").createEl("code", { text });
  }
}

const contentTagList = [
  "a", "blockquote", "br", "code", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "i", "li", "ol", "p", "pre", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul",
] as const;
type ContentTag = (typeof contentTagList)[number];
const contentTags = new Set<string>(contentTagList);

function isContentTag(tag: string): tag is ContentTag {
  return contentTags.has(tag);
}

type ParsedNode = DefaultTreeAdapterTypes.Node;
type ParsedElement = DefaultTreeAdapterTypes.Element;

const attr = (node: ParsedElement, key: string) => node.attrs.find(({ name }) => name === key)?.value;
const hasClass = (node: ParsedElement, name: string) => (attr(node, "class") ?? "").split(/\s+/).includes(name);
const isCard = (node: ParsedElement) => node.tagName === "div" && hasClass(node, "card");

function* elements(start: ParsedNode): Generator<ParsedElement> {
  const pending: ParsedNode[] = [start];
  while (pending.length) {
    const node = pending.pop();
    if (!node) break;
    if ("tagName" in node && node.namespaceURI === html.NS.HTML) yield node;
    if ("childNodes" in node) {
      for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
    }
  }
}

/** Extract the article and rebuild only passive content, with no upstream scripts, styles or embeds. */
export async function loadDocsArticle(
  _doc: Document,
  page: DocsPage,
  read: (url: string) => Promise<string>,
): Promise<DocumentFragment> {
  const url = LEXURGY_DOCS_URL + page;
  // Parse to a data tree: embedded browsers must never see the upstream HTML.
  const article = Array.from(elements(parse(await read(url)))).find((node) => node.tagName === "main" && hasClass(node, "md-main"));
  if (!article || !Array.from(elements(article)).some((node) => node.tagName === "h1")) {
    throw new Error("The official manual did not return an article.");
  }
  const cards = Array.from(elements(article)).filter(isCard);
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

  const fragment = createFragment();
  let exampleIndex = 0;
  const append = (source: ParsedNode, parent: DocumentFragment | HTMLElement): void => {
    if ("value" in source && source.nodeName === "#text") {
      parent.appendText(source.value);
      return;
    }
    if (!("tagName" in source) || source.namespaceURI !== html.NS.HTML || !isContentTag(source.tagName)) return;
    if (isCard(source)) {
      const example = examples[exampleIndex++];
      if (example) renderExample(parent, example);
      else if (exampleIndex === 1) {
        const note = parent.createEl("p", { text: "Examples are unavailable in this tab. " });
        const link = note.createEl("a", {
          text: "View the interactive examples online",
          href: url,
          attr: { target: "_blank", rel: "noopener noreferrer" },
        });
        // Keep this on the official site, not in the current article again.
        link.dataset.lexurgyExternal = "true";
      }
      return;
    }
    const dest = parent.createEl(source.tagName);
    const id = attr(source, "id");
    if (/^h[1-6]$/.test(source.tagName) && id) dest.dataset.lexurgyAnchor = id;
    const href = attr(source, "href");
    if (source.tagName === "a" && href) {
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
  };
  for (const child of Array.from(article.childNodes)) append(child, fragment);
  return fragment;
}
