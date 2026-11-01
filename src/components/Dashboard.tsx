"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { blockText, countCharacters, countWords, plainText, type Block } from "@/lib/docs/model";
import { Editor, type EditorHandle } from "./Editor";
import { pickDocument } from "./GooglePicker";
import { Header } from "./Header";
import { Alert, Check, DocIcon, External, Shield } from "./icons";
import { TypingPreview } from "./TypingPreview";
import { Button, Card, Notice } from "./ui";

interface SessionInfo {
  configured: boolean;
  pickerAvailable: boolean;
  connected: boolean;
  user: { email?: string; name?: string } | null;
}
interface DocItem { id: string; name: string; modifiedTime?: string }
type SendState =
  | { status: "idle" }
  | { status: "sending"; stage: string }
  | { status: "done"; title: string; url: string; words: number }
  | { status: "error"; message: string; createdUrl?: string };

const AUTH_MESSAGES: Record<string, { tone: "ok" | "warn" | "bad"; text: string }> = {
  connected: { tone: "ok", text: "Google account connected." },
  denied: { tone: "warn", text: "Google sign-in was cancelled, so nothing was connected." },
  missing_scope: { tone: "warn", text: "Flow Typed needs permission for the Google Docs files it works with. Connect again and leave that box ticked." },
  state_error: { tone: "bad", text: "That sign-in couldn't be verified, or it took too long. Please try again." },
  failed: { tone: "bad", text: "Google sign-in didn't finish. Please try again." },
};

const STAGES = (isNew: boolean) => [
  ...(isNew ? [{ key: "creating", label: "Creating the document", percent: 20 }] : []),
  { key: "reading", label: "Reading the document", percent: 45 },
  { key: "writing", label: "Inserting your text", percent: 75 },
];

const inputClass = "min-h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm placeholder:text-muted";

export function Dashboard() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [tab, setTab] = useState<"editor" | "preview">("editor");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [destType, setDestType] = useState<"new" | "existing">("new");
  const [title, setTitle] = useState("");
  const [docs, setDocs] = useState<DocItem[] | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DocItem | null>(null);
  const [position, setPosition] = useState<"end" | "start">("end");
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [send, setSend] = useState<SendState>({ status: "idle" });
  const editor = useRef<EditorHandle>(null);

  const refreshSession = useCallback(async () => {
    const res = await fetch("/api/session");
    setSession((await res.json()) as SessionInfo);
  }, []);

  useEffect(() => {
    void refreshSession();
    const url = new URL(window.location.href);
    const auth = url.searchParams.get("auth");
    if (auth) {
      setAuthMessage(auth);
      url.searchParams.delete("auth");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  }, [refreshSession]);

  const connected = Boolean(session?.connected);

  const loadDocs = useCallback(async () => {
    setDocsError(null);
    const res = await fetch("/api/google/documents");
    const data = (await res.json()) as { documents?: DocItem[]; message?: string; reconnect?: boolean };
    if (!res.ok) {
      setDocsError(data.message ?? "Couldn't load your documents.");
      if (data.reconnect) void refreshSession();
      return;
    }
    setDocs(data.documents ?? []);
  }, [refreshSession]);

  useEffect(() => {
    if (connected && destType === "existing") void loadDocs();
  }, [connected, destType, loadDocs]);

  const disconnect = async () => {
    await fetch("/api/auth/disconnect", { method: "POST" });
    setDocs(null);
    setSelected(null);
    setSend({ status: "idle" });
    setAuthMessage(null);
    await refreshSession();
  };

  const browse = async () => {
    setPickerError(null);
    setPickerBusy(true);
    try {
      const res = await fetch("/api/google/picker-config");
      const cfg = (await res.json()) as { apiKey: string; appId: string; accessToken: string; message?: string };
      if (!res.ok) throw new Error(cfg.message);
      const doc = await pickDocument(cfg);
      if (doc) {
        setSelected(doc);
        setSend({ status: "idle" });
        await loadDocs();
      }
    } catch (err) {
      setPickerError(err instanceof Error && err.message !== "load" && err.message ? err.message : "The Google Drive picker couldn't open. Check that nothing is blocking apis.google.com.");
    } finally {
      setPickerBusy(false);
    }
  };

  const text = useMemo(() => plainText(blocks), [blocks]);
  const words = useMemo(() => countWords(text), [text]);
  const chars = useMemo(() => countCharacters(text), [text]);
  const firstLine = useMemo(() => blocks.map(blockText).find((t) => t.trim())?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "", [blocks]);
  const sending = send.status === "sending";
  const destinationReady = destType === "new" || Boolean(selected);
  const canSend = connected && words > 0 && destinationReady && !sending;
  const blocker = !session ? null : !session.configured ? "Google isn't set up on this server yet." : !connected ? "Connect your Google account to send." : !words ? "Add some text to send." : !destinationReady ? "Choose a document to send to." : null;

  const onBlocksChange = useCallback((b: Block[]) => setBlocks(b), []);

  const submit = async () => {
    if (!canSend) return;
    setSend({ status: "sending", stage: destType === "new" ? "creating" : "reading" });
    const sentWords = words;
    try {
      const res = await fetch("/api/google/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          blocks,
          destination: destType === "new"
            ? { type: "new", title: title.trim() || firstLine || "Untitled document" }
            : { type: "existing", documentId: selected!.id, position },
        }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { message?: string; reconnect?: boolean };
        if (data.reconnect) void refreshSession();
        setSend({ status: "error", message: data.message ?? "The request failed. Please try again." });
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const ev = JSON.parse(line) as { type: string; stage?: string; title?: string; url?: string; message?: string; createdUrl?: string; reconnect?: boolean };
          if (ev.type === "stage") setSend({ status: "sending", stage: ev.stage! });
          if (ev.type === "done") {
            finished = true;
            setSend({ status: "done", title: ev.title!, url: ev.url!, words: sentWords });
          }
          if (ev.type === "error") {
            finished = true;
            setSend({ status: "error", message: ev.message!, createdUrl: ev.createdUrl });
            if (ev.reconnect) void refreshSession();
          }
        }
      }
      if (!finished) throw new Error("incomplete");
    } catch {
      setSend({ status: "error", message: "The connection was lost before Google confirmed the result. Check the document before trying again, so the text isn't inserted twice." });
    }
  };

  const stages = STAGES(destType === "new");
  const stageIndex = send.status === "sending" ? stages.findIndex((s) => s.key === send.stage) : -1;
  const percent = send.status === "done" ? 100 : send.status === "sending" ? stages[stageIndex]?.percent ?? 10 : 0;
  const auth = authMessage ? AUTH_MESSAGES[authMessage] : null;
  const tabButton = (id: "editor" | "preview", label: string) => (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={tab === id}
      aria-controls={`panel-${id}`}
      onClick={() => setTab(id)}
      className={`min-h-9 rounded-md px-3 text-sm font-medium transition ${tab === id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
    >
      {label}
    </button>
  );
  const segment = (active: boolean) => `min-h-9 flex-1 rounded-md px-2 text-sm font-medium transition ${active ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`;

  return (
    <>
      <Header>
        {session && (
          <span data-testid="connection-pill" className={`hidden items-center gap-2 rounded-full px-3 py-1 text-xs font-medium sm:flex ${connected ? "bg-ok-soft text-ok" : "bg-surface-2 text-muted"}`}>
            <span className={`size-1.5 rounded-full ${connected ? "bg-ok" : "bg-muted"}`} />
            {connected ? "Google connected" : "Not connected"}
          </span>
        )}
      </Header>

      <main className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:py-6">
        <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:h-[calc(100dvh-6.5rem)] lg:min-h-[600px]">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2">
            <div role="tablist" aria-label="Workspace" className="flex gap-1 rounded-lg bg-surface-2 p-1">
              {tabButton("editor", "Editor")}
              {tabButton("preview", "Typing preview")}
            </div>
            <div className="flex-1" />
            {words > 0 && tab === "editor" && <Button variant="ghost" onClick={() => editor.current?.clear()} className="min-h-9">Clear</Button>}
          </div>

          <div id="panel-editor" role="tabpanel" aria-labelledby="tab-editor" className={tab === "editor" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
            <Editor ref={editor} onChange={onBlocksChange} disabled={sending} />
            <div className="flex gap-4 border-t border-line px-4 py-2 text-xs tabular-nums text-muted" aria-live="off">
              <span data-testid="word-count"><strong className="font-semibold text-ink">{words.toLocaleString()}</strong> {words === 1 ? "word" : "words"}</span>
              <span data-testid="char-count"><strong className="font-semibold text-ink">{chars.toLocaleString()}</strong> {chars === 1 ? "character" : "characters"}</span>
            </div>
          </div>
          <div id="panel-preview" role="tabpanel" aria-labelledby="tab-preview" className={tab === "preview" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
            <TypingPreview blocks={blocks} visible={tab === "preview"} />
          </div>
        </section>

        <aside className="flex min-w-0 flex-col gap-4 lg:h-[calc(100dvh-6.5rem)] lg:min-h-[600px] lg:overflow-y-auto lg:p-0.5">
          {auth && <Notice tone={auth.tone} role="status">{auth.text}</Notice>}

          <Card step={1} title="Connect Google">
            {!session ? (
              <div className="h-10 animate-pulse rounded-lg bg-surface-2" />
            ) : !session.configured ? (
              <Notice tone="warn" role="status">
                <strong className="font-semibold">Setup needed.</strong> Add your Google OAuth credentials to the server's environment (see the README), then restart.
              </Notice>
            ) : connected ? (
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="brand-gradient flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white">
                  {(session.user?.name ?? session.user?.email ?? "?").charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-ok"><Check />Connected</p>
                  <p data-testid="account-email" className="truncate text-[13px] text-muted">{session.user?.email ?? session.user?.name}</p>
                </div>
                <Button variant="ghost" onClick={disconnect}>Disconnect</Button>
              </div>
            ) : (
              <>
                <a href="/api/auth/google" className="flex min-h-11 items-center justify-center gap-2.5 rounded-lg border border-line bg-surface text-sm font-medium transition hover:bg-surface-2">
                  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#EA4335" d="M24 9.5c3.5 0 6.7 1.2 9.2 3.6l6.9-6.9C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l8 6.2C12.5 13.6 17.8 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.9 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.9c-.6 3-2.2 5.5-4.7 7.2l7.7 6c4.5-4.2 7-10.3 7-17.7z" />
                    <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-8-6.2C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.9-6.2z" />
                    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.4-4.9 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.9l-8 6.2C6.5 42.6 14.6 48 24 48z" />
                  </svg>
                  Sign in with Google
                </a>
                <p className="mt-3 text-[13px] leading-relaxed text-muted">You sign in on Google's page, and Flow Typed never sees your password. It can only access documents it creates or that you choose.</p>
              </>
            )}
          </Card>

          <Card step={2} title="Choose destination">
            <div role="radiogroup" aria-label="Destination type" className="mb-3 flex gap-1 rounded-lg bg-surface-2 p-1">
              <button type="button" role="radio" aria-checked={destType === "new"} onClick={() => setDestType("new")} className={segment(destType === "new")}>New document</button>
              <button type="button" role="radio" aria-checked={destType === "existing"} onClick={() => setDestType("existing")} className={segment(destType === "existing")}>Existing document</button>
            </div>

            {destType === "new" ? (
              <div className="fade-in">
                <label htmlFor="doc-title" className="mb-1.5 block text-[13px] text-muted">Document title</label>
                <input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={firstLine || "Untitled document"} className={inputClass} />
              </div>
            ) : !connected ? (
              <p className="fade-in text-[13px] leading-relaxed text-muted">Connect Google to choose a document.</p>
            ) : (
              <div className="fade-in space-y-3">
                <Button onClick={browse} disabled={pickerBusy || !session?.pickerAvailable} className="w-full">
                  <DocIcon />{pickerBusy ? "Opening Google Drive…" : "Browse Google Drive"}
                </Button>
                {!session?.pickerAvailable && <p className="text-[13px] leading-relaxed text-muted">Browsing isn't set up on this server. It needs a Picker API key and project number (see the README).</p>}
                {pickerError && <Notice tone="bad" role="alert">{pickerError}</Notice>}
                {docsError && <Notice tone="bad" role="alert">{docsError}</Notice>}
                {docs && docs.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[13px] text-muted">Used with Flow Typed</p>
                    <ul className="max-h-44 space-y-1 overflow-y-auto" data-testid="doc-list">
                      {docs.map((d) => (
                        <li key={d.id}>
                          <button
                            type="button"
                            aria-pressed={selected?.id === d.id}
                            onClick={() => { setSelected(d); setSend({ status: "idle" }); }}
                            className={`flex min-h-10 w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm transition ${selected?.id === d.id ? "border-accent bg-accent-soft" : "border-transparent hover:bg-surface-2"}`}
                          >
                            <DocIcon className="shrink-0 text-accent-ink" />
                            <span className="min-w-0 flex-1 truncate">{d.name}</span>
                            {selected?.id === d.id && <Check className="shrink-0 text-accent-ink" />}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {docs && docs.length === 0 && <p className="text-[13px] leading-relaxed text-muted">For your privacy, Flow Typed can't see your Drive. Browse to pick a document and it will be listed here next time.</p>}
                {selected && (
                  <div className="fade-in rounded-lg bg-surface-2 p-3">
                    <p className="truncate text-sm"><span className="text-muted">Selected: </span><strong data-testid="selected-doc" className="font-medium">{selected.name}</strong></p>
                    <div role="radiogroup" aria-label="Where to insert" className="mt-2.5 flex gap-1 rounded-lg bg-surface p-1">
                      <button type="button" role="radio" aria-checked={position === "end"} onClick={() => setPosition("end")} className={`${segment(position === "end")} ${position === "end" ? "bg-accent-soft! text-accent-ink!" : ""}`}>Add to end</button>
                      <button type="button" role="radio" aria-checked={position === "start"} onClick={() => setPosition("start")} className={`${segment(position === "start")} ${position === "start" ? "bg-accent-soft! text-accent-ink!" : ""}`}>Add to top</button>
                    </div>
                    <p className="mt-2 text-xs text-muted">Existing content is kept.</p>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card step={3} title="Send to Google Docs">
            <Button variant="primary" onClick={submit} disabled={!canSend} className="min-h-11 w-full">
              {sending ? "Sending…" : send.status === "done" ? "Send again" : "Send to Google Docs"}
            </Button>
            {blocker && send.status !== "sending" && <p data-testid="send-blocker" className="mt-2.5 text-center text-[13px] text-muted">{blocker}</p>}

            {(sending || send.status === "done") && (
              <div className="fade-in mt-4">
                <div role="progressbar" aria-label="Sending progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="brand-gradient h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${percent}%` }} />
                </div>
                {sending && (
                  <ol className="mt-3 space-y-1.5 text-[13px]" aria-live="polite">
                    {stages.map((s, i) => (
                      <li key={s.key} className={`flex items-center gap-2 ${i === stageIndex ? "font-medium text-ink" : "text-muted"}`}>
                        {i < stageIndex ? <Check className="text-ok" width={14} height={14} /> : <span className={`mx-[3px] size-2 rounded-full ${i === stageIndex ? "animate-pulse bg-accent" : "bg-line"}`} />}
                        {s.label}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}

            {send.status === "done" && (
              <div className="fade-in mt-3 space-y-3" data-testid="send-success" role="status">
                <Notice tone="ok">
                  <span className="flex items-start gap-2"><Check className="mt-0.5 shrink-0" /><span>Inserted {send.words.toLocaleString()} {send.words === 1 ? "word" : "words"} into <strong className="font-semibold">{send.title}</strong>.</span></span>
                </Notice>
                <a href={send.url} target="_blank" rel="noopener noreferrer" className="flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line text-sm font-medium transition hover:bg-surface-2">
                  Open document <External />
                </a>
              </div>
            )}

            {send.status === "error" && (
              <div className="mt-3" data-testid="send-error" role="alert">
                <Notice tone="bad">
                  <span className="flex items-start gap-2"><Alert className="mt-0.5 shrink-0" /><span>{send.message}</span></span>
                  {send.createdUrl && <a href={send.createdUrl} target="_blank" rel="noopener noreferrer" className="mt-1.5 block underline">Open the document that was created</a>}
                </Notice>
              </div>
            )}
          </Card>

          <section className="rounded-2xl border border-line p-4 text-[13px] leading-relaxed text-muted">
            <h2 className="mb-1.5 flex items-center gap-2 font-semibold text-ink"><Shield />Your privacy</h2>
            <p>Flow Typed doesn't send email, share documents, invite collaborators, or create notifications. Google may independently send security or account notices, such as an alert that a new app was connected.</p>
            <a href="/privacy" className="mt-1.5 inline-block font-medium text-accent-ink underline">Read the privacy details</a>
          </section>
        </aside>
      </main>
    </>
  );
}
