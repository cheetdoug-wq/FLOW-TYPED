import assert from "node:assert/strict";
import { test } from "node:test";
import { compileRequests, planInsertion, type DocSnapshot, type DocsRequest } from "../../src/lib/docs/compile";
import { ContentError, countCharacters, countWords, normalizeBlocks, type Block } from "../../src/lib/docs/model";
import { pkceChallenge, seal, unseal } from "../../src/lib/server/crypto";

const p = (text: string, extra: Partial<Block> = {}): Block => ({ style: "normal", spans: [{ text }], ...extra });
const NEW = { index: 1, prefixNewline: false, suffixNewline: false, resetStyles: false };

function doc(...paragraphs: string[]): DocSnapshot {
  const content: NonNullable<NonNullable<DocSnapshot["body"]>["content"]> = [{ endIndex: 1 }];
  let i = 1;
  for (const t of paragraphs) {
    content.push({ startIndex: i, endIndex: i + t.length, paragraph: { elements: [{ textRun: { content: t } }] } });
    i += t.length;
  }
  return { documentId: "x", body: { content } };
}

const find = (r: DocsRequest[], key: string) => r.filter((x) => key in x).map((x) => x[key] as any);

test("paragraphs are joined by newlines and inserted at the index", () => {
  const r = compileRequests([p("One"), p("Two")], NEW);
  assert.deepEqual(r[0], { insertText: { location: { index: 1 }, text: "One\nTwo" } });
  assert.equal(r.length, 1);
});

test("text style ranges land on the right characters, counting emoji as UTF-16 units", () => {
  const blocks: Block[] = [{ style: "normal", spans: [{ text: "😀 a " }, { text: "bold", bold: true }] }];
  const [style] = find(compileRequests(blocks, NEW), "updateTextStyle");
  assert.deepEqual(style.range, { startIndex: 6, endIndex: 10 });
  assert.equal(style.fields, "bold");
});

test("headings get a named style covering the paragraph and its newline", () => {
  const [s] = find(compileRequests([p("Title", { style: "h1" }), p("x")], NEW), "updateParagraphStyle");
  assert.equal(s.paragraphStyle.namedStyleType, "HEADING_1");
  assert.deepEqual(s.range, { startIndex: 1, endIndex: 7 });
});

test("nested lists use leading tabs, and bullets are created from the end backwards", () => {
  const r = compileRequests(
    [
      p("a", { list: { ordered: false, level: 0 } }),
      p("b", { list: { ordered: false, level: 1 }, spans: [{ text: "b", bold: true }] }),
      p("gap"),
      p("c", { list: { ordered: true, level: 0 } }),
    ],
    NEW,
  );
  assert.equal(find(r, "insertText")[0].text, "a\n\tb\ngap\nc");
  assert.deepEqual(find(r, "updateTextStyle")[0].range, { startIndex: 4, endIndex: 5 }, "style skips the tab");
  const bullets = find(r, "createParagraphBullets");
  assert.deepEqual(bullets.map((b) => b.range.startIndex), [10, 1]);
  assert.equal(bullets[0].bulletPreset, "NUMBERED_DECIMAL_ALPHA_ROMAN");
  assert.deepEqual(bullets[1].range, { startIndex: 1, endIndex: 6 });
  const order = r.map((x) => Object.keys(x)[0]);
  assert.ok(order.lastIndexOf("updateTextStyle") < order.indexOf("createParagraphBullets"));
});

test("adjacent list types get separate groups", () => {
  const r = compileRequests(
    [p("a", { list: { ordered: false, level: 0 } }), p("b", { list: { ordered: true, level: 0 } })],
    NEW,
  );
  assert.equal(find(r, "createParagraphBullets").length, 2);
});

test("an empty document is written directly with no style reset", () => {
  const at = planInsertion(doc("\n"), "end");
  assert.deepEqual(at, { index: 1, prefixNewline: false, suffixNewline: false, resetStyles: false });
  assert.deepEqual(planInsertion(doc("\n"), "start"), at);
});

test("appending starts a new paragraph and resets inherited styles only on inserted text", () => {
  const at = planInsertion(doc("Existing\n"), "end");
  assert.deepEqual(at, { index: 9, prefixNewline: true, suffixNewline: false, resetStyles: true });
  const r = compileRequests([p("New")], at);
  assert.equal(find(r, "insertText")[0].text, "\nNew");
  assert.deepEqual(find(r, "deleteParagraphBullets")[0].range, { startIndex: 10, endIndex: 14 });
  assert.deepEqual(find(r, "updateTextStyle")[0].range, { startIndex: 10, endIndex: 13 });
});

test("appending after a trailing blank paragraph reuses it", () => {
  const at = planInsertion(doc("Existing\n", "\n"), "end");
  assert.deepEqual(at, { index: 10, prefixNewline: false, suffixNewline: false, resetStyles: true });
});

test("inserting at the top keeps existing text in its own paragraph", () => {
  const at = planInsertion(doc("Existing\n"), "start");
  assert.deepEqual(at, { index: 1, prefixNewline: false, suffixNewline: true, resetStyles: true });
  const r = compileRequests([p("New")], at);
  assert.equal(find(r, "insertText")[0].text, "New\n");
  assert.deepEqual(find(r, "updateParagraphStyle")[0].range, { startIndex: 1, endIndex: 5 });
});

test("characters Docs would strip are removed before indexes are computed", () => {
  const [b] = normalizeBlocks([{ spans: [{ text: "a\u0001bc\r\nd" }] }]);
  assert.equal(b!.spans[0]!.text, "abc\u000bd");
});

test("unsafe links and unknown fields are dropped", () => {
  const [b] = normalizeBlocks([{ style: "evil", spans: [{ text: "x", link: "javascript:alert(1)", bold: "yes" }] }]);
  assert.deepEqual(b, { style: "normal", spans: [{ text: "x" }] });
  const [g] = normalizeBlocks([{ spans: [{ text: "y", link: "https://example.com/" }] }]);
  assert.equal(g!.spans[0]!.link, "https://example.com/");
});

test("list item tabs can't fake nesting, and levels are clamped", () => {
  const [b] = normalizeBlocks([{ list: { level: 99 }, spans: [{ text: "\t\tx" }] }]);
  assert.equal(b!.spans[0]!.text, "x");
  assert.equal(b!.list!.level, 8);
});

test("empty and oversized content is rejected; outer blank paragraphs are trimmed", () => {
  assert.throws(() => normalizeBlocks([{ spans: [{ text: "  " }] }]), ContentError);
  assert.throws(() => normalizeBlocks("nope"), ContentError);
  assert.throws(() => normalizeBlocks([{ spans: [{ text: "x".repeat(1_000_001) }] }]), ContentError);
  assert.equal(normalizeBlocks([{}, { spans: [{ text: "a" }] }, {}, { spans: [{ text: "b" }] }, {}]).length, 3);
});

test("counts", () => {
  assert.equal(countWords("  one two\nthree  "), 3);
  assert.equal(countWords(""), 0);
  assert.equal(countCharacters("a😀\nb"), 3);
});

test("sealed sessions round-trip and reject tampering or the wrong key", () => {
  const secret = "s".repeat(40);
  const token = seal({ a: 1 }, secret);
  assert.deepEqual(unseal(token, secret), { a: 1 });
  assert.equal(unseal(token, "t".repeat(40)), null);
  const flipped = (token.startsWith("A") ? "B" : "A") + token.slice(1);
  assert.equal(unseal(flipped, secret), null);
  assert.equal(unseal("garbage", secret), null);
});

test("PKCE challenge matches the RFC 7636 test vector", () => {
  assert.equal(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});
