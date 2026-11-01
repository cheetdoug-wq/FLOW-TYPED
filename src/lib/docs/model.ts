/** Document model shared by the browser editor and the server-side Docs compiler. */

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: string;
}

export type BlockStyle = "normal" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
export type Align = "center" | "right" | "justify";

export interface Block {
  style: BlockStyle;
  align?: Align;
  list?: { ordered: boolean; level: number };
  quote?: boolean;
  code?: boolean;
  spans: Span[];
}

export const MAX_CHARS = 1_000_000;
export const MAX_BLOCKS = 50_000;
const MAX_LIST_LEVEL = 8;
const STYLES = new Set<string>(["normal", "h1", "h2", "h3", "h4", "h5", "h6"]);
const ALIGNS = new Set<string>(["center", "right", "justify"]);

export class ContentError extends Error {}

export function blockText(block: Block): string {
  return block.spans.map((s) => s.text).join("");
}

export function plainText(blocks: Block[]): string {
  return blocks.map(blockText).join("\n");
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

/** Counts user-perceived characters so an emoji counts as one, without line breaks between paragraphs. */
export function countCharacters(text: string): number {
  let n = 0;
  for (const ch of text) if (ch !== "\n" && ch !== "\u000b") n += 1;
  return n;
}

export function isSafeLink(url: string): boolean {
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * The Docs API silently strips these characters from insertText, which would
 * shift every index computed after them, so they are removed up front.
 * https://developers.google.com/docs/api/reference/rest/v1/documents/request#inserttextrequest
 */
export function sanitizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "\u000b") // inside a paragraph, a line break is a Docs soft break
    .replace(/[\u0000-\u0008\u000c-\u001f-]/g, "")
    .replace(/\p{Surrogate}/gu, "�");
}

/** Validates untrusted JSON from the client and returns clean blocks. */
export function normalizeBlocks(input: unknown): Block[] {
  if (!Array.isArray(input)) throw new ContentError("The document content is invalid.");
  if (input.length > MAX_BLOCKS) throw new ContentError("This text has too many paragraphs to send at once.");

  const blocks: Block[] = input.map((raw): Block => {
    const b = (raw ?? {}) as Record<string, unknown>;
    const block: Block = {
      style: typeof b.style === "string" && STYLES.has(b.style) ? (b.style as BlockStyle) : "normal",
      spans: [],
    };
    if (typeof b.align === "string" && ALIGNS.has(b.align)) block.align = b.align as Align;
    if (b.quote === true) block.quote = true;
    if (b.code === true) block.code = true;
    const list = b.list as { ordered?: unknown; level?: unknown } | undefined;
    if (list && typeof list === "object") {
      const level = Number.isInteger(list.level) ? (list.level as number) : 0;
      block.list = { ordered: list.ordered === true, level: Math.min(Math.max(level, 0), MAX_LIST_LEVEL) };
    }
    for (const rawSpan of Array.isArray(b.spans) ? b.spans : []) {
      const s = (rawSpan ?? {}) as Record<string, unknown>;
      if (typeof s.text !== "string") continue;
      const text = sanitizeText(s.text);
      if (!text) continue;
      const span: Span = { text };
      if (s.bold === true) span.bold = true;
      if (s.italic === true) span.italic = true;
      if (s.underline === true) span.underline = true;
      if (s.strike === true) span.strike = true;
      if (s.code === true) span.code = true;
      if (typeof s.link === "string" && isSafeLink(s.link)) span.link = s.link;
      block.spans.push(span);
    }
    // Leading tabs on a list item would be read by Docs as extra nesting levels.
    if (block.list && block.spans[0]) {
      block.spans[0].text = block.spans[0].text.replace(/^\t+/, "");
      if (!block.spans[0].text) block.spans.shift();
    }
    return block;
  });

  while (blocks.length && !blockText(blocks[blocks.length - 1]!).trim()) blocks.pop();
  while (blocks.length && !blockText(blocks[0]!).trim()) blocks.shift();

  if (!blocks.length) throw new ContentError("Add some text before sending.");
  if (plainText(blocks).length > MAX_CHARS) {
    throw new ContentError(`This text is over the ${MAX_CHARS.toLocaleString("en-US")} character limit.`);
  }
  return blocks;
}
