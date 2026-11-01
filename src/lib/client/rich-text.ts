import { isSafeLink, type Align, type Block, type BlockStyle, type Span } from "../docs/model";

type Marks = Omit<Span, "text">;

const BLOCK_TAGS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "HR", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "ASIDE", "NAV", "FIGURE", "FIGCAPTION", "ADDRESS", "DL", "DT", "DD"]);
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "META", "LINK", "TITLE", "HEAD", "TEMPLATE", "NOSCRIPT", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "IMG", "VIDEO", "AUDIO", "CANVAS", "O:P"]);
const HEADINGS: Record<string, BlockStyle> = { H1: "h1", H2: "h2", H3: "h3", H4: "h4", H5: "h5", H6: "h6" };

function marksFor(el: HTMLElement, m: Marks): Marks {
  const next = { ...m };
  const tag = el.tagName;
  const weight = el.style?.fontWeight;
  if (tag === "B" || tag === "STRONG") next.bold = true;
  // Google Docs wraps entire pastes in <b style="font-weight:normal">, so inline style wins over the tag.
  if (weight) next.bold = weight === "bold" || weight === "bolder" || Number(weight) >= 600;
  if (tag === "I" || tag === "EM") next.italic = true;
  if (el.style?.fontStyle) next.italic = el.style.fontStyle === "italic";
  if (tag === "U" || tag === "INS") next.underline = true;
  if (tag === "S" || tag === "STRIKE" || tag === "DEL") next.strike = true;
  const decoration = `${el.style?.textDecorationLine ?? ""} ${el.style?.textDecoration ?? ""}`;
  if (decoration.includes("underline")) next.underline = true;
  if (decoration.includes("line-through")) next.strike = true;
  if (tag === "CODE" || tag === "KBD" || tag === "SAMP") next.code = true;
  if (tag === "A") {
    const href = el.getAttribute("href");
    if (href && isSafeLink(href)) {
      next.link = href;
      // Links arrive underlined by the document's stylesheet; only keep an explicit underline.
    }
  }
  for (const k of ["bold", "italic"] as const) if (!next[k]) delete next[k];
  return next;
}

function alignOf(el: HTMLElement): Align | undefined {
  const a = (el.style?.textAlign || el.getAttribute("align") || "").toLowerCase();
  if (a === "center") return "center";
  if (a === "right" || a === "end") return "right";
  if (a === "justify") return "justify";
  return undefined;
}

interface Ctx {
  list?: { ordered: boolean; level: number };
  quote?: boolean;
  code?: boolean;
  align?: Align;
  style: BlockStyle;
}

function sameMarks(a: Span, b: Marks): boolean {
  const { text: _text, ...am } = a;
  return JSON.stringify(Object.entries(am).sort()) === JSON.stringify(Object.entries(b).sort());
}

/** Reads a DOM tree (the editor, or a pasted fragment) into blocks. Anything unrecognised is reduced to its text. */
export function domToBlocks(root: Node): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;

  const flush = () => {
    if (!current) return;
    const last = current.spans[current.spans.length - 1];
    if (last && !current.code) last.text = last.text.replace(/[ \n]+$/, "");
    current.spans = current.spans.filter((s) => s.text);
    if (current.spans.length || current.list) blocks.push(current);
    current = null;
  };

  const open = (ctx: Ctx): Block => {
    if (!current) {
      current = { style: ctx.style, spans: [] };
      if (ctx.list) current.list = ctx.list;
      if (ctx.quote) current.quote = true;
      if (ctx.code) current.code = true;
      if (ctx.align) current.align = ctx.align;
    }
    return current;
  };

  const addText = (text: string, marks: Marks, ctx: Ctx) => {
    let t = text;
    if (!ctx.code) {
      t = t.replace(/[ \t\r\n\f]+/g, " ");
      const prior = current?.spans[current.spans.length - 1]?.text;
      if (!current || !current.spans.length || prior?.endsWith(" ") || prior?.endsWith("\n")) t = t.replace(/^ /, "");
      if (!t) return;
    }
    const block = open(ctx);
    const last = block.spans[block.spans.length - 1];
    if (last && sameMarks(last, marks)) last.text += t;
    else block.spans.push({ text: t, ...marks });
  };

  const walk = (node: Node, marks: Marks, ctx: Ctx) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        const value = child.nodeValue ?? "";
        if (ctx.code) {
          value.split(/\r?\n/).forEach((line, i) => {
            if (i > 0) { const b = open(ctx); flushKeepEmpty(b); }
            if (line) addText(line, marks, ctx);
          });
        } else {
          addText(value.replace(/ /g, " "), marks, ctx);
        }
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as HTMLElement;
      const tag = el.tagName.toUpperCase();
      if (SKIP_TAGS.has(tag)) continue;
      if (tag === "BR") {
        if (current && current.spans.length) { pendingBreak(marks, ctx, el); }
        continue;
      }
      if (!BLOCK_TAGS.has(tag)) {
        walk(el, marksFor(el, marks), ctx);
        continue;
      }
      flush();
      if (tag === "HR") {
        blocks.push({ style: "normal", align: "center", spans: [{ text: "* * *" }] });
        continue;
      }
      const inner: Ctx = { ...ctx };
      inner.align = alignOf(el) ?? ctx.align;
      if (HEADINGS[tag]) inner.style = HEADINGS[tag]!;
      if (tag === "UL" || tag === "OL") {
        inner.list = { ordered: tag === "OL", level: ctx.list ? ctx.list.level + 1 : 0 };
      }
      if (tag === "BLOCKQUOTE") inner.quote = true;
      if (tag === "PRE") inner.code = true;
      const count = blocks.length;
      walk(el, marksFor(el, marks), inner);
      flush();
      // A <p><br></p> the person left on purpose stays as a blank paragraph.
      if (blocks.length === count && (tag === "P" || tag === "DIV") && el.querySelector("br") && !el.querySelector("p,div")) {
        blocks.push({ style: "normal", spans: [] });
      }
    }
  };

  const flushKeepEmpty = (b: Block) => {
    current = null;
    blocks.push(b);
  };

  const pendingBreak = (marks: Marks, ctx: Ctx, el: HTMLElement) => {
    // A trailing <br> in a block only keeps the caret visible; it isn't a line break.
    let next: Node | null = el.nextSibling;
    while (next && next.nodeType === 3 && !next.nodeValue?.trim()) next = next.nextSibling;
    if (!next) return;
    addBreak(marks, ctx);
  };

  const addBreak = (marks: Marks, ctx: Ctx) => {
    const block = open(ctx);
    const last = block.spans[block.spans.length - 1];
    if (last) last.text = last.text.replace(/ $/, "") + "\n";
    else block.spans.push({ text: "\n", ...marks });
  };

  walk(root, {}, { style: "normal" });
  flush();
  return blocks;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function spanHtml(s: Span): string {
  let h = esc(s.text).replace(/\n/g, "<br>");
  if (s.code) h = `<code>${h}</code>`;
  if (s.bold) h = `<strong>${h}</strong>`;
  if (s.italic) h = `<em>${h}</em>`;
  if (s.underline) h = `<u>${h}</u>`;
  if (s.strike) h = `<s>${h}</s>`;
  if (s.link && isSafeLink(s.link)) h = `<a href="${esc(s.link)}" rel="noopener noreferrer" target="_blank">${h}</a>`;
  return h;
}

/** Produces clean editor HTML. Pasted content only reaches the page through this function. */
export function blocksToHtml(blocks: Block[]): string {
  let html = "";
  const open: Array<{ tag: string; level: number }> = [];
  const closeTo = (level: number) => {
    while (open.length && open[open.length - 1]!.level > level) html += `</li></${open.pop()!.tag}>`;
  };
  blocks.forEach((b) => {
    const inner = b.spans.map(spanHtml).join("");
    const align = b.align ? ` style="text-align:${b.align}"` : "";
    if (b.list) {
      const { level, ordered } = b.list;
      const tag = ordered ? "ol" : "ul";
      closeTo(level);
      const top = open[open.length - 1];
      if (top && top.level === level && top.tag !== tag) closeTo(level - 1);
      const now = open[open.length - 1];
      if (now && now.level === level) html += `</li><li${align}>${inner || "<br>"}`;
      else {
        html += `<${tag}><li${align}>${inner || "<br>"}`;
        open.push({ tag, level });
      }
      return;
    }
    closeTo(-1);
    const body = inner || "<br>";
    if (b.code) html += `<pre><code>${body}</code></pre>`;
    else if (b.quote) html += `<blockquote${align}>${body}</blockquote>`;
    else if (b.style !== "normal") html += `<${b.style}${align}>${body}</${b.style}>`;
    else html += `<p${align}>${body}</p>`;
  });
  closeTo(-1);
  return html;
}

export function pasteToHtml(html: string | null, text: string): string {
  if (html && html.trim()) {
    const doc = new DOMParser().parseFromString(html, "text/html"); // inert: no scripts run and nothing loads
    const blocks = domToBlocks(doc.body);
    if (blocks.length) return blocksToHtml(blocks);
  }
  return blocksToHtml(textToBlocks(text));
}

/** Blank lines separate paragraphs. With none at all, each line is its own paragraph. */
export function textToBlocks(text: string): Block[] {
  const t = text.replace(/\r\n?/g, "\n").trim();
  if (!t) return [];
  const usesBlankLines = /\n[ \t]*\n/.test(t);
  const parts = usesBlankLines ? t.split(/\n[ \t]*\n[\s]*/) : t.split("\n");
  return parts.map((p) => ({ style: "normal" as const, spans: p ? [{ text: p }] : [] }));
}
