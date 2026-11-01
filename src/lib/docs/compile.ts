import { blockText, type Block } from "./model";

/** The subset of a Docs `documents.get` response used to find the insertion point. */
export interface DocSnapshot {
  documentId: string;
  title?: string;
  revisionId?: string;
  body?: {
    content?: Array<{
      startIndex?: number;
      endIndex?: number;
      paragraph?: { elements?: Array<{ textRun?: { content?: string } }> };
    }>;
  };
}

export type InsertPosition = "end" | "start";

export interface Insertion {
  index: number;
  prefixNewline: boolean;
  suffixNewline: boolean;
  /** The target already has content, so inserted text would inherit neighbouring styles. */
  resetStyles: boolean;
}

export function planInsertion(doc: DocSnapshot, position: InsertPosition): Insertion {
  const content = doc.body?.content ?? [];
  const last = content[content.length - 1];
  const endIndex = last?.endIndex ?? 2;
  const isEmpty = endIndex <= 2;
  if (position === "start") {
    return { index: 1, prefixNewline: false, suffixNewline: !isEmpty, resetStyles: !isEmpty };
  }
  const lastText = last?.paragraph?.elements?.map((e) => e.textRun?.content ?? "").join("") ?? "";
  const endsWithEmptyParagraph = Boolean(last?.paragraph) && lastText === "\n";
  return {
    index: endIndex - 1, // the final newline of a document can never be written past
    prefixNewline: !endsWithEmptyParagraph,
    suffixNewline: false,
    resetStyles: !isEmpty,
  };
}

const HEADING: Record<string, string> = {
  normal: "NORMAL_TEXT",
  h1: "HEADING_1",
  h2: "HEADING_2",
  h3: "HEADING_3",
  h4: "HEADING_4",
  h5: "HEADING_5",
  h6: "HEADING_6",
};
const ALIGNMENT = { center: "CENTER", right: "END", justify: "JUSTIFIED" } as const;
const RESET_TEXT_FIELDS =
  "bold,italic,underline,strikethrough,smallCaps,baselineOffset,link,weightedFontFamily,fontSize,foregroundColor,backgroundColor";
const RESET_PARAGRAPH_FIELDS =
  "namedStyleType,alignment,indentStart,indentFirstLine,indentEnd,lineSpacing,spaceAbove,spaceBelow";

export type DocsRequest = Record<string, unknown>;

/**
 * Compiles blocks into one Docs batchUpdate. Docs applies a batch atomically, so a
 * failure never leaves half an essay behind.
 *
 * Order matters: createParagraphBullets removes the leading tabs that express
 * nesting, which shifts later indexes. Text and paragraph styles therefore run
 * first, and bullets run from the end of the document to the start.
 */
export function compileRequests(blocks: Block[], at: Insertion): DocsRequest[] {
  const start = at.index + (at.prefixNewline ? 1 : 0);
  const styleRequests: DocsRequest[] = [];
  const listGroups: Array<{ start: number; end: number; ordered: boolean }> = [];
  const lines: string[] = [];
  let cursor = start;
  let group: { start: number; end: number; ordered: boolean } | null = null;

  for (const block of blocks) {
    const tabs = block.list ? "\t".repeat(block.list.level) : "";
    const paragraphStart = cursor;
    let spanCursor = paragraphStart + tabs.length;
    const paragraphEnd = spanCursor + blockText(block).length + 1; // includes its newline
    lines.push(tabs + blockText(block));

    const paragraphStyle: Record<string, unknown> = {};
    const paragraphFields: string[] = [];
    if (block.style !== "normal") {
      paragraphStyle.namedStyleType = HEADING[block.style];
      paragraphFields.push("namedStyleType");
    }
    if (block.align) {
      paragraphStyle.alignment = ALIGNMENT[block.align];
      paragraphFields.push("alignment");
    }
    if (block.quote) {
      paragraphStyle.indentStart = { magnitude: 36, unit: "PT" };
      paragraphStyle.indentFirstLine = { magnitude: 36, unit: "PT" };
      paragraphFields.push("indentStart", "indentFirstLine");
    }
    if (paragraphFields.length) {
      styleRequests.push({
        updateParagraphStyle: {
          range: { startIndex: paragraphStart, endIndex: paragraphEnd },
          paragraphStyle,
          fields: paragraphFields.join(","),
        },
      });
    }

    for (const span of block.spans) {
      const spanEnd = spanCursor + span.text.length;
      const textStyle: Record<string, unknown> = {};
      const fields: string[] = [];
      if (span.bold) { textStyle.bold = true; fields.push("bold"); }
      if (span.italic) { textStyle.italic = true; fields.push("italic"); }
      if (span.underline) { textStyle.underline = true; fields.push("underline"); }
      if (span.strike) { textStyle.strikethrough = true; fields.push("strikethrough"); }
      if (span.code || block.code) {
        textStyle.weightedFontFamily = { family: "Courier New" };
        fields.push("weightedFontFamily");
      }
      if (span.link) { textStyle.link = { url: span.link }; fields.push("link"); }
      if (fields.length) {
        styleRequests.push({
          updateTextStyle: {
            range: { startIndex: spanCursor, endIndex: spanEnd },
            textStyle,
            fields: fields.join(","),
          },
        });
      }
      spanCursor = spanEnd;
    }

    if (block.list) {
      // A new top-level list type starts a new group; nested items share the top level's preset.
      if (group && (block.list.level > 0 || group.ordered === block.list.ordered)) {
        group.end = paragraphEnd;
      } else {
        group = { start: paragraphStart, end: paragraphEnd, ordered: block.list.ordered };
        listGroups.push(group);
      }
    } else {
      group = null;
    }
    cursor = paragraphEnd;
  }

  const text = lines.join("\n");
  const requests: DocsRequest[] = [
    {
      insertText: {
        location: { index: at.index },
        text: (at.prefixNewline ? "\n" : "") + text + (at.suffixNewline ? "\n" : ""),
      },
    },
  ];

  if (at.resetStyles) {
    const range = { startIndex: start, endIndex: start + text.length + 1 };
    requests.push(
      { deleteParagraphBullets: { range } },
      { updateParagraphStyle: { range, paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, fields: RESET_PARAGRAPH_FIELDS } },
    );
    if (text.length) {
      requests.push({
        updateTextStyle: {
          range: { startIndex: start, endIndex: start + text.length },
          textStyle: {},
          fields: RESET_TEXT_FIELDS,
        },
      });
    }
  }

  requests.push(...styleRequests);

  for (const g of [...listGroups].reverse()) {
    requests.push({
      createParagraphBullets: {
        range: { startIndex: g.start, endIndex: g.end },
        bulletPreset: g.ordered ? "NUMBERED_DECIMAL_ALPHA_ROMAN" : "BULLET_DISC_CIRCLE_SQUARE",
      },
    });
  }
  return requests;
}
