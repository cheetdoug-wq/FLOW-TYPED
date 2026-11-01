// End-to-end test of the real route handlers and real React components in Chromium.
// Everything is real except Google, which is replaced by a strict in-memory fake,
// and Next.js's bundler, which is replaced by esbuild plus the Tailwind compiler.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = join(root, "tests/.tmp");
const shots = process.env.SHOTS_DIR ?? join(tmp, "shots");
mkdirSync(shots, { recursive: true });
const PORT = 3457;
const ORIGIN = `http://localhost:${PORT}`;

const esbuild = require("esbuild");
const { chromium } = require("playwright");

/* ---------- build ---------- */
const nodePaths = (process.env.NODE_PATH ?? "").split(":").filter(Boolean);
const common = { bundle: true, jsx: "automatic", absWorkingDir: root, tsconfig: join(root, "tsconfig.json"), nodePaths, logLevel: "error", alias: { "next/link": join(root, "tests/harness/link-shim.tsx") } };
await esbuild.build({ ...common, entryPoints: ["tests/harness/client.tsx"], outfile: join(tmp, "client.js"), platform: "browser", define: { "process.env.NODE_ENV": '"production"' } });
await esbuild.build({ ...common, entryPoints: ["tests/harness/routes.ts"], outfile: join(tmp, "routes.cjs"), platform: "node", format: "cjs" });
const routes = require(join(tmp, "routes.cjs"));

async function buildCss() {
  const tw = require("tailwindcss");
  const twDir = dirname(require.resolve("tailwindcss/package.json"));
  const files = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : [p]; });
  const candidates = new Set();
  for (const f of files(join(root, "src")).filter((f) => /\.tsx?$/.test(f))) {
    for (const m of readFileSync(f, "utf8").matchAll(/[^\s"'`<>={}]+/g)) candidates.add(m[0]);
  }
  const compiler = await tw.compile(readFileSync(join(root, "src/app/globals.css"), "utf8"), {
    base: root,
    loadStylesheet: async (id, base) => {
      const path = id === "tailwindcss" ? join(twDir, "index.css") : id.startsWith("./") ? join(base, id) : join(twDir, id.replace("tailwindcss/", "") + (id.endsWith(".css") ? "" : ".css"));
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
  });
  return compiler.build([...candidates]);
}
const css = await buildCss();
const clientJs = readFileSync(join(tmp, "client.js"));
const layout = readFileSync(join(root, "src/app/layout.tsx"), "utf8");
const themeScript = layout.match(/const themeScript = `(.*)`;/)[1];
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flow Typed</title><script>${themeScript}</script><link rel="stylesheet" href="/app.css"></head><body class="min-h-dvh font-sans antialiased"><div id="root"></div><script src="/client.js"></script></body></html>`;

/* ---------- strict fake of Google's APIs ---------- */
const google = {
  docs: new Map(), // id -> { title, text, rev, log }
  calls: [],
  tokenBodies: [],
  nextId: 1,
  expiresIn: 3600,
  failBatch: null,
  editDuringNextWrite: false,
  revoked: [],
  grantedScope: "openid email profile https://www.googleapis.com/auth/drive.file",
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

function snapshot(id, d) {
  // Index 0 is the section break. d.text always ends with the document's final newline.
  const content = [{ endIndex: 1 }];
  let i = 1;
  for (const line of d.text.split(/(?<=\n)/)) {
    content.push({ startIndex: i, endIndex: i + line.length, paragraph: { elements: [{ textRun: { content: line } }] } });
    i += line.length;
  }
  return { documentId: id, title: d.title, revisionId: `rev${d.rev}`, body: { content } };
}

function applyBatch(d, body) {
  const end = () => d.text.length + 1;
  const check = (r, name) => {
    if (!(Number.isInteger(r.startIndex) && Number.isInteger(r.endIndex) && r.startIndex >= 1 && r.startIndex < r.endIndex && r.endIndex <= end())) {
      throw new Error(`${name}: invalid range ${JSON.stringify(r)} for segment end ${end()}`);
    }
  };
  const before = d.text;
  try {
    for (const q of body.requests) {
      const [name, v] = Object.entries(q)[0];
      if (name === "insertText") {
        const at = v.location.index;
        if (at < 1 || at >= end()) throw new Error(`insertText: index ${at} outside segment end ${end()}`);
        if (/[\u0000-\u0008\u000c-\u001f-]/.test(v.text)) throw new Error("insertText has characters Docs would strip");
        d.text = d.text.slice(0, at - 1) + v.text + d.text.slice(at - 1);
      } else if (name === "updateTextStyle" || name === "updateParagraphStyle" || name === "deleteParagraphBullets") {
        check(v.range, name);
        if (name !== "deleteParagraphBullets" && !v.fields) throw new Error(`${name}: fields required`);
        d.log.push({ name, text: d.text.slice(v.range.startIndex - 1, v.range.endIndex - 1), style: v.textStyle ?? v.paragraphStyle });
      } else if (name === "createParagraphBullets") {
        check(v.range, name);
        const seg = d.text.slice(v.range.startIndex - 1, v.range.endIndex - 1);
        const lines = seg.split("\n");
        d.log.push({ name, preset: v.bulletPreset, levels: lines.filter(Boolean).map((l) => l.match(/^\t*/)[0].length) });
        d.text = d.text.slice(0, v.range.startIndex - 1) + lines.map((l) => l.replace(/^\t+/, "")).join("\n") + d.text.slice(v.range.endIndex - 1);
      } else {
        throw new Error(`unexpected request type ${name}`);
      }
    }
  } catch (e) {
    d.text = before; // batches are atomic
    d.log.length = 0;
    throw e;
  }
  d.rev += 1;
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const method = init.method ?? "GET";
  google.calls.push(`${method} ${url.host}${url.pathname}`);
  const form = () => new URLSearchParams(init.body);
  if (url.href === "https://oauth2.googleapis.com/token") {
    const f = form();
    google.tokenBodies.push(Object.fromEntries(f));
    if (google.failRefresh && f.get("grant_type") === "refresh_token") return json({ error: "invalid_grant" }, 400);
    if (f.get("code") === "bad") return json({ error: "invalid_grant" }, 400);
    return json({
      access_token: `at-${google.tokenBodies.length}`,
      refresh_token: f.get("grant_type") === "authorization_code" ? "rt-1" : undefined,
      expires_in: google.expiresIn,
      scope: google.grantedScope,
      id_token: `x.${b64({ email: "jake@example.com", name: "Jake" })}.y`,
    });
  }
  if (url.href === "https://oauth2.googleapis.com/revoke") { google.revoked.push(form().get("token")); return json({}); }
  const auth = init.headers?.authorization ?? "";
  if (!auth.startsWith("Bearer at-")) return json({ error: { message: "Invalid credentials" } }, 401);
  if (url.host === "www.googleapis.com" && url.pathname === "/drive/v3/files" && method === "GET") {
    assert.match(url.searchParams.get("q"), /mimeType='application\/vnd\.google-apps\.document' and trashed=false/);
    return json({ files: [...google.docs].map(([id, d]) => ({ id, name: d.title, modifiedTime: "2026-11-01T00:00:00Z" })) });
  }
  if (url.host === "docs.googleapis.com") {
    if (url.pathname === "/v1/documents" && method === "POST") {
      const id = `docid_${String(google.nextId++).padStart(6, "0")}`;
      const { title } = JSON.parse(init.body);
      google.docs.set(id, { title, text: "\n", rev: 1, log: [] });
      return json({ documentId: id, title });
    }
    const m = url.pathname.match(/^\/v1\/documents\/([^:]+)(:batchUpdate)?$/);
    const d = m && google.docs.get(m[1]);
    if (!d) return json({ error: { message: "Requested entity was not found." } }, 404);
    if (!m[2]) return json(snapshot(m[1], d));
    if (google.failBatch) { const f = google.failBatch; google.failBatch = null; return json({ error: { message: f.message } }, f.status); }
    if (google.editDuringNextWrite) { google.editDuringNextWrite = false; d.text = "Someone else typed.\n" + d.text; d.rev += 1; }
    const body = JSON.parse(init.body);
    if (body.writeControl?.requiredRevisionId !== `rev${d.rev}`) return json({ error: { message: "The provided revision ID is not current." } }, 400);
    try { applyBatch(d, body); } catch (e) { return json({ error: { message: e.message } }, 400); }
    return json({ documentId: m[1] });
  }
  throw new Error(`Unexpected call to ${url.href}`);
};

/* ---------- server ---------- */
process.env.APP_URL = ORIGIN;
process.env.GOOGLE_CLIENT_ID = "test-client";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
process.env.SESSION_SECRET = "x".repeat(48);
process.env.GOOGLE_PICKER_API_KEY = "picker-key";
process.env.GOOGLE_PROJECT_NUMBER = "123456";

const table = { "/api/session": routes.session, "/api/auth/google": routes.start, "/api/auth/google/callback": routes.callback, "/api/auth/disconnect": routes.disconnect, "/api/google/documents": routes.documents, "/api/google/picker-config": routes.pickerConfig, "/api/google/send": routes.send };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  if (url.pathname === "/app.css") return res.writeHead(200, { "content-type": "text/css" }).end(css);
  if (url.pathname === "/client.js") return res.writeHead(200, { "content-type": "text/javascript" }).end(clientJs);
  const mod = table[url.pathname];
  if (!mod) return res.writeHead(200, { "content-type": "text/html" }).end(html);
  const handler = mod[req.method];
  if (!handler) return res.writeHead(405).end();
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
  const out = await handler(request);
  const headers = {};
  out.headers.forEach((v, k) => { if (k !== "set-cookie") headers[k] = v; });
  const cookies = out.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(out.status, headers);
  if (out.body) Readable.fromWeb(out.body).pipe(res); else res.end();
});
await new Promise((r) => server.listen(PORT, r));

/* ---------- tests ---------- */
const browser = await chromium.launch();
let passed = 0;
const failures = [];
const consoleErrors = [];
async function t(name, fn) {
  try { await fn(); passed += 1; console.log(`ok   ${name}`); }
  catch (e) { failures.push(name); console.log(`FAIL ${name}\n     ${e.message.split("\n").slice(0, 6).join("\n     ")}`); }
}
async function fresh(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "light", ...options });
  context.setDefaultTimeout(8000);
  const page = await context.newPage();
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/401|403|400/.test(m.text())) consoleErrors.push(m.text()); });
  return { context, page };
}
const editor = (page) => page.getByRole("textbox", { name: "Your text" });
async function paste(page, { html: h, text }) {
  await editor(page).click();
  await page.evaluate(({ h, text }) => {
    const dt = new DataTransfer();
    if (h) dt.setData("text/html", h);
    dt.setData("text/plain", text ?? "");
    document.querySelector('[role="textbox"][aria-label="Your text"]').dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { h, text });
}
// Playwright can't intercept the redirected request to accounts.google.com, so this stands in for
// Google's consent page at the first hop: it reads the real authorize URL, then sends Google's reply.
async function consent(context, reply) {
  let seen;
  await context.route(`${ORIGIN}/api/auth/google`, async (route) => {
    const res = await route.fetch({ maxRedirects: 0 });
    seen = new URL(res.headers().location);
    assert.equal(seen.origin + seen.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    const cb = new URL(seen.searchParams.get("redirect_uri"));
    for (const [k, v] of Object.entries(reply)) cb.searchParams.set(k, v);
    cb.searchParams.set("state", seen.searchParams.get("state"));
    await route.fulfill({ status: 302, headers: { location: cb.href, "set-cookie": res.headers()["set-cookie"] } });
  });
  return () => seen;
}
async function signIn(context, page) {
  await context.unrouteAll();
  const seen = await consent(context, { code: "good" });
  await page.getByRole("link", { name: "Sign in with Google" }).click();
  await page.getByTestId("account-email").waitFor();
  return seen();
}
async function connected(options) {
  const { context, page } = await fresh(options);
  await page.goto(ORIGIN);
  await signIn(context, page);
  return { context, page };
}
const ESSAY_HTML = `<meta charset="utf-8"><b style="font-weight:normal" id="docs-internal-guid-1"><h1>My Essay 😀</h1>
<p>First <span style="font-weight:700">bold words</span> and <span style="font-style:italic">italic</span> plus <a href="https://example.com/a">a link</a> and <a href="javascript:alert(1)">bad link</a>.</p>
<p style="text-align:center">Centered line<script>window.__pwned=true</script></p>
<ul><li>Alpha<ul><li>Nested</li></ul></li><li>Beta</li></ul>
<ol><li>One</li></ol>
<img src="x" onerror="window.__pwned=true"><blockquote>Quoted</blockquote><p>Line one<br>Line two</p></b>`;
const ESSAY_TEXT = "My Essay 😀\n\nFirst bold words";

try {
  await t("shows a setup notice instead of a fake button when Google isn't configured", async () => {
    const saved = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    const { context, page } = await fresh();
    await page.goto(ORIGIN);
    await page.getByText("Setup needed.").waitFor();
    assert.equal(await page.getByRole("link", { name: "Sign in with Google" }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Send to Google Docs" }).isDisabled(), true);
    await page.screenshot({ path: join(shots, "unconfigured.png") });
    await context.close();
    process.env.GOOGLE_CLIENT_ID = saved;
  });

  await t("paste is sanitized, formatting kept, counts correct", async () => {
    const { context, page } = await fresh();
    await page.goto(ORIGIN);
    await paste(page, { html: ESSAY_HTML, text: ESSAY_TEXT });
    const box = editor(page);
    assert.equal(await box.locator("h1").innerText(), "My Essay 😀");
    assert.equal(await box.locator("strong").innerText(), "bold words");
    assert.equal(await box.locator("em").innerText(), "italic");
    assert.equal(await box.locator('a[href="https://example.com/a"]').count(), 1);
    assert.equal(await box.locator('a[href^="javascript"]').count(), 0);
    assert.equal(await box.locator("img,script").count(), 0);
    assert.equal(await box.locator("ul ul li").innerText(), "Nested");
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    await page.getByTestId("word-count").getByText(/^\d+$/).waitFor();
    const words = Number((await page.getByTestId("word-count").innerText()).split(" ")[0]);
    assert.equal(words, 25, `word count ${words}`);
    await context.close();
  });

  await t("plain text paste: blank lines separate paragraphs and text can be edited", async () => {
    const { context, page } = await fresh();
    await page.goto(ORIGIN);
    await paste(page, { text: "Para one\nstill one.\n\nPara two.\n\n\nPara three <b>not html</b>." });
    const box = editor(page);
    assert.equal(await box.locator("p").count(), 3);
    assert.equal(await box.locator("p b").count(), 0);
    assert.match(await box.locator("p").nth(2).innerText(), /<b>not html<\/b>/);
    await page.keyboard.type(" Edited");
    assert.match(await box.innerText(), /Edited$/);
    await page.keyboard.press("Control+A");
    await page.getByRole("button", { name: "Bold" }).click();
    assert.ok(await box.locator("b,strong").count() > 0);
    await page.getByRole("button", { name: "Clear" }).click();
    assert.equal((await page.getByTestId("word-count").innerText()).startsWith("0"), true);
    await context.close();
  });

  await t("OAuth: least-privilege scope, PKCE, draft survives redirect, cookie is HttpOnly", async () => {
    const { context, page } = await fresh();
    await page.goto(ORIGIN);
    await paste(page, { text: "A draft that must survive sign in." });
    await page.waitForTimeout(300);
    const url = await signIn(context, page);
    assert.equal(url.searchParams.get("scope"), "openid email profile https://www.googleapis.com/auth/drive.file");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.ok(url.searchParams.get("code_challenge").length >= 43);
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.match(await editor(page).innerText(), /A draft that must survive sign in/);
    assert.equal(await page.getByTestId("account-email").innerText(), "jake@example.com");
    assert.match(await page.getByTestId("connection-pill").innerText(), /Google connected/);
    const verifierBody = google.tokenBodies.at(-1);
    assert.ok(verifierBody.code_verifier.length >= 43);
    const cookie = (await context.cookies()).find((c) => c.name === "ft_session");
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, "Lax");
    assert.ok(!cookie.value.includes("at-") && !Buffer.from(cookie.value, "base64url").toString("latin1").includes("rt-1"), "tokens are encrypted");
    assert.ok(cookie.value.length < 3800, "cookie fits browser limit");
    assert.ok(new URL(page.url()).search === "", "auth query param is removed");
    await context.close();
  });

  await t("OAuth: forged state, cancelled sign-in and refused scope don't connect", async () => {
    const { context, page } = await fresh();
    await page.goto(`${ORIGIN}/api/auth/google/callback?code=good&state=forged`);
    await page.getByText("couldn't be verified").waitFor();
    assert.equal((await context.cookies()).some((c) => c.name === "ft_session"), false);
    await consent(context, { error: "access_denied" });
    await page.getByRole("link", { name: "Sign in with Google" }).click();
    await page.getByText("was cancelled").waitFor();
    await context.unrouteAll();
    google.grantedScope = "openid email profile";
    await signIn(context, page).catch(() => {});
    await page.getByText("leave that box ticked").waitFor();
    google.grantedScope = "openid email profile https://www.googleapis.com/auth/drive.file";
    assert.equal((await context.cookies()).some((c) => c.name === "ft_session"), false);
    await context.close();
  });

  let newDocId;
  await t("sends to a NEW doc with real streamed progress, formatting and an Open button", async () => {
    const { context, page } = await connected();
    await paste(page, { html: ESSAY_HTML, text: ESSAY_TEXT });
    google.calls.length = 0;
    await page.getByLabel("Document title").fill("Essay for class");
    await page.screenshot({ path: join(shots, "ready-light.png") });
    await page.getByRole("button", { name: "Send to Google Docs" }).click();
    await page.getByTestId("send-success").waitFor();
    await page.screenshot({ path: join(shots, "sent-light.png") });
    const [id, d] = [...google.docs].at(-1);
    newDocId = id;
    assert.equal(d.title, "Essay for class");
    assert.equal(d.text, "My Essay 😀\nFirst bold words and italic plus a link and bad link.\nCentered line\nAlpha\nNested\nBeta\nOne\nQuoted\nLine one\u000bLine two\n");
    const styled = (k, want) => d.log.some((l) => l.text === want && l.style?.[k] !== undefined);
    assert.ok(d.log.some((l) => l.text === "My Essay 😀\n" && l.style?.namedStyleType === "HEADING_1"), "heading");
    assert.ok(styled("bold", "bold words"), "bold");
    assert.ok(styled("italic", "italic"), "italic");
    assert.ok(d.log.some((l) => l.text === "a link" && l.style?.link?.url === "https://example.com/a"), "link");
    assert.ok(!d.log.some((l) => l.text === "bad link" && l.style?.link), "unsafe link dropped");
    assert.ok(d.log.some((l) => l.text === "Centered line\n" && l.style?.alignment === "CENTER"), "alignment");
    assert.ok(d.log.some((l) => l.text === "Quoted\n" && l.style?.indentStart), "quote");
    const bullets = d.log.filter((l) => l.name === "createParagraphBullets");
    assert.deepEqual(bullets.find((b) => b.preset.startsWith("BULLET")).levels, [0, 1, 0], "nesting");
    assert.ok(bullets.find((b) => b.preset.startsWith("NUMBERED")), "numbered");
    assert.equal(await page.getByRole("link", { name: "Open document" }).getAttribute("href"), `https://docs.google.com/document/d/${id}/edit`);
    assert.deepEqual(google.calls, ["POST docs.googleapis.com/v1/documents", `GET docs.googleapis.com/v1/documents/${id}`, `POST docs.googleapis.com/v1/documents/${id}:batchUpdate`], "exactly these Google calls, one atomic write");
    await context.close();
  });

  await t("progress stages stream while the request is in flight", async () => {
    const { context, page } = await connected();
    await paste(page, { text: "Short text." });
    const original = globalThis.fetch;
    globalThis.fetch = async (u, i) => { if (String(u).includes(":batchUpdate")) await new Promise((r) => setTimeout(r, 800)); return original(u, i); };
    await page.getByRole("button", { name: "Send to Google Docs" }).click();
    await page.getByText("Inserting your text").waitFor();
    assert.equal(await page.getByRole("progressbar", { name: "Sending progress" }).getAttribute("aria-valuenow"), "75");
    assert.equal(await page.getByTestId("send-success").count(), 0);
    await page.screenshot({ path: join(shots, "sending.png") });
    await page.getByTestId("send-success").waitFor();
    globalThis.fetch = original;
    await context.close();
  });

  await t("existing doc: list, select, append and insert at top keep existing content", async () => {
    google.docs.set("existing_doc_1", { title: "Notes", text: "Existing line.\n", rev: 1, log: [] });
    const { context, page } = await connected();
    await paste(page, { text: "Added text." });
    await page.getByRole("radio", { name: "Existing document" }).click();
    assert.match(await page.getByTestId("send-blocker").innerText(), /Choose a document/);
    await page.getByTestId("doc-list").getByRole("button", { name: "Notes" }).click();
    await page.screenshot({ path: join(shots, "existing-light.png") });
    await page.getByRole("button", { name: "Send to Google Docs" }).click();
    await page.getByTestId("send-success").waitFor();
    assert.equal(google.docs.get("existing_doc_1").text, "Existing line.\nAdded text.\n");
    await page.getByRole("radio", { name: "Add to top" }).click();
    await page.getByRole("button", { name: "Send again" }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="send-success"]') && !document.body.innerText.includes("Sending…"));
    await page.waitForFunction(() => true);
    await page.waitForTimeout(200);
    assert.equal(google.docs.get("existing_doc_1").text, "Added text.\nExisting line.\nAdded text.\n");
    await context.close();
  });

  await t("Drive picker: builder receives token, key and project number, and the chosen doc is used", async () => {
    google.docs.set("picked_doc_01", { title: "Picked Doc", text: "\n", rev: 1, log: [] });
    const { context, page } = await connected();
    await context.route("https://apis.google.com/js/api.js", (route) => route.fulfill({
      contentType: "text/javascript",
      body: `window.__picker={};window.gapi={load(n,cb){window.google={picker:{ViewId:{DOCUMENTS:"d"},DocsViewMode:{LIST:"l"},Response:{ACTION:"action",DOCUMENTS:"docs"},Action:{PICKED:"picked",CANCEL:"cancel"},DocsView:class{constructor(i){this.i=i}setMode(m){window.__picker.mode=m;return this}},PickerBuilder:class{addView(v){window.__picker.view=v.i;return this}setOAuthToken(t){window.__picker.token=t;return this}setDeveloperKey(k){window.__picker.key=k;return this}setAppId(a){window.__picker.app=a;return this}setTitle(){return this}setCallback(c){this.c=c;return this}build(){const c=this.c;return{setVisible(){setTimeout(()=>c({action:"picked",docs:[{id:"picked_doc_01",name:"Picked Doc"}]}),10)}}}}}};cb()}};`,
    }));
    await paste(page, { text: "Into the picked doc." });
    await page.getByRole("radio", { name: "Existing document" }).click();
    await page.getByRole("button", { name: "Browse Google Drive" }).click();
    await page.getByTestId("selected-doc").getByText("Picked Doc").waitFor();
    const p = await page.evaluate(() => window.__picker);
    assert.equal(p.key, "picker-key"); assert.equal(p.app, "123456"); assert.match(p.token, /^at-/); assert.equal(p.view, "d");
    await page.getByRole("button", { name: "Send to Google Docs" }).click();
    await page.getByTestId("send-success").waitFor();
    assert.equal(google.docs.get("picked_doc_01").text, "Into the picked doc.\n");
    await context.close();
  });

  await t("typing preview animates and adjusts speed, is labelled, and never contacts Google", async () => {
    const { context, page } = await connected();
    await paste(page, { html: ESSAY_HTML, text: ESSAY_TEXT });
    google.calls.length = 0;
    await page.getByRole("tab", { name: "Typing preview" }).click();
    const banner = page.getByTestId("preview-banner");
    assert.match(await banner.innerText(), /Preview only/i);
    assert.match(await banner.innerText(), /doesn't type into Google Docs/);
    const panel = page.locator("#panel-preview .doc-text");
    assert.equal((await panel.innerText()).trim(), "");
    const slider = page.getByRole("slider");
    await slider.fill("600");
    await page.getByRole("button", { name: "Play" }).click();
    await page.waitForTimeout(700);
    const a = (await panel.innerText()).length;
    assert.ok(a > 10, `typed ${a}`);
    await page.getByRole("button", { name: "Pause" }).click();
    await page.waitForTimeout(100);
    const b = (await panel.innerText()).length;
    await page.waitForTimeout(300);
    assert.equal((await panel.innerText()).length, b, "pause holds");
    await page.screenshot({ path: join(shots, "preview-light.png") });
    await page.getByRole("button", { name: "Resume" }).click();
    await page.getByText("Preview finished").waitFor({ timeout: 15000 });
    assert.match(await panel.innerText(), /Line two/);
    // Slower speed moves measurably slower.
    await slider.fill("60");
    await page.getByRole("button", { name: "Restart" }).click();
    await page.waitForTimeout(600);
    assert.ok((await panel.innerText()).length < a, "slower");
    assert.deepEqual(google.calls.filter((c) => !c.includes("oauth2")), [], "no Google API call from preview");
    await context.close();
  });

  await t("Google errors are explained; a conflict re-reads and retries without losing edits", async () => {
    google.docs.set("error_doc_001", { title: "Error Doc", text: "Start\n", rev: 1, log: [] });
    const { context, page } = await connected();
    await paste(page, { text: "Some text." });
    await page.getByRole("radio", { name: "Existing document" }).click();
    await page.getByTestId("doc-list").getByRole("button", { name: "Error Doc" }).click();
    google.failBatch = { status: 403, message: "The caller does not have permission" };
    await page.getByRole("button", { name: "Send to Google Docs" }).click();
    await page.getByTestId("send-error").getByText(/can't edit that document/).waitFor();
    assert.equal(google.docs.get("error_doc_001").text, "Start\n");
    await page.screenshot({ path: join(shots, "error-light.png") });
    google.failBatch = { status: 500, message: "Internal error" };
    const before = google.calls.filter((c) => c.includes(":batchUpdate")).length;
    await page.getByRole("button", { name: "Send to Google Docs" }).click();
    await page.getByTestId("send-error").getByText(/inserted twice/).waitFor();
    assert.equal(google.calls.filter((c) => c.includes(":batchUpdate")).length, before + 1, "a failed write is never blindly repeated");
    google.editDuringNextWrite = true;
    await page.getByRole("button", { name: "Send to Google Docs" }).click();
    await page.getByTestId("send-success").waitFor();
    assert.equal(google.docs.get("error_doc_001").text, "Someone else typed.\nStart\nSome text.\n");
    await context.close();
  });

  await t("expired access token refreshes; failed refresh asks to reconnect", async () => {
    google.expiresIn = 10; // under the 60 second safety margin, so already "expired"
    const { context, page } = await connected();
    const n = google.tokenBodies.length; // expiresIn stays short, so the refreshed token is also near expiry
    await paste(page, { text: "After refresh." });
    await page.getByRole("button", { name: "Send to Google Docs" }).click();
    await page.getByTestId("send-success").waitFor();
    assert.equal(google.tokenBodies.at(n).grant_type, "refresh_token");
    assert.equal(google.tokenBodies.at(n).refresh_token, "rt-1");
    google.expiresIn = 3600;
    google.failRefresh = true;
    await page.getByRole("button", { name: "Send again" }).click();
    await page.getByTestId("send-error").getByText(/connection expired/).waitFor();
    await page.getByRole("link", { name: "Sign in with Google" }).waitFor();
    google.failRefresh = false;
    await context.close();
  });

  await t("security: unauthenticated, cross-origin and malformed requests are refused", async () => {
    const post = (body, headers) => realFetch(`${ORIGIN}/api/google/send`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    assert.equal((await post({}, { origin: ORIGIN })).status, 401);
    assert.equal((await realFetch(`${ORIGIN}/api/google/documents`)).status, 401);
    assert.equal((await realFetch(`${ORIGIN}/api/google/picker-config`)).status, 401);
    const { context, page } = await connected();
    const cookie = (await context.cookies()).find((c) => c.name === "ft_session");
    const h = { cookie: `ft_session=${cookie.value}` };
    assert.equal((await post({ blocks: [{ spans: [{ text: "x" }] }], destination: { type: "new", title: "t" } }, { ...h, origin: "https://evil.example" })).status, 403);
    assert.equal((await post({ blocks: [{ spans: [{ text: "x" }] }], destination: { type: "existing", documentId: "../../drive/v3" } }, { ...h, origin: ORIGIN })).status, 400);
    assert.equal((await post({ blocks: [], destination: { type: "new", title: "t" } }, { ...h, origin: ORIGIN })).status, 400);
    assert.equal((await realFetch(`${ORIGIN}/api/auth/disconnect`, { method: "POST", headers: { ...h, origin: "https://evil.example" } })).status, 403);
    assert.equal((await realFetch(`${ORIGIN}/api/session`, { headers: { cookie: "ft_session=tampered" } }).then((r) => r.json())).connected, false);
    await context.close();
  });

  await t("disconnect revokes at Google and clears the cookie", async () => {
    const { context, page } = await connected();
    google.revoked.length = 0;
    await page.getByRole("button", { name: "Disconnect" }).click();
    await page.getByRole("link", { name: "Sign in with Google" }).waitFor();
    assert.deepEqual(google.revoked, ["rt-1"]);
    assert.equal((await context.cookies()).some((c) => c.name === "ft_session"), false);
    await context.close();
  });

  await t("the only Google hosts ever contacted are auth, Docs and Drive; no sharing, email or permissions", async () => {
    const bad = google.calls.filter((c) => /gmail|permissions|\/share|invite|comments/i.test(c));
    assert.deepEqual(bad, []);
  });

  await t("large essay (200,000 chars) sends in one batch", async () => {
    const { context, page } = await connected();
    const para = "Lorem ipsum dolor sit amet consectetur. ".repeat(25).trim();
    await paste(page, { text: Array.from({ length: 200 }, () => para).join("\n\n") });
    await page.getByRole("button", { name: "Send to Google Docs" }).click();
    await page.getByTestId("send-success").waitFor({ timeout: 20000 });
    const d = [...google.docs.values()].at(-1);
    assert.equal(d.text.split("\n").filter(Boolean).length, 200);
    await context.close();
  });

  await t("dark theme toggles, persists, and follows the OS by default", async () => {
    const { context, page } = await connected({ colorScheme: "light" });
    await paste(page, { html: ESSAY_HTML, text: ESSAY_TEXT });
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), false);
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(14, 14, 24)");
    await page.screenshot({ path: join(shots, "ready-dark.png") });
    await page.getByRole("tab", { name: "Typing preview" }).click();
    await page.getByRole("slider").fill("600");
    await page.getByRole("button", { name: "Play" }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(shots, "preview-dark.png") });
    await page.reload();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), true);
    await context.close();
    const os = await fresh({ colorScheme: "dark" });
    await os.page.goto(ORIGIN);
    assert.equal(await os.page.evaluate(() => document.documentElement.classList.contains("dark")), true);
    await os.context.close();
  });

  await t("phone width: no horizontal scrolling, touch targets usable", async () => {
    const { context, page } = await connected({ viewport: { width: 375, height: 760 }, deviceScaleFactor: 2 });
    await paste(page, { html: ESSAY_HTML, text: ESSAY_TEXT });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `overflow ${overflow}`);
    await page.screenshot({ path: join(shots, "phone-top.png") });
    await page.screenshot({ path: join(shots, "phone-full.png"), fullPage: true });
    await page.getByRole("tab", { name: "Typing preview" }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await context.close();
  });

  await t("privacy page states the guarantees, including Google's own notices", async () => {
    const { context, page } = await fresh();
    await page.goto(`${ORIGIN}/privacy`);
    const body = await page.locator("main").innerText();
    for (const want of ["never sends email", "invites collaborators", "password", "security or account notices", "drive.file"]) assert.ok(body.includes(want), want);
    await page.screenshot({ path: join(shots, "privacy.png"), fullPage: true });
    await context.close();
  });

  await t("no uncaught page errors during the whole run", async () => {
    assert.deepEqual(consoleErrors, []);
  });
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
